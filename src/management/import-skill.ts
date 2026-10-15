import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { readRegularFileBounded } from "../safe-file.js";
import type { ApplicationId, SkillImportPreview, SkillImportReceipt } from "../types.js";

const MAX_FILES = 128;
const MAX_DEPTH = 6;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 8 * 1024 * 1024;
const PLAN_LIFETIME_MS = 10 * 60 * 1000;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const SCRIPT_EXTENSION = /\.(?:js|cjs|mjs|ts|py|sh|bash|zsh|ps1|bat|cmd)$/i;

interface PlannedFile {
  relativePath: string;
  bytes: number;
  sha256: string;
}

export interface SkillImportPlan {
  preview: SkillImportPreview;
  destinationRoot: string;
  sourceIdentity: { dev: number; ino: number };
  destinationIdentity: { dev: number; ino: number } | null;
  files: PlannedFile[];
}

export interface AppliedSkillImport {
  receipt: SkillImportReceipt;
  files: PlannedFile[];
  destinationRoot: string;
  destinationRootIdentity: { dev: number; ino: number };
  destinationIdentity: { dev: number; ino: number };
}

/** Prepare one additive import. It never opens an archive, follows a link, or changes a file. */
export async function planLocalSkillImport(
  sourceDirectory: string,
  destinationRoot: string,
  application: ApplicationId,
  now = Date.now(),
): Promise<SkillImportPlan> {
  const source = path.resolve(sourceDirectory);
  const root = path.resolve(destinationRoot);
  const name = path.basename(source);
  if (!SLUG.test(name) || name.startsWith(".skillmanager-")) {
    throw new Error("The skill folder needs a simple name using letters, numbers, dots, _ or -.");
  }
  const sourceIdentity = await requireDirectory(source);
  await requireDirectory(path.dirname(root));
  const destinationIdentity = (await exists(root)) ? await requireDirectory(root) : null;
  const destinationDirectory = path.join(root, name);
  if (isInside(source, root) || source === destinationDirectory) {
    throw new Error("The destination cannot be inside the selected skill folder.");
  }
  if (await exists(destinationDirectory)) {
    throw new Error("A skill folder with this name already exists. Nothing will be overwritten.");
  }
  const files = await enumerateFiles(source);
  if (!files.some((item) => item.relativePath === "SKILL.md")) {
    throw new Error("Select a skill folder containing a top-level SKILL.md file.");
  }
  return {
    preview: {
      id: randomUUID(),
      application,
      sourceDirectory: source,
      destinationDirectory,
      fileCount: files.length,
      totalBytes: files.reduce((total, item) => total + item.bytes, 0),
      includesScripts: files.some((item) => SCRIPT_EXTENSION.test(item.relativePath)),
      expiresAt: new Date(now + PLAN_LIFETIME_MS).toISOString(),
    },
    destinationRoot: root,
    sourceIdentity,
    destinationIdentity,
    files,
  };
}

/** Copy to a private staging folder, verify, then atomically add the new folder. */
export async function applyLocalSkillImport(
  plan: SkillImportPlan,
  now = Date.now(),
): Promise<AppliedSkillImport> {
  if (now >= Date.parse(plan.preview.expiresAt)) {
    throw new Error("This preview expired. Select the skill folder again.");
  }
  await requireSameDirectory(plan.preview.sourceDirectory, plan.sourceIdentity);
  let destinationIdentity = plan.destinationIdentity;
  if (destinationIdentity) {
    await requireSameDirectory(plan.destinationRoot, destinationIdentity);
  } else {
    await requireDirectory(path.dirname(plan.destinationRoot));
    await fs.mkdir(plan.destinationRoot, { mode: 0o700 });
    destinationIdentity = await requireDirectory(plan.destinationRoot);
  }
  if (await exists(plan.preview.destinationDirectory)) {
    throw new Error("The destination changed after the preview. Nothing was imported.");
  }
  const currentFiles = await enumerateFiles(plan.preview.sourceDirectory);
  if (!sameFiles(currentFiles, plan.files)) {
    throw new Error("The source changed after the preview. Nothing was imported.");
  }

  const stage = await fs.mkdtemp(path.join(plan.destinationRoot, ".skillmanager-stage-"));
  let createdDestination: { dev: number; ino: number } | null = null;
  let committed = false;
  try {
    for (const entry of plan.files) {
      const sourceFile = path.join(plan.preview.sourceDirectory, entry.relativePath);
      const targetFile = path.join(stage, entry.relativePath);
      await fs.mkdir(path.dirname(targetFile), { recursive: true, mode: 0o700 });
      const data = await readRegularFileBounded(sourceFile, MAX_FILE_BYTES);
      if (data.length !== entry.bytes || digest(data) !== entry.sha256) {
        throw new Error("The source changed while staging. Nothing was imported.");
      }
      await fs.writeFile(targetFile, data, { flag: "wx", mode: 0o600 });
    }
    if (!sameFiles(await enumerateFiles(stage), plan.files)) {
      throw new Error("Staging verification failed. Nothing was imported.");
    }
    await requireSameDirectory(plan.destinationRoot, destinationIdentity);
    if (await exists(plan.preview.destinationDirectory)) {
      throw new Error("The destination changed while staging. Nothing was imported.");
    }
    // mkdir is exclusive: unlike rename, it cannot replace a directory created
    // after the last existence check. Files are copied exclusively from staging.
    await fs.mkdir(plan.preview.destinationDirectory, { mode: 0o700 });
    createdDestination = await requireDirectory(plan.preview.destinationDirectory);
    for (const entry of plan.files) {
      await requireSameDirectory(plan.destinationRoot, destinationIdentity);
      await requireSameDirectory(plan.preview.destinationDirectory, createdDestination);
      const targetFile = path.join(plan.preview.destinationDirectory, entry.relativePath);
      await fs.mkdir(path.dirname(targetFile), { recursive: true, mode: 0o700 });
      await requireDirectoryChain(plan.preview.destinationDirectory, path.dirname(targetFile));
      await fs.copyFile(path.join(stage, entry.relativePath), targetFile, constants.COPYFILE_EXCL);
    }
    if (!sameFiles(await enumerateFiles(plan.preview.destinationDirectory), plan.files)) {
      throw new Error("The imported files could not be verified. Review the destination manually.");
    }
    committed = true;
    return {
      receipt: {
        id: randomUUID(),
        application: plan.preview.application,
        destinationDirectory: plan.preview.destinationDirectory,
        fileCount: plan.files.length,
        appliedAt: new Date(now).toISOString(),
      },
      destinationRoot: plan.destinationRoot,
      destinationRootIdentity: destinationIdentity,
      destinationIdentity: createdDestination,
      files: plan.files,
    };
  } catch (error) {
    if (createdDestination && !committed) {
      try {
        await requireSameDirectory(plan.preview.destinationDirectory, createdDestination);
        await fs.rename(
          plan.preview.destinationDirectory,
          path.join(plan.destinationRoot, `.skillmanager-recovery-${randomUUID()}`),
        );
      } catch {
        throw new Error(
          "Import failed and the destination changed during recovery. Review it manually.",
        );
      }
    }
    throw error;
  } finally {
    await fs.rm(stage, { recursive: true, force: true });
  }
}

/** Undo only an unchanged import; move it aside for recovery instead of deleting it. */
export async function undoLocalSkillImport(applied: AppliedSkillImport): Promise<string> {
  const destination = applied.receipt.destinationDirectory;
  if (path.dirname(destination) !== applied.destinationRoot) {
    throw new Error("The import receipt is outside its original destination.");
  }
  await requireSameDirectory(applied.destinationRoot, applied.destinationRootIdentity);
  await requireSameDirectory(destination, applied.destinationIdentity);
  if (!sameFiles(await enumerateFiles(destination), applied.files)) {
    throw new Error("The imported skill has changed. Undo was stopped to preserve those changes.");
  }
  await requireSameDirectory(destination, applied.destinationIdentity);
  const recovery = path.join(
    applied.destinationRoot,
    `.skillmanager-recovery-${path.basename(destination)}-${randomUUID()}`,
  );
  await fs.rename(destination, recovery);
  return recovery;
}

async function enumerateFiles(root: string): Promise<PlannedFile[]> {
  const files: PlannedFile[] = [];
  let totalBytes = 0;
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw new Error("The skill folder is too deeply nested to import.");
    const handle = await fs.opendir(directory);
    try {
      for await (const entry of handle) {
        if (entry.name.startsWith(".") || entry.name === "node_modules") {
          throw new Error("The skill folder contains a hidden or dependency path. Import stopped.");
        }
        const absolute = path.join(directory, entry.name);
        if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) {
          throw new Error("The skill folder contains a link or special file. Import stopped.");
        }
        if (entry.isDirectory()) {
          await walk(absolute, depth + 1);
          continue;
        }
        if (files.length >= MAX_FILES) throw new Error("The skill folder has too many files.");
        const stats = await fs.lstat(absolute);
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_FILE_BYTES) {
          throw new Error("The skill folder contains an unsupported or oversized file.");
        }
        totalBytes += stats.size;
        if (totalBytes > MAX_TOTAL_BYTES)
          throw new Error("The skill folder exceeds the import size limit.");
        const data = await readRegularFileBounded(absolute, MAX_FILE_BYTES);
        files.push({
          relativePath: path.relative(root, absolute),
          bytes: data.length,
          sha256: digest(data),
        });
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  };
  await walk(root, 0);
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function requireDirectory(directory: string): Promise<{ dev: number; ino: number }> {
  const stats = await fs.lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("The selected source or destination is not a regular folder.");
  }
  return { dev: stats.dev, ino: stats.ino };
}

async function requireSameDirectory(
  directory: string,
  expected: { dev: number; ino: number },
): Promise<void> {
  const current = await requireDirectory(directory);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error("A folder changed after the preview. Nothing was imported.");
  }
}

async function requireDirectoryChain(root: string, directory: string): Promise<void> {
  const relative = path.relative(root, directory);
  if (relative === "") return;
  if (relative === ".." || relative.startsWith(`..${path.sep}`)) {
    throw new Error("The import path left its destination folder.");
  }
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    await requireDirectory(current);
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.lstat(filePath);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function sameFiles(left: readonly PlannedFile[], right: readonly PlannedFile[]): boolean {
  return (
    left.length === right.length &&
    left.every(
      (item, index) =>
        item.relativePath === right[index]?.relativePath &&
        item.bytes === right[index]?.bytes &&
        item.sha256 === right[index]?.sha256,
    )
  );
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function digest(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

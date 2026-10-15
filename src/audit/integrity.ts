import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readRegularFileBounded } from "../safe-file.js";
import type { AuditFileChange, AuditFileRecord } from "../types.js";

const MAX_BASELINE_BYTES = 4 * 1024 * 1024;

/** Compare exact application/item/path identities; uncertain scans never claim removal. */
export function compareAuditFiles(
  current: readonly AuditFileRecord[],
  previous: readonly AuditFileRecord[] | null,
  canAssessRemovals: boolean,
): AuditFileChange[] {
  if (!previous) return [];
  const before = new Map(previous.map((item) => [identity(item), item]));
  const after = new Map(current.map((item) => [identity(item), item]));
  const changes: AuditFileChange[] = [];
  for (const [key, file] of after) {
    const old = before.get(key);
    if (!old) changes.push({ type: "added", file });
    else if (old.sha256 !== file.sha256 || old.bytes !== file.bytes) {
      changes.push({ type: "modified", file });
    }
  }
  if (canAssessRemovals) {
    for (const [key, file] of before) {
      if (!after.has(key)) changes.push({ type: "removed", file });
    }
  }
  return changes.sort(
    (left, right) =>
      left.file.application.localeCompare(right.file.application) ||
      left.file.sourceFile.localeCompare(right.file.sourceFile) ||
      left.type.localeCompare(right.type),
  );
}

/** Preserve known entries when an incomplete scan cannot justify removals. */
export function mergeAuditFiles(
  current: readonly AuditFileRecord[],
  previous: readonly AuditFileRecord[] | null,
  complete: boolean,
): AuditFileRecord[] {
  if (complete || !previous) return [...current];
  const merged = new Map(previous.map((item) => [identity(item), item]));
  for (const item of current) merged.set(identity(item), item);
  return [...merged.values()];
}

export async function readAuditFileBaseline(filePath: string): Promise<AuditFileRecord[] | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse((await readRegularFileBounded(filePath, MAX_BASELINE_BYTES)).toString());
  } catch (error) {
    if (isMissing(error)) return null;
    throw new Error("The audit baseline could not be read. It was not replaced.", { cause: error });
  }
  if (!isObject(parsed) || parsed.version !== 1 || !Array.isArray(parsed.files)) {
    throw new Error("The audit baseline is invalid. It was not replaced.");
  }
  if (parsed.files.length > 20000 || !parsed.files.every(isFileRecord)) {
    throw new Error("The audit baseline contains invalid file records. It was not replaced.");
  }
  return parsed.files;
}

export async function writeAuditFileBaseline(
  filePath: string,
  files: readonly AuditFileRecord[],
): Promise<void> {
  const contents = JSON.stringify({ version: 1, files });
  if (Buffer.byteLength(contents) > MAX_BASELINE_BYTES) {
    throw new Error("The audit baseline exceeds its safety limit.");
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    const stats = await fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error("The audit baseline path is not a regular file.");
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  const temporary = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
    await fs.rename(temporary, filePath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function identity(file: AuditFileRecord): string {
  return JSON.stringify([file.application, file.itemKind, file.itemId, file.sourceFile]);
}

function isFileRecord(value: unknown): value is AuditFileRecord {
  if (!isObject(value)) return false;
  return (
    (value.application === "chatgpt" || value.application === "claude") &&
    (value.itemKind === "skill" || value.itemKind === "mcp" || value.itemKind === "plugin") &&
    typeof value.itemId === "string" &&
    value.itemId.length <= 2048 &&
    typeof value.sourceFile === "string" &&
    path.isAbsolute(value.sourceFile) &&
    value.sourceFile.length <= 2048 &&
    typeof value.bytes === "number" &&
    Number.isSafeInteger(value.bytes) &&
    value.bytes >= 0 &&
    typeof value.sha256 === "string" &&
    /^[a-f0-9]{64}$/.test(value.sha256) &&
    typeof value.isScript === "boolean"
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

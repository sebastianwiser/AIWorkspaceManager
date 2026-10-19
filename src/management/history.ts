import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readRegularFileBounded } from "../safe-file.js";
import type { ApplicationId, SkillImportHistoryEntry } from "../types.js";
import {
  verifyAppliedSkillImport,
  type AppliedSkillImport,
  type PlannedFile,
  type SkillImportPlan,
} from "./import-skill.js";

const VERSION = 1;
const MAX_ENTRIES = 100;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9-]{36}$/i;
const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

interface Identity {
  dev: number;
  ino: number;
}

interface ImportRecord {
  id: string;
  application: ApplicationId;
  destinationRoot: string;
  destinationDirectory: string;
  startedAt: string;
  appliedAt: string | null;
  state: "applying" | "applied" | "undoing" | "recovered";
  files: PlannedFile[];
  destinationRootIdentity: Identity | null;
  destinationIdentity: Identity | null;
  recoveryDirectory: string | null;
}

interface Journal {
  version: 1;
  entries: ImportRecord[];
}

/** One local journal; callers serialize mutations and never retry an interrupted operation. */
export class ImportHistory {
  constructor(
    private readonly journalPath: string,
    private readonly rootFor: (application: ApplicationId) => string,
  ) {}

  async list(): Promise<SkillImportHistoryEntry[]> {
    const journal = await this.read();
    const entries: SkillImportHistoryEntry[] = [];
    for (const entry of journal.entries.slice().reverse()) {
      entries.push(await this.describe(entry));
    }
    return entries;
  }

  async beginImport(plan: SkillImportPlan): Promise<void> {
    const journal = await this.read();
    if (journal.entries.length >= MAX_ENTRIES) {
      throw new Error("Import history is full. No files were imported.");
    }
    if (journal.entries.some((entry) => entry.id === plan.preview.id)) {
      throw new Error("This import is already recorded.");
    }
    const entry: ImportRecord = {
      id: plan.preview.id,
      application: plan.preview.application,
      destinationRoot: plan.destinationRoot,
      destinationDirectory: plan.preview.destinationDirectory,
      startedAt: new Date().toISOString(),
      appliedAt: null,
      state: "applying",
      files: plan.files,
      destinationRootIdentity: null,
      destinationIdentity: null,
      recoveryDirectory: null,
    };
    this.validateEntry(entry);
    journal.entries.push(entry);
    await this.write(journal);
  }

  async finishImport(applied: AppliedSkillImport): Promise<void> {
    const journal = await this.read();
    const entry = this.find(journal, applied.receipt.id);
    if (
      entry.state !== "applying" ||
      entry.destinationDirectory !== applied.receipt.destinationDirectory ||
      entry.destinationRoot !== applied.destinationRoot ||
      entry.application !== applied.receipt.application ||
      JSON.stringify(entry.files) !== JSON.stringify(applied.files)
    ) {
      throw new Error("The import history no longer matches the completed import.");
    }
    entry.state = "applied";
    entry.appliedAt = applied.receipt.appliedAt;
    entry.destinationRootIdentity = applied.destinationRootIdentity;
    entry.destinationIdentity = applied.destinationIdentity;
    await this.write(journal);
  }

  async prepareUndo(id: string): Promise<{ applied: AppliedSkillImport; recovery: string }> {
    const journal = await this.read();
    const entry = this.find(journal, id);
    if (entry.state !== "applied") throw new Error("This import is not available to undo.");
    const applied = this.toApplied(entry);
    await verifyAppliedSkillImport(applied);
    const recovery = path.join(
      entry.destinationRoot,
      `.skillmanager-recovery-${path.basename(entry.destinationDirectory)}-${randomUUID()}`,
    );
    entry.state = "undoing";
    entry.recoveryDirectory = recovery;
    await this.write(journal);
    return { applied, recovery };
  }

  async finishUndo(id: string, recovery: string): Promise<void> {
    const journal = await this.read();
    const entry = this.find(journal, id);
    if (entry.state !== "undoing" || entry.recoveryDirectory !== recovery) {
      throw new Error("The import history no longer matches the recovery location.");
    }
    entry.state = "recovered";
    await this.write(journal);
  }

  private async describe(entry: ImportRecord): Promise<SkillImportHistoryEntry> {
    const base = {
      id: entry.id,
      application: entry.application,
      destinationDirectory: entry.destinationDirectory,
      fileCount: entry.files.length,
      startedAt: entry.startedAt,
      appliedAt: entry.appliedAt,
      recoveryDirectory: entry.recoveryDirectory,
    };
    if (entry.state === "applying" || entry.state === "undoing") {
      return { ...base, status: "needs-review" };
    }
    if (entry.state === "recovered") {
      try {
        const stats = await fs.lstat(entry.recoveryDirectory!);
        return {
          ...base,
          status: stats.isDirectory() && !stats.isSymbolicLink() ? "recovered" : "needs-review",
        };
      } catch {
        return { ...base, status: "needs-review" };
      }
    }
    let present: boolean;
    try {
      present = await exists(entry.destinationDirectory);
    } catch {
      return { ...base, status: "needs-review" };
    }
    if (!present) return { ...base, status: "missing" };
    try {
      await verifyAppliedSkillImport(this.toApplied(entry));
      return { ...base, status: "unchanged" };
    } catch {
      return { ...base, status: "changed" };
    }
  }

  private toApplied(entry: ImportRecord): AppliedSkillImport {
    if (!entry.appliedAt || !entry.destinationRootIdentity || !entry.destinationIdentity) {
      throw new Error("The import record is incomplete.");
    }
    return {
      receipt: {
        id: entry.id,
        application: entry.application,
        destinationDirectory: entry.destinationDirectory,
        fileCount: entry.files.length,
        appliedAt: entry.appliedAt,
      },
      files: entry.files,
      destinationRoot: entry.destinationRoot,
      destinationRootIdentity: entry.destinationRootIdentity,
      destinationIdentity: entry.destinationIdentity,
    };
  }

  private find(journal: Journal, id: string): ImportRecord {
    const entry = journal.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error("This import was not found in local history.");
    return entry;
  }

  private async read(): Promise<Journal> {
    let stats;
    try {
      stats = await fs.lstat(this.journalPath);
    } catch (error) {
      if (isMissing(error)) return { version: VERSION, entries: [] };
      throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_JOURNAL_BYTES) {
      throw new Error("Import history is unsafe or too large. It was not changed.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        (await readRegularFileBounded(this.journalPath, MAX_JOURNAL_BYTES)).toString("utf8"),
      );
    } catch {
      throw new Error("Import history is unreadable. It was not changed.");
    }
    if (
      !isObject(parsed) ||
      parsed.version !== VERSION ||
      !Array.isArray(parsed.entries) ||
      parsed.entries.length > MAX_ENTRIES
    ) {
      throw new Error("Import history has an unsupported or invalid format. It was not changed.");
    }
    const ids = new Set<string>();
    for (const entry of parsed.entries) {
      this.validateEntry(entry);
      if (ids.has(entry.id))
        throw new Error("Import history contains duplicate IDs. It was not changed.");
      ids.add(entry.id);
    }
    return parsed as unknown as Journal;
  }

  private validateEntry(value: unknown): asserts value is ImportRecord {
    if (!isObject(value)) throw invalid();
    const entry = value as Record<string, unknown>;
    const files = entry.files;
    if (
      typeof entry.id !== "string" ||
      !UUID.test(entry.id) ||
      (entry.application !== "chatgpt" && entry.application !== "claude") ||
      typeof entry.destinationRoot !== "string" ||
      entry.destinationRoot !== this.rootFor(entry.application) ||
      typeof entry.destinationDirectory !== "string" ||
      path.dirname(entry.destinationDirectory) !== entry.destinationRoot ||
      !SLUG.test(path.basename(entry.destinationDirectory)) ||
      path.basename(entry.destinationDirectory).startsWith(".skillmanager-") ||
      !validDate(entry.startedAt) ||
      !["applying", "applied", "undoing", "recovered"].includes(String(entry.state)) ||
      !Array.isArray(files) ||
      files.length < 1 ||
      files.length > 128 ||
      !files.every(validFile) ||
      !files.some((file: PlannedFile) => file.relativePath === "SKILL.md") ||
      files.reduce((sum: number, file: PlannedFile) => sum + file.bytes, 0) > 8 * 1024 * 1024 ||
      new Set(files.map((file: PlannedFile) => file.relativePath)).size !== files.length ||
      !files.every(
        (file: PlannedFile, index: number) =>
          index === 0 || files[index - 1].relativePath.localeCompare(file.relativePath) < 0,
      )
    )
      throw invalid();
    if (entry.state === "applying") {
      if (
        entry.appliedAt !== null ||
        entry.destinationRootIdentity !== null ||
        entry.destinationIdentity !== null ||
        entry.recoveryDirectory !== null
      )
        throw invalid();
    } else {
      if (
        !validDate(entry.appliedAt) ||
        !validIdentity(entry.destinationRootIdentity) ||
        !validIdentity(entry.destinationIdentity)
      )
        throw invalid();
      if (entry.state === "applied" && entry.recoveryDirectory !== null) throw invalid();
      if (
        entry.state !== "applied" &&
        !validRecovery(entry.recoveryDirectory, entry.destinationRoot as string)
      )
        throw invalid();
    }
  }

  private async write(journal: Journal): Promise<void> {
    const directory = path.dirname(this.journalPath);
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const directoryStats = await fs.lstat(directory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) throw invalid();
    const temporary = path.join(directory, `.import-history-${randomUUID()}.tmp`);
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(JSON.stringify(journal));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.rename(temporary, this.journalPath);
      const directoryHandle = await fs.open(directory, "r");
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validIdentity(value: unknown): value is Identity {
  return (
    isObject(value) &&
    Number.isSafeInteger(value.dev) &&
    Number.isSafeInteger(value.ino) &&
    Number(value.dev) >= 0 &&
    Number(value.ino) >= 0
  );
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function validFile(value: unknown): value is PlannedFile {
  if (!isObject(value) || typeof value.relativePath !== "string") return false;
  const parts = value.relativePath.split(/[\\/]/);
  return (
    parts.length <= 7 &&
    parts.every(
      (part) =>
        part !== "" &&
        part !== "." &&
        part !== ".." &&
        !part.startsWith(".") &&
        part !== "node_modules",
    ) &&
    Number.isSafeInteger(value.bytes) &&
    Number(value.bytes) >= 0 &&
    Number(value.bytes) <= 2 * 1024 * 1024 &&
    typeof value.sha256 === "string" &&
    SHA256.test(value.sha256)
  );
}

function validRecovery(value: unknown, root: string): value is string {
  return (
    typeof value === "string" &&
    path.dirname(value) === root &&
    /^\.skillmanager-recovery-[a-z0-9._-]+-[a-f0-9-]{36}$/i.test(path.basename(value))
  );
}

function invalid(): Error {
  return new Error("Import history is invalid. It was not changed.");
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

function isMissing(error: unknown): boolean {
  return isObject(error) && error.code === "ENOENT";
}

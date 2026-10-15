import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getSkillIdentity } from "./inventory.js";
import { hashRegularFile, readRegularFileBounded } from "./safe-file.js";
import type {
  ApplicationDefinition,
  DiscoveredSkill,
  InventoryChanges,
  ScanDiagnostic,
  SkillChange,
} from "./types.js";

const SNAPSHOT_VERSION = 1;
const MAX_FINGERPRINT_BYTES = 16 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const METADATA_STATUSES = new Set(["valid", "incomplete", "missing", "invalid", "unreadable"]);
const SKILL_SOURCES = new Set([
  "personal",
  "system",
  "plugin",
  "plugin-cache",
  "claude-desktop-plugin",
  "project",
]);

export interface SnapshotSkill {
  fingerprint: string | null;
  skill: DiscoveredSkill;
}

export interface InventorySnapshot {
  version: typeof SNAPSHOT_VERSION;
  scannedAt: string;
  skills: SnapshotSkill[];
}

/** An incomplete scan must not replace a known-good baseline or claim removals. */
export function isInventoryScanComplete(
  previous: InventorySnapshot | null,
  applications: readonly ApplicationDefinition[],
  diagnostics: readonly ScanDiagnostic[],
): boolean {
  if (diagnostics.some((item) => item.code === "PROJECT_REGISTRY_INVALID")) return false;
  const incompleteCodes = new Set([
    "PERMISSION_DENIED",
    "READ_FAILED",
    "SYMLINK_ROOT_SKIPPED",
    "NOT_A_DIRECTORY",
    "MAX_DEPTH_REACHED",
  ]);
  if (diagnostics.some((item) => incompleteCodes.has(item.code))) return false;
  if (!previous) return true;

  for (const { skill } of previous.skills) {
    const application = applications.find((item) => item.id === skill.application);
    const covered = application?.locations.some((location) =>
      isPathInside(location.path, skill.instructionFile),
    );
    if (!covered) return false;
    if (
      diagnostics.some(
        (item) =>
          item.application === skill.application &&
          item.code === "LOCATION_NOT_FOUND" &&
          isPathInside(item.location, skill.instructionFile),
      )
    ) {
      return false;
    }
  }
  return true;
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

/** Build a metadata-only snapshot. Skill instructions are represented by a hash. */
export async function createInventorySnapshot(
  skills: readonly DiscoveredSkill[],
  scannedAt: string,
): Promise<InventorySnapshot> {
  return {
    version: SNAPSHOT_VERSION,
    scannedAt,
    skills: await Promise.all(
      skills.map(async (skill) => ({
        fingerprint: await fingerprintFile(skill.instructionFile),
        skill,
      })),
    ),
  };
}

/** Compare two scans without reading or changing any skill files. */
export function compareInventorySnapshots(
  current: InventorySnapshot,
  previous: InventorySnapshot | null,
): InventoryChanges {
  if (!previous) {
    return {
      baselineCreated: true,
      baselineScannedAt: null,
      comparedAt: current.scannedAt,
      items: [],
    };
  }

  const currentById = new Map(
    current.skills.map((entry) => [getSkillIdentity(entry.skill), entry] as const),
  );
  const previousById = new Map(
    previous.skills.map((entry) => [getSkillIdentity(entry.skill), entry] as const),
  );
  const items: SkillChange[] = [];
  const addedCandidates: SnapshotSkill[] = [];
  const removedCandidates: SnapshotSkill[] = [];

  for (const [identity, entry] of currentById) {
    const oldEntry = previousById.get(identity);
    if (!oldEntry) {
      addedCandidates.push(entry);
    } else if (snapshotSkillChanged(entry, oldEntry)) {
      items.push({ type: "modified", skill: entry.skill, previousSkill: oldEntry.skill });
    }
  }

  for (const [identity, entry] of previousById) {
    if (!currentById.has(identity)) {
      removedCandidates.push(entry);
    }
  }

  // An unchanged file hash that disappears at one path and appears at another
  // is a strong, local-only indication that the skill moved or was renamed.
  const removedByFingerprint = groupByFingerprint(removedCandidates);
  const matchedRemoved = new Set<SnapshotSkill>();

  for (const entry of addedCandidates) {
    const moveMatches = entry.fingerprint
      ? (removedByFingerprint.get(fingerprintIdentity(entry)) ?? [])
      : [];
    const previousEntry = moveMatches.find((candidate) => !matchedRemoved.has(candidate));

    if (previousEntry) {
      matchedRemoved.add(previousEntry);
      items.push({ type: "moved", skill: entry.skill, previousSkill: previousEntry.skill });
    } else {
      items.push({ type: "added", skill: entry.skill, previousSkill: null });
    }
  }

  for (const entry of removedCandidates) {
    if (!matchedRemoved.has(entry)) {
      items.push({ type: "removed", skill: entry.skill, previousSkill: null });
    }
  }

  return {
    baselineCreated: false,
    baselineScannedAt: previous.scannedAt,
    comparedAt: current.scannedAt,
    items: items.sort(compareChanges),
  };
}

export async function readInventorySnapshot(filePath: string): Promise<InventorySnapshot | null> {
  try {
    const value: unknown = JSON.parse(
      (await readRegularFileBounded(filePath, MAX_SNAPSHOT_BYTES)).toString("utf8"),
    );
    return isInventorySnapshot(value) ? value : null;
  } catch {
    return null;
  }
}

/** Write through a temporary file so an interrupted save cannot corrupt the baseline. */
export async function writeInventorySnapshot(
  filePath: string,
  snapshot: InventorySnapshot,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function snapshotSkillChanged(current: SnapshotSkill, previous: SnapshotSkill): boolean {
  if (current.fingerprint !== null || previous.fingerprint !== null) {
    return current.fingerprint !== previous.fingerprint;
  }

  // If a file was temporarily unreadable, retain a useful metadata fallback.
  return JSON.stringify(current.skill) !== JSON.stringify(previous.skill);
}

function groupByFingerprint(entries: readonly SnapshotSkill[]): Map<string, SnapshotSkill[]> {
  const groups = new Map<string, SnapshotSkill[]>();
  for (const entry of entries) {
    if (!entry.fingerprint) {
      continue;
    }
    const identity = fingerprintIdentity(entry);
    const group = groups.get(identity) ?? [];
    group.push(entry);
    groups.set(identity, group);
  }
  return groups;
}

function fingerprintIdentity(entry: SnapshotSkill): string {
  return `${entry.skill.application}\u0000${entry.fingerprint ?? ""}`;
}

function compareChanges(left: SkillChange, right: SkillChange): number {
  return (
    left.skill.application.localeCompare(right.skill.application) ||
    left.skill.name.localeCompare(right.skill.name, undefined, { sensitivity: "base" }) ||
    left.type.localeCompare(right.type)
  );
}

async function fingerprintFile(filePath: string): Promise<string | null> {
  try {
    return await hashRegularFile(filePath, MAX_FINGERPRINT_BYTES);
  } catch {
    return null;
  }
}

function isInventorySnapshot(value: unknown): value is InventorySnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const snapshot = value as Partial<InventorySnapshot>;
  return (
    snapshot.version === SNAPSHOT_VERSION &&
    typeof snapshot.scannedAt === "string" &&
    Number.isFinite(Date.parse(snapshot.scannedAt)) &&
    Array.isArray(snapshot.skills) &&
    snapshot.skills.every(isSnapshotSkill)
  );
}

function isSnapshotSkill(value: unknown): value is SnapshotSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry = value as Record<string, unknown>;
  return (
    (entry.fingerprint === null ||
      (typeof entry.fingerprint === "string" && /^[0-9a-f]{64}$/.test(entry.fingerprint))) &&
    isDiscoveredSkill(entry.skill)
  );
}

function isDiscoveredSkill(value: unknown): value is DiscoveredSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const skill = value as Record<string, unknown>;
  return (
    (skill.application === "chatgpt" || skill.application === "claude") &&
    typeof skill.applicationName === "string" &&
    typeof skill.name === "string" &&
    typeof skill.folderName === "string" &&
    isStringOrNull(skill.description) &&
    typeof skill.metadataStatus === "string" &&
    METADATA_STATUSES.has(skill.metadataStatus) &&
    Array.isArray(skill.metadataIssues) &&
    skill.metadataIssues.every((issue: unknown) => typeof issue === "string") &&
    typeof skill.directory === "string" &&
    typeof skill.instructionFile === "string" &&
    typeof skill.source === "string" &&
    SKILL_SOURCES.has(skill.source) &&
    typeof skill.sourceName === "string" &&
    typeof skill.sourceLabel === "string" &&
    (skill.scope === "global" || skill.scope === "project") &&
    isStringOrNull(skill.projectId) &&
    isStringOrNull(skill.projectName) &&
    isStringOrNull(skill.projectRoot) &&
    isStringOrNull(skill.modifiedAt)
  );
}

function isStringOrNull(value: unknown): value is string | null {
  return typeof value === "string" || value === null;
}

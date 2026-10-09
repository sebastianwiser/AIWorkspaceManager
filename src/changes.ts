import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { getSkillIdentity } from "./inventory.js";
import type { DiscoveredSkill, InventoryChanges, SkillChange } from "./types.js";

const SNAPSHOT_VERSION = 1;

export interface SnapshotSkill {
  fingerprint: string | null;
  skill: DiscoveredSkill;
}

export interface InventorySnapshot {
  version: typeof SNAPSHOT_VERSION;
  scannedAt: string;
  skills: SnapshotSkill[];
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
    const value: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
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
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, filePath);
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
    const contents = await fs.readFile(filePath);
    return createHash("sha256").update(contents).digest("hex");
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
    Array.isArray(snapshot.skills) &&
    snapshot.skills.every(isSnapshotSkill)
  );
}

function isSnapshotSkill(value: unknown): value is SnapshotSkill {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const entry = value as Partial<SnapshotSkill>;
  return (
    (typeof entry.fingerprint === "string" || entry.fingerprint === null) &&
    !!entry.skill &&
    typeof entry.skill === "object" &&
    typeof entry.skill.application === "string" &&
    typeof entry.skill.instructionFile === "string"
  );
}

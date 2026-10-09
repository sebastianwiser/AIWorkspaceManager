import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  compareInventorySnapshots,
  createInventorySnapshot,
  readInventorySnapshot,
  writeInventorySnapshot,
  type InventorySnapshot,
  type SnapshotSkill,
} from "../src/changes.js";
import type { DiscoveredSkill } from "../src/types.js";

async function createTemporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-changes-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function createSkill(instructionFile: string, overrides: Partial<DiscoveredSkill> = {}) {
  const directory = path.dirname(instructionFile);
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: path.basename(directory),
    folderName: path.basename(directory),
    description: "Example skill.",
    metadataStatus: "valid",
    metadataIssues: [],
    directory,
    instructionFile,
    source: "personal",
    sourceName: "Personal",
    sourceLabel: "Test skills",
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    modifiedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } satisfies DiscoveredSkill;
}

function createSnapshot(scannedAt: string, entries: SnapshotSkill[]): InventorySnapshot {
  return { version: 1, scannedAt, skills: entries };
}

test("creates an empty change list for the first baseline", () => {
  const current = createSnapshot("2026-01-02T00:00:00.000Z", []);
  const changes = compareInventorySnapshots(current, null);

  assert.equal(changes.baselineCreated, true);
  assert.equal(changes.baselineScannedAt, null);
  assert.deepEqual(changes.items, []);
});

test("reports no changes when the inventory and contents are unchanged", () => {
  const skill = createSkill("/skills/unchanged/SKILL.md");
  const previous = createSnapshot("2026-01-01T00:00:00.000Z", [
    { skill, fingerprint: "same-content" },
  ]);
  const current = createSnapshot("2026-01-02T00:00:00.000Z", [
    { skill: { ...skill }, fingerprint: "same-content" },
  ]);

  const changes = compareInventorySnapshots(current, previous);

  assert.equal(changes.baselineCreated, false);
  assert.deepEqual(changes.items, []);
});

test("detects added, modified, removed, and moved skills", () => {
  const previousSkill = createSkill("/skills/modified/SKILL.md");
  const removedSkill = createSkill("/skills/removed/SKILL.md");
  const movedFrom = createSkill("/skills/old-name/SKILL.md", { name: "renamed" });
  const currentSkill = { ...previousSkill, modifiedAt: "2026-01-02T00:00:00.000Z" };
  const addedSkill = createSkill("/skills/added/SKILL.md");
  const movedTo = createSkill("/skills/new-name/SKILL.md", { name: "renamed" });
  const previous = createSnapshot("2026-01-01T00:00:00.000Z", [
    { skill: previousSkill, fingerprint: "old-content" },
    { skill: removedSkill, fingerprint: "removed-content" },
    { skill: movedFrom, fingerprint: "same-content" },
  ]);
  const current = createSnapshot("2026-01-02T00:00:00.000Z", [
    { skill: currentSkill, fingerprint: "new-content" },
    { skill: addedSkill, fingerprint: "added-content" },
    { skill: movedTo, fingerprint: "same-content" },
  ]);

  const changes = compareInventorySnapshots(current, previous);
  const byType = new Map(changes.items.map((item) => [item.type, item]));

  assert.equal(changes.baselineCreated, false);
  assert.equal(changes.baselineScannedAt, previous.scannedAt);
  assert.equal(byType.get("added")?.skill.name, "added");
  assert.equal(byType.get("modified")?.skill.name, "modified");
  assert.equal(byType.get("removed")?.skill.name, "removed");
  assert.equal(byType.get("moved")?.skill.directory, "/skills/new-name");
  assert.equal(byType.get("moved")?.previousSkill?.directory, "/skills/old-name");
});

test("keeps identical hashes separate across applications", () => {
  const oldClaudeSkill = createSkill("/old/SKILL.md", {
    application: "claude",
    applicationName: "Claude",
  });
  const newChatGptSkill = createSkill("/new/SKILL.md");
  const previous = createSnapshot("2026-01-01T00:00:00.000Z", [
    { skill: oldClaudeSkill, fingerprint: "shared-hash" },
  ]);
  const current = createSnapshot("2026-01-02T00:00:00.000Z", [
    { skill: newChatGptSkill, fingerprint: "shared-hash" },
  ]);

  assert.deepEqual(
    compareInventorySnapshots(current, previous)
      .items.map((item) => item.type)
      .sort(),
    ["added", "removed"],
  );
});

test("creates content hashes and persists a valid snapshot", async (t) => {
  const root = await createTemporaryDirectory(t);
  const skillDirectory = path.join(root, "example");
  const instructionFile = path.join(skillDirectory, "SKILL.md");
  const snapshotFile = path.join(root, "state", "inventory-baseline.json");
  await fs.mkdir(skillDirectory);
  await fs.writeFile(instructionFile, "# Example\n");

  const snapshot = await createInventorySnapshot(
    [createSkill(instructionFile)],
    "2026-01-01T00:00:00.000Z",
  );
  await writeInventorySnapshot(snapshotFile, snapshot);

  assert.match(snapshot.skills[0].fingerprint ?? "", /^[a-f0-9]{64}$/);
  assert.deepEqual(await readInventorySnapshot(snapshotFile), snapshot);
});

test("ignores an invalid or unsupported snapshot file", async (t) => {
  const root = await createTemporaryDirectory(t);
  const snapshotFile = path.join(root, "inventory-baseline.json");
  await fs.writeFile(snapshotFile, JSON.stringify({ version: 999, skills: [] }));

  assert.equal(await readInventorySnapshot(snapshotFile), null);
});

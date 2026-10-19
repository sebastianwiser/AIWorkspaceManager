import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { ImportHistory } from "../src/management/history.js";
import {
  applyLocalSkillImport,
  planLocalSkillImport,
  undoLocalSkillImport,
} from "../src/management/import-skill.js";

async function setup(t: TestContext) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-history-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const destination = path.join(root, "installed");
  const journal = path.join(root, "user-data", "import-history.json");
  await fs.mkdir(destination);
  const history = () => new ImportHistory(journal, () => destination);
  const source = async (name: string) => {
    const directory = path.join(root, name);
    await fs.mkdir(directory);
    await fs.writeFile(path.join(directory, "SKILL.md"), `# ${name}\n`);
    return directory;
  };
  return { root, destination, journal, history, source };
}

test("completed imports survive restart and can be undone to a recorded recovery location", async (t) => {
  const { destination, history, source } = await setup(t);
  const plan = await planLocalSkillImport(await source("alpha"), destination, "chatgpt");
  await history().beginImport(plan);
  const applied = await applyLocalSkillImport(plan, Date.now(), plan.preview.id);
  await history().finishImport(applied);
  const restarted = history();
  assert.equal((await restarted.list())[0].status, "unchanged");
  const { applied: saved, recovery } = await restarted.prepareUndo(applied.receipt.id);
  assert.equal((await history().list())[0].status, "needs-review");
  assert.equal(await undoLocalSkillImport(saved, recovery), recovery);
  await history().finishUndo(applied.receipt.id, recovery);
  const [entry] = await history().list();
  assert.equal(entry.status, "recovered");
  assert.equal(entry.recoveryDirectory, recovery);
  assert.equal(await fs.readFile(path.join(recovery, "SKILL.md"), "utf8"), "# alpha\n");
  await assert.rejects(history().prepareUndo(applied.receipt.id), /not available/);
});

test("reconciliation protects edited and missing folders", async (t) => {
  const { destination, history, source } = await setup(t);
  const plan = await planLocalSkillImport(await source("alpha"), destination, "claude");
  await history().beginImport(plan);
  const applied = await applyLocalSkillImport(plan, Date.now(), plan.preview.id);
  await history().finishImport(applied);
  await fs.writeFile(path.join(applied.receipt.destinationDirectory, "SKILL.md"), "user edit");
  assert.equal((await history().list())[0].status, "changed");
  await assert.rejects(history().prepareUndo(applied.receipt.id), /changed/);
  assert.equal(
    await fs.readFile(path.join(applied.receipt.destinationDirectory, "SKILL.md"), "utf8"),
    "user edit",
  );
  await fs.rename(applied.receipt.destinationDirectory, path.join(destination, "moved-by-user"));
  assert.equal((await history().list())[0].status, "missing");
  await assert.rejects(history().prepareUndo(applied.receipt.id));
});

test("interrupted imports are recorded without retrying or touching the destination", async (t) => {
  const { destination, history, source } = await setup(t);
  const plan = await planLocalSkillImport(await source("alpha"), destination, "chatgpt");
  await history().beginImport(plan);
  assert.equal((await history().list())[0].status, "needs-review");
  await assert.rejects(fs.lstat(plan.preview.destinationDirectory), { code: "ENOENT" });
  await assert.rejects(history().beginImport(plan), /already recorded/);
  await assert.rejects(history().prepareUndo(plan.preview.id), /not available/);
});

test("an interrupted undo keeps its recovery path visible without repeating the move", async (t) => {
  const { destination, history, source } = await setup(t);
  const plan = await planLocalSkillImport(await source("alpha"), destination, "chatgpt");
  await history().beginImport(plan);
  const applied = await applyLocalSkillImport(plan, Date.now(), plan.preview.id);
  await history().finishImport(applied);
  const prepared = await history().prepareUndo(applied.receipt.id);
  await undoLocalSkillImport(prepared.applied, prepared.recovery);
  const [entry] = await history().list();
  assert.equal(entry.status, "needs-review");
  assert.equal(entry.recoveryDirectory, prepared.recovery);
  assert.equal(await fs.readFile(path.join(prepared.recovery, "SKILL.md"), "utf8"), "# alpha\n");
  await assert.rejects(history().prepareUndo(applied.receipt.id), /not available/);
});

test("history keeps multiple imports and refuses malformed or linked journal files", async (t) => {
  const { destination, history, journal, source, root } = await setup(t);
  for (const name of ["alpha", "beta"]) {
    const plan = await planLocalSkillImport(await source(name), destination, "chatgpt");
    await history().beginImport(plan);
    const applied = await applyLocalSkillImport(plan, Date.now(), plan.preview.id);
    await history().finishImport(applied);
  }
  assert.deepEqual(
    (await history().list()).map((entry) => entry.status),
    ["unchanged", "unchanged"],
  );
  await fs.writeFile(journal, "{bad json");
  await assert.rejects(history().list(), /unreadable/);
  await assert.rejects(
    history().beginImport(
      await planLocalSkillImport(await source("gamma"), destination, "chatgpt"),
    ),
    /unreadable/,
  );
  assert.equal(await fs.readFile(journal, "utf8"), "{bad json");
  await fs.unlink(journal);
  const outside = path.join(root, "other.json");
  await fs.writeFile(outside, "{}");
  await fs.symlink(outside, journal);
  await assert.rejects(history().list(), /unsafe/);
  assert.equal(await fs.readFile(outside, "utf8"), "{}");
});

test("valid-looking history for another destination root is rejected", async (t) => {
  const { destination, history, journal, source } = await setup(t);
  const plan = await planLocalSkillImport(await source("alpha"), destination, "chatgpt");
  await history().beginImport(plan);
  const record = JSON.parse(await fs.readFile(journal, "utf8"));
  record.entries[0].destinationRoot = path.dirname(destination);
  await fs.writeFile(journal, JSON.stringify(record));
  await assert.rejects(history().list(), /invalid/);
});

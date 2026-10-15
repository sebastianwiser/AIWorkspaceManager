import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  applyLocalSkillImport,
  planLocalSkillImport,
  undoLocalSkillImport,
} from "../src/management/import-skill.js";

async function fixture(
  t: TestContext,
): Promise<{ source: string; destination: string; root: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-import-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, "research-skill");
  const destination = path.join(root, "installed");
  await fs.mkdir(source);
  await fs.mkdir(destination);
  await fs.writeFile(path.join(source, "SKILL.md"), "---\nname: Research\n---\n# Research\n");
  return { source, destination, root };
}

test("imports a bounded local folder without running scripts and undoes it recoverably", async (t) => {
  const { source, destination, root } = await fixture(t);
  await fs.mkdir(path.join(source, "scripts"));
  await fs.writeFile(path.join(source, "scripts", "run.sh"), `touch '${path.join(root, "ran")}'`);
  const plan = await planLocalSkillImport(source, destination, "chatgpt");
  assert.equal(plan.preview.fileCount, 2);
  assert.equal(plan.preview.includesScripts, true);
  assert.doesNotMatch(JSON.stringify(plan.preview), /touch/);
  const applied = await applyLocalSkillImport(plan);
  assert.equal(applied.receipt.fileCount, 2);
  assert.equal(
    await fs.readFile(path.join(destination, "research-skill", "SKILL.md"), "utf8"),
    "---\nname: Research\n---\n# Research\n",
  );
  await assert.rejects(fs.lstat(path.join(root, "ran")), { code: "ENOENT" });
  const recovery = await undoLocalSkillImport(applied);
  assert.match(path.basename(recovery), /^\.skillmanager-recovery-/);
  assert.equal(
    await fs.readFile(path.join(recovery, "SKILL.md"), "utf8"),
    "---\nname: Research\n---\n# Research\n",
  );
  await assert.rejects(fs.lstat(path.join(destination, "research-skill")), { code: "ENOENT" });
});

test("refuses an existing destination and does not overwrite it", async (t) => {
  const { source, destination } = await fixture(t);
  const existing = path.join(destination, "research-skill");
  await fs.mkdir(existing);
  await fs.writeFile(path.join(existing, "SKILL.md"), "original");
  await assert.rejects(planLocalSkillImport(source, destination, "claude"), /already exists/);
  assert.equal(await fs.readFile(path.join(existing, "SKILL.md"), "utf8"), "original");
});

test("refuses symlinks and hidden paths inside a selected folder", async (t) => {
  const { source, destination, root } = await fixture(t);
  await fs.symlink(path.join(root, "elsewhere"), path.join(source, "linked"));
  await assert.rejects(
    planLocalSkillImport(source, destination, "chatgpt"),
    /link or special file/,
  );
  await fs.unlink(path.join(source, "linked"));
  await fs.writeFile(path.join(source, ".env"), "PRIVATE=example");
  await assert.rejects(
    planLocalSkillImport(source, destination, "chatgpt"),
    /hidden or dependency/,
  );
});

test("refuses changed source, changed destination, expired preview, and edited undo", async (t) => {
  const { source, destination } = await fixture(t);
  const first = await planLocalSkillImport(source, destination, "chatgpt", 1000);
  await assert.rejects(applyLocalSkillImport(first, 1000 + 10 * 60 * 1000), /expired/);
  await fs.writeFile(path.join(source, "SKILL.md"), "changed");
  await assert.rejects(applyLocalSkillImport(first, 1001), /source changed/);
  const second = await planLocalSkillImport(source, destination, "chatgpt");
  await fs.mkdir(path.join(destination, "research-skill"));
  await assert.rejects(applyLocalSkillImport(second), /destination changed/);
  await fs.rmdir(path.join(destination, "research-skill"));
  const third = await planLocalSkillImport(source, destination, "chatgpt");
  const applied = await applyLocalSkillImport(third);
  await fs.writeFile(path.join(destination, "research-skill", "SKILL.md"), "user edit");
  await assert.rejects(undoLocalSkillImport(applied), /changed/);
  assert.equal(
    await fs.readFile(path.join(destination, "research-skill", "SKILL.md"), "utf8"),
    "user edit",
  );
});

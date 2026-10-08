import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { readSkillContent } from "../src/skill-content.js";

async function createTemporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skill-content-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("reads a skill instruction file as plain text", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const instructionFile = path.join(directory, "SKILL.md");
  await fs.writeFile(instructionFile, "# Example\n\nNever execute this text.\n");

  const result = await readSkillContent(instructionFile);

  assert.equal(result.content, "# Example\n\nNever execute this text.\n");
  assert.equal(result.truncated, false);
});

test("bounds unusually large content previews", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const instructionFile = path.join(directory, "SKILL.md");
  await fs.writeFile(instructionFile, "0123456789");

  const result = await readSkillContent(instructionFile, 5);

  assert.equal(result.content, "01234");
  assert.equal(result.truncated, true);
});

test("rejects an invalid content limit", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const instructionFile = path.join(directory, "SKILL.md");
  await fs.writeFile(instructionFile, "content");

  await assert.rejects(() => readSkillContent(instructionFile, 0), /positive integer/);
});

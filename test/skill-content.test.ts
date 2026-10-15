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

test("rejects a skill file replaced by a symlink after scanning", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const instructionFile = path.join(directory, "SKILL.md");
  const privateFile = path.join(directory, "private.txt");
  await fs.writeFile(instructionFile, "# Public\n");
  await fs.writeFile(privateFile, "private content");
  const stats = await fs.lstat(instructionFile);
  await fs.unlink(instructionFile);
  await fs.symlink(privateFile, instructionFile);
  await assert.rejects(
    () => readSkillContent(instructionFile, undefined, { dev: stats.dev, ino: stats.ino }),
    /regular file|symbolic link/,
  );
});

test("rejects a different regular file after scanning", async (t) => {
  const directory = await createTemporaryDirectory(t);
  const instructionFile = path.join(directory, "SKILL.md");
  const replacement = path.join(directory, "replacement.md");
  await fs.writeFile(instructionFile, "# Original\n");
  const stats = await fs.lstat(instructionFile);
  await fs.writeFile(replacement, "# Replacement\n");
  await fs.rename(replacement, instructionFile);
  await assert.rejects(
    () => readSkillContent(instructionFile, undefined, { dev: stats.dev, ino: stats.ino }),
    /changed since the last scan/,
  );
});

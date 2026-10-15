import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import {
  hashRegularFile,
  openRegularFileNoFollow,
  readRegularFileBounded,
  readRegularFilePrefix,
} from "../src/safe-file.js";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-safe-file-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("reads only a bounded prefix and rejects an oversized full read", async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, "example.txt");
  await fs.writeFile(filePath, "abcdefghij");

  assert.equal((await readRegularFilePrefix(filePath, 4)).toString("utf8"), "abcd");
  assert.equal((await readRegularFileBounded(filePath, 10)).toString("utf8"), "abcdefghij");
  await assert.rejects(readRegularFileBounded(filePath, 9), /read safety limit/);
  await assert.rejects(hashRegularFile(filePath, 9), /fingerprint safety limit/);
  assert.equal(
    await hashRegularFile(filePath, 10),
    createHash("sha256").update("abcdefghij").digest("hex"),
  );
});

test("rejects symbolic links and non-files before opening them", async (t) => {
  const directory = await temporaryDirectory(t);
  const filePath = path.join(directory, "example.txt");
  const linkPath = path.join(directory, "alias.txt");
  await fs.writeFile(filePath, "example");
  await fs.symlink(filePath, linkPath);

  await assert.rejects(openRegularFileNoFollow(linkPath), /regular file/);
  await assert.rejects(readRegularFileBounded(linkPath, 10), /regular file/);
  await assert.rejects(openRegularFileNoFollow(directory), /regular file/);
});

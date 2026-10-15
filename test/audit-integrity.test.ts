import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  compareAuditFiles,
  mergeAuditFiles,
  readAuditFileBaseline,
  writeAuditFileBaseline,
} from "../src/audit/integrity.js";
import type { AuditFileRecord } from "../src/types.js";

function record(filePath: string, hash = "a".repeat(64)): AuditFileRecord {
  return {
    application: "chatgpt",
    itemKind: "skill",
    itemId: "skill-one",
    sourceFile: filePath,
    bytes: 10,
    sha256: hash,
    isScript: false,
  };
}

test("integrity comparison distinguishes changes without claiming uncertain removals", () => {
  const before = [record("/one"), record("/removed")];
  const current = [record("/one", "b".repeat(64)), record("/added")];
  assert.deepEqual(
    compareAuditFiles(current, before, false)
      .map((item) => item.type)
      .sort(),
    ["added", "modified"],
  );
  assert.ok(compareAuditFiles(current, before, true).some((item) => item.type === "removed"));
  assert.equal(compareAuditFiles(current, null, true).length, 0);
  assert.equal(mergeAuditFiles(current, before, false).length, 3);
  assert.equal(mergeAuditFiles(current, before, true).length, 2);
});

test("integrity baseline is bounded, validated, and rejects a symlink target", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-integrity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "audit.json");
  await writeAuditFileBaseline(filePath, [record("/somewhere/SKILL.md")]);
  assert.deepEqual(await readAuditFileBaseline(filePath), [record("/somewhere/SKILL.md")]);
  await fs.writeFile(filePath, JSON.stringify({ version: 1, files: [{ secret: "test" }] }));
  await assert.rejects(readAuditFileBaseline(filePath), /not replaced/);
  await fs.unlink(filePath);
  await fs.symlink(path.join(root, "elsewhere"), filePath);
  await assert.rejects(writeAuditFileBaseline(filePath, []), /not a regular file/);
});

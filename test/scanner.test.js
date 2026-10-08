import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { scanApplications, scanLocation } from "../src/scanner.js";

async function createTemporaryDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

function createApplication(id, locationPath) {
  return {
    id,
    displayName: id === "chatgpt" ? "ChatGPT" : "Claude",
    locations: [{ label: `${id} test skills`, path: locationPath, source: "default" }],
  };
}

test("finds a directory containing SKILL.md", async (t) => {
  const root = await createTemporaryDirectory(t);
  const skillDirectory = path.join(root, "pdf-tools");
  await fs.mkdir(skillDirectory);
  await fs.writeFile(path.join(skillDirectory, "SKILL.md"), "# PDF Tools\n");

  const result = await scanApplications({
    applications: [createApplication("chatgpt", root)],
  });

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, "pdf-tools");
  assert.equal(result.skills[0].application, "chatgpt");
  assert.equal(result.skills[0].instructionFile, path.join(skillDirectory, "SKILL.md"));
});

test("finds plugin-provided skills in nested directories", async (t) => {
  const root = await createTemporaryDirectory(t);
  const skillDirectory = path.join(root, "cache", "plugin-a", "skills", "review");
  await fs.mkdir(skillDirectory, { recursive: true });
  await fs.writeFile(path.join(skillDirectory, "SKILL.md"), "# Review\n");

  const result = await scanApplications({
    applications: [createApplication("claude", root)],
  });

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, "review");
});

test("does not scan inside node_modules", async (t) => {
  const root = await createTemporaryDirectory(t);
  const dependencySkill = path.join(root, "node_modules", "not-installed-skill");
  await fs.mkdir(dependencySkill, { recursive: true });
  await fs.writeFile(path.join(dependencySkill, "SKILL.md"), "# Ignore me\n");

  const result = await scanApplications({
    applications: [createApplication("chatgpt", root)],
  });

  assert.equal(result.skills.length, 0);
});

test("does not follow symbolic links", async (t) => {
  const root = await createTemporaryDirectory(t);
  const outside = await createTemporaryDirectory(t);
  await fs.writeFile(path.join(outside, "SKILL.md"), "# Outside\n");
  await fs.symlink(outside, path.join(root, "linked-skill"));

  const result = await scanApplications({
    applications: [createApplication("chatgpt", root)],
  });

  assert.equal(result.skills.length, 0);
});

test("reports a missing location without failing the scan", async () => {
  const missingPath = path.join(os.tmpdir(), `missing-${Date.now()}`);
  const application = createApplication("claude", missingPath);

  const result = await scanLocation({
    application,
    location: application.locations[0],
  });

  assert.equal(result.skills.length, 0);
  assert.equal(result.diagnostics.length, 1);
  assert.equal(result.diagnostics[0].code, "LOCATION_NOT_FOUND");
  assert.equal(result.diagnostics[0].severity, "info");
});

test("stops descending after it finds a skill root", async (t) => {
  const root = await createTemporaryDirectory(t);
  const skill = path.join(root, "parent-skill");
  const supportingFolder = path.join(skill, "examples", "nested");
  await fs.mkdir(supportingFolder, { recursive: true });
  await fs.writeFile(path.join(skill, "SKILL.md"), "# Parent\n");
  await fs.writeFile(path.join(supportingFolder, "SKILL.md"), "# Not separate\n");

  const result = await scanApplications({
    applications: [createApplication("chatgpt", root)],
  });

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, "parent-skill");
});

test("deduplicates identical Claude Desktop session snapshots", async (t) => {
  const root = await createTemporaryDirectory(t);
  const firstCopy = path.join(root, "account-a", "session-a", "skills", "pdf");
  const secondCopy = path.join(root, "account-a", "session-b", "skills", "pdf");
  await fs.mkdir(firstCopy, { recursive: true });
  await fs.mkdir(secondCopy, { recursive: true });
  await fs.writeFile(path.join(firstCopy, "SKILL.md"), "# PDF\nSame contents\n");
  await fs.writeFile(path.join(secondCopy, "SKILL.md"), "# PDF\nSame contents\n");

  const result = await scanApplications({
    applications: [createApplication("claude", root)],
  });

  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].name, "pdf");
  assert.equal("contentFingerprint" in result.skills[0], false);
});

test("keeps same-named skills when their contents differ", async (t) => {
  const root = await createTemporaryDirectory(t);
  const firstSkill = path.join(root, "plugin-a", "skills", "review");
  const secondSkill = path.join(root, "plugin-b", "skills", "review");
  await fs.mkdir(firstSkill, { recursive: true });
  await fs.mkdir(secondSkill, { recursive: true });
  await fs.writeFile(path.join(firstSkill, "SKILL.md"), "# Review A\n");
  await fs.writeFile(path.join(secondSkill, "SKILL.md"), "# Review B\n");

  const result = await scanApplications({
    applications: [createApplication("claude", root)],
  });

  assert.equal(result.skills.length, 2);
});

import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { discoverProjectSkillLocations } from "../src/projects.js";

async function createTemporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-project-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("discovers app-specific and shared project skill folders", async (t) => {
  const root = await createTemporaryDirectory(t);
  const project = path.join(root, "example-project");
  const codexStateFile = path.join(root, "codex-state.json");
  const claudeStateFile = path.join(root, "claude-state.json");

  await fs.mkdir(path.join(project, ".agents", "skills"), { recursive: true });
  await fs.mkdir(path.join(project, ".codex", "skills"), { recursive: true });
  await fs.mkdir(path.join(project, ".claude", "skills"), { recursive: true });
  await fs.writeFile(
    codexStateFile,
    JSON.stringify({
      "local-projects": {
        example: { name: "Example", rootPaths: [project] },
      },
    }),
  );
  await fs.writeFile(claudeStateFile, JSON.stringify({ projects: { [project]: {} } }));

  const locations = await discoverProjectSkillLocations({ codexStateFile, claudeStateFile });
  const pairs = locations.map(
    (item) => `${item.application}:${path.basename(path.dirname(item.location.path))}`,
  );

  assert.deepEqual(pairs.sort(), [
    "chatgpt:.agents",
    "chatgpt:.codex",
    "claude:.agents",
    "claude:.claude",
  ]);
  assert.ok(locations.every((item) => item.location.projectName === "Example"));
  assert.ok(locations.every((item) => item.location.projectId === "codex:example"));
  assert.ok(locations.every((item) => item.location.projectRoot === project));
});

test("keeps nested skill folders grouped under their registered project", async (t) => {
  const root = await createTemporaryDirectory(t);
  const registeredRoot = path.join(root, "workspace");
  const activeProject = path.join(registeredRoot, "active-project");
  const archivedProject = path.join(registeredRoot, "_archive", "old-project");
  const codexStateFile = path.join(root, "codex-state.json");
  const claudeStateFile = path.join(root, "missing-claude-state.json");

  await fs.mkdir(path.join(activeProject, ".codex", "skills"), { recursive: true });
  await fs.mkdir(path.join(archivedProject, ".codex", "skills"), { recursive: true });
  await fs.writeFile(
    codexStateFile,
    JSON.stringify({
      "local-projects": {
        workspace: { name: "Workspace", rootPaths: [registeredRoot] },
      },
    }),
  );

  const locations = await discoverProjectSkillLocations({ codexStateFile, claudeStateFile });

  assert.equal(locations.length, 1);
  assert.equal(locations[0].location.projectId, "codex:workspace");
  assert.equal(locations[0].location.projectName, "Workspace");
  assert.equal(locations[0].location.projectRoot, registeredRoot);
  assert.equal(locations[0].location.path, path.join(activeProject, ".codex", "skills"));
});

test("groups multiple attached folders under one Codex project", async (t) => {
  const root = await createTemporaryDirectory(t);
  const firstRoot = path.join(root, "app");
  const secondRoot = path.join(root, "docs");
  const codexStateFile = path.join(root, "codex-state.json");
  const claudeStateFile = path.join(root, "missing-claude-state.json");

  await fs.mkdir(path.join(firstRoot, ".codex", "skills"), { recursive: true });
  await fs.mkdir(path.join(secondRoot, ".codex", "skills"), { recursive: true });
  await fs.writeFile(
    codexStateFile,
    JSON.stringify({
      "local-projects": {
        product: { name: "Product", rootPaths: [firstRoot, secondRoot] },
      },
    }),
  );

  const locations = await discoverProjectSkillLocations({ codexStateFile, claudeStateFile });

  assert.equal(locations.length, 2);
  assert.ok(locations.every((item) => item.location.projectId === "codex:product"));
  assert.ok(locations.every((item) => item.location.projectName === "Product"));
  assert.deepEqual(
    locations.map((item) => item.location.projectRoot).sort(),
    [firstRoot, secondRoot].sort(),
  );
});

test("prefers the closest project when registered roots overlap", async (t) => {
  const root = await createTemporaryDirectory(t);
  const broadRoot = path.join(root, "Documents");
  const specificRoot = path.join(broadRoot, "Job Apps");
  const skillsPath = path.join(specificRoot, "resume-tools", ".agents", "skills");
  const codexStateFile = path.join(root, "codex-state.json");
  const claudeStateFile = path.join(root, "claude-state.json");

  await fs.mkdir(skillsPath, { recursive: true });
  await fs.writeFile(
    codexStateFile,
    JSON.stringify({
      "local-projects": {
        jobs: { name: "Job Apps", rootPaths: [specificRoot] },
      },
    }),
  );
  await fs.writeFile(claudeStateFile, JSON.stringify({ projects: { [broadRoot]: {} } }));

  const locations = await discoverProjectSkillLocations({ codexStateFile, claudeStateFile });
  const sharedLocations = locations.filter((item) => item.location.path === skillsPath);

  assert.equal(sharedLocations.length, 2);
  assert.ok(sharedLocations.every((item) => item.location.projectName === "Job Apps"));
  assert.ok(sharedLocations.every((item) => item.location.projectRoot === specificRoot));
});

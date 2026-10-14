import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { type TestContext } from "node:test";
import { attachPluginSkills, discoverPlugins } from "../src/plugins.js";
import type { DiscoveredSkill } from "../src/types.js";

async function temporaryDirectory(t: TestContext): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "skillmanager-plugins-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("discovers a Codex plugin and its packaged components without executing them", async (t) => {
  const root = await temporaryDirectory(t);
  const pluginRoot = path.join(root, "cache", "openai-curated-remote", "docs", "1.2.3");
  await fs.mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  await fs.mkdir(path.join(pluginRoot, "hooks"), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({
        name: "docs",
        version: "1.2.3",
        description: "Search documentation.",
        author: { name: "Example" },
        license: "MIT",
        mcpServers: "./.mcp.json",
        apps: "./.app.json",
      }),
    ),
    fs.writeFile(
      path.join(pluginRoot, ".mcp.json"),
      JSON.stringify({ mcpServers: { docs_search: { url: "https://example.com/mcp" } } }),
    ),
    fs.writeFile(
      path.join(pluginRoot, ".app.json"),
      JSON.stringify({ apps: { documentation: { id: "connector" } } }),
    ),
    fs.writeFile(path.join(pluginRoot, "hooks", "hooks.json"), "{}"),
  ]);

  const result = await discoverPlugins({
    locations: [
      {
        application: "chatgpt",
        path: root,
        origin: "local",
        originName: "Codex plugins",
      },
    ],
  });

  assert.equal(result.plugins.length, 1);
  assert.equal(result.plugins[0]?.displayName, "docs");
  assert.equal(result.plugins[0]?.version, "1.2.3");
  assert.equal(result.plugins[0]?.origin, "marketplace");
  assert.deepEqual(
    result.plugins[0]?.mcpServers.map((server) => server.name),
    ["docs_search"],
  );
  assert.deepEqual(result.plugins[0]?.apps, ["documentation"]);
  assert.equal(result.plugins[0]?.hasHooks, true);
});

test("prefers a portable root manifest over an application compatibility overlay", async (t) => {
  const root = await temporaryDirectory(t);
  const pluginRoot = path.join(root, "portable");
  await fs.mkdir(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  await Promise.all([
    fs.writeFile(
      path.join(pluginRoot, "plugin.json"),
      JSON.stringify({ name: "portable-name", version: "2.0.0", description: "Portable." }),
    ),
    fs.writeFile(
      path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "legacy-name", version: "1.0.0", description: "Legacy." }),
    ),
  ]);

  const result = await discoverPlugins({
    locations: [
      {
        application: "chatgpt",
        path: root,
        origin: "local",
        originName: "Local",
      },
    ],
  });

  assert.equal(result.plugins.length, 1);
  assert.equal(result.plugins[0]?.name, "portable-name");
  assert.equal(result.plugins[0]?.manifestFormat, "portable");
});

test("uses Claude install records and excludes marketplace catalog copies", async (t) => {
  const home = await temporaryDirectory(t);
  const installedRoot = path.join(
    home,
    ".claude",
    "plugins",
    "cache",
    "team",
    "installed",
    "1.0.0",
  );
  const catalogRoot = path.join(
    home,
    ".claude",
    "plugins",
    "marketplaces",
    "team",
    "plugins",
    "catalog-only",
  );
  await Promise.all([
    fs.mkdir(path.join(installedRoot, ".claude-plugin"), { recursive: true }),
    fs.mkdir(path.join(catalogRoot, ".claude-plugin"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(
      path.join(installedRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "installed", description: "Installed plugin." }),
    ),
    fs.writeFile(
      path.join(catalogRoot, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "catalog-only", description: "Not installed." }),
    ),
    fs.writeFile(
      path.join(home, ".claude", "plugins", "installed_plugins.json"),
      JSON.stringify({
        version: 2,
        plugins: {
          "installed@team": [{ scope: "user", installPath: installedRoot, version: "1.0.0" }],
        },
      }),
    ),
  ]);

  const result = await discoverPlugins({ homeDirectory: home, projects: [] });

  assert.deepEqual(
    result.plugins.map((plugin) => plugin.name),
    ["installed"],
  );
  assert.equal(result.plugins[0]?.application, "claude");
  assert.equal(result.plugins[0]?.originName, "Team");
});

test("reports a malformed Claude install record without scanning its marketplace catalog", async (t) => {
  const home = await temporaryDirectory(t);
  await fs.mkdir(path.join(home, ".claude", "plugins"), { recursive: true });
  await fs.writeFile(path.join(home, ".claude", "plugins", "installed_plugins.json"), "{");

  const result = await discoverPlugins({ homeDirectory: home, projects: [] });

  assert.deepEqual(result.plugins, []);
  assert.equal(result.diagnostics[0]?.code, "PLUGIN_RECORD_INVALID");
});

test("reports malformed manifests and attaches only skills within a plugin root", async (t) => {
  const root = await temporaryDirectory(t);
  const validRoot = path.join(root, "valid");
  const invalidRoot = path.join(root, "invalid");
  await Promise.all([
    fs.mkdir(path.join(validRoot, ".codex-plugin"), { recursive: true }),
    fs.mkdir(path.join(invalidRoot, ".codex-plugin"), { recursive: true }),
  ]);
  await Promise.all([
    fs.writeFile(
      path.join(validRoot, ".codex-plugin", "plugin.json"),
      JSON.stringify({ name: "valid", description: "Valid plugin." }),
    ),
    fs.writeFile(path.join(invalidRoot, ".codex-plugin", "plugin.json"), "{"),
  ]);
  const result = await discoverPlugins({
    locations: [{ application: "chatgpt", path: root, origin: "local", originName: "Local" }],
  });
  const insideFile = path.join(validRoot, "skills", "inside", "SKILL.md");
  const outsideFile = path.join(root, "outside", "SKILL.md");
  const baseSkill: DiscoveredSkill = {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "inside",
    folderName: "inside",
    description: null,
    metadataStatus: "valid",
    metadataIssues: [],
    directory: path.dirname(insideFile),
    instructionFile: insideFile,
    source: "plugin-cache",
    sourceName: "Plugin cache",
    sourceLabel: "Plugins",
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    modifiedAt: null,
  };
  const plugins = attachPluginSkills(result.plugins, [
    baseSkill,
    {
      ...baseSkill,
      name: "outside",
      directory: path.dirname(outsideFile),
      instructionFile: outsideFile,
    },
  ]);

  assert.equal(result.diagnostics[0]?.code, "PLUGIN_MANIFEST_INVALID");
  assert.deepEqual(
    plugins[0]?.skills.map((skill) => skill.name),
    ["inside"],
  );
});

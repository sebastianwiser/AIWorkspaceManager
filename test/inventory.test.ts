import assert from "node:assert/strict";
import test from "node:test";
import {
  createInventoryView,
  createMcpInventoryView,
  createPluginInventoryView,
  getSkillIdentity,
} from "../src/inventory.js";
import type { DiscoveredMcpServer, DiscoveredPlugin, DiscoveredSkill } from "../src/types.js";

function createSkill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "example",
    folderName: "example-folder",
    description: "Example skill.",
    metadataStatus: "valid",
    metadataIssues: [],
    directory: "/tmp/example",
    instructionFile: "/tmp/example/SKILL.md",
    source: "personal",
    sourceName: "Personal",
    sourceLabel: "Test skills",
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    modifiedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

function createMcpServer(overrides: Partial<DiscoveredMcpServer> = {}): DiscoveredMcpServer {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "docs",
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    transport: "http",
    command: null,
    arguments: [],
    url: "https://example.com/mcp",
    environmentVariables: [],
    headerNames: [],
    configurationFile: "/tmp/config.toml",
    configurationFormat: "toml",
    safeConfiguration: "",
    endpointMatchId: null,
    status: "valid",
    issues: [],
    ...overrides,
  };
}

function createPlugin(overrides: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "documents",
    displayName: "Documents",
    version: "1.0.0",
    description: "Create and edit documents.",
    author: "OpenAI",
    license: "MIT",
    homepage: null,
    repository: null,
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    origin: "bundled",
    originName: "OpenAI bundled",
    installationStatus: "bundled",
    directory: "/tmp/documents",
    manifestFile: "/tmp/documents/.codex-plugin/plugin.json",
    manifestFormat: "codex",
    skills: [{ name: "documents", instructionFile: "/tmp/documents/skills/documents/SKILL.md" }],
    mcpServers: [],
    apps: [],
    hasHooks: false,
    status: "valid",
    issues: [],
    modifiedAt: "2026-01-02T00:00:00.000Z",
    ...overrides,
  };
}

test("filters skills by application, source, and metadata status", () => {
  const skills = [
    createSkill({ name: "personal-valid" }),
    createSkill({ name: "system-valid", source: "system", sourceName: "System" }),
    createSkill({
      application: "claude",
      applicationName: "Claude",
      name: "plugin-invalid",
      source: "plugin",
      sourceName: "Plugin",
      metadataStatus: "invalid",
    }),
  ];

  const result = createInventoryView(skills, {
    applicationIds: ["claude"],
    sources: ["plugin"],
    metadataStatuses: ["invalid"],
  });

  assert.deepEqual(
    result.map((skill) => skill.name),
    ["plugin-invalid"],
  );
});

test("gives shared skill files a separate identity for each application", () => {
  const instructionFile = "/projects/shared/.agents/skills/example/SKILL.md";
  const chatGptSkill = createSkill({ instructionFile });
  const claudeSkill = createSkill({
    application: "claude",
    applicationName: "Claude",
    instructionFile,
  });

  assert.notEqual(getSkillIdentity(chatGptSkill), getSkillIdentity(claudeSkill));
  assert.equal(getSkillIdentity(chatGptSkill), getSkillIdentity({ ...chatGptSkill }));
});

test("searches names, folder names, and descriptions without case sensitivity", () => {
  const skills = [
    createSkill({ name: "PDF tools", description: "Edit documents." }),
    createSkill({ name: "slides", folderName: "presentation-builder" }),
    createSkill({ name: "sheets", description: "Analyze FINANCIAL data." }),
  ];

  assert.deepEqual(
    createInventoryView(skills, { query: "pdf" }).map((skill) => skill.name),
    ["PDF tools"],
  );
  assert.deepEqual(
    createInventoryView(skills, { query: "PRESENTATION" }).map((skill) => skill.name),
    ["slides"],
  );
  assert.deepEqual(
    createInventoryView(skills, { query: "financial" }).map((skill) => skill.name),
    ["sheets"],
  );
});

test("uses OR within one filter and AND between different filters", () => {
  const skills = [
    createSkill({ name: "valid-personal" }),
    createSkill({ name: "invalid-personal", metadataStatus: "invalid" }),
    createSkill({
      name: "missing-plugin",
      source: "plugin",
      sourceName: "Plugin",
      metadataStatus: "missing",
    }),
  ];

  const result = createInventoryView(skills, {
    sources: ["personal", "plugin"],
    metadataStatuses: ["invalid", "missing"],
  });

  assert.deepEqual(
    result.map((skill) => skill.name),
    ["invalid-personal", "missing-plugin"],
  );
});

test("filters global skills and individual projects", () => {
  const skills = [
    createSkill({ name: "global" }),
    createSkill({
      name: "project-a",
      scope: "project",
      source: "project",
      sourceName: "Project",
      projectId: "project-alpha",
      projectName: "Alpha",
      projectRoot: "/projects/alpha",
    }),
    createSkill({
      name: "project-b",
      scope: "project",
      source: "project",
      sourceName: "Project",
      projectId: "project-beta",
      projectName: "Beta",
      projectRoot: "/projects/beta",
    }),
  ];

  assert.deepEqual(
    createInventoryView(skills, { scopes: ["global"] }).map((skill) => skill.name),
    ["global"],
  );
  assert.deepEqual(
    createInventoryView(skills, { projectIds: ["project-beta"] }).map((skill) => skill.name),
    ["project-b"],
  );
});

test("sorts by name in ascending or descending order", () => {
  const skills = [createSkill({ name: "beta" }), createSkill({ name: "Alpha" })];

  assert.deepEqual(
    createInventoryView(skills, { sortBy: "name" }).map((skill) => skill.name),
    ["Alpha", "beta"],
  );
  assert.deepEqual(
    createInventoryView(skills, { sortBy: "name", sortOrder: "desc" }).map((skill) => skill.name),
    ["beta", "Alpha"],
  );
});

test("sorts by application and source", () => {
  const skills = [
    createSkill({ name: "system", source: "system", sourceName: "System" }),
    createSkill({
      application: "claude",
      applicationName: "Claude",
      name: "plugin",
      source: "plugin",
      sourceName: "Plugin",
    }),
    createSkill({ name: "personal" }),
  ];

  assert.deepEqual(
    createInventoryView(skills, { sortBy: "application" }).map((skill) => skill.name),
    ["personal", "system", "plugin"],
  );
  assert.deepEqual(
    createInventoryView(skills, { sortBy: "source" }).map((skill) => skill.name),
    ["personal", "plugin", "system"],
  );
});

test("sorts modified dates while keeping unavailable dates last", () => {
  const skills = [
    createSkill({ name: "older", modifiedAt: "2026-01-01T00:00:00.000Z" }),
    createSkill({ name: "unknown", modifiedAt: null }),
    createSkill({ name: "placeholder", modifiedAt: "1970-01-01T00:00:01.000Z" }),
    createSkill({ name: "newer", modifiedAt: "2026-02-01T00:00:00.000Z" }),
  ];

  assert.deepEqual(
    createInventoryView(skills, { sortBy: "modified", sortOrder: "desc" }).map(
      (skill) => skill.name,
    ),
    ["newer", "older", "placeholder", "unknown"],
  );
  assert.deepEqual(
    createInventoryView(skills, { sortBy: "modified", sortOrder: "asc" }).map(
      (skill) => skill.name,
    ),
    ["older", "newer", "placeholder", "unknown"],
  );
});

test("does not mutate the scanner's original array", () => {
  const skills = [createSkill({ name: "beta" }), createSkill({ name: "alpha" })];
  const originalOrder = skills.map((skill) => skill.name);

  createInventoryView(skills, { sortBy: "name" });

  assert.deepEqual(
    skills.map((skill) => skill.name),
    originalOrder,
  );
});

test("filters MCP servers by application, project, and search text", () => {
  const servers = [
    createMcpServer(),
    createMcpServer({
      application: "claude",
      applicationName: "Claude",
      name: "database",
      scope: "project",
      projectId: "claude:project",
      projectName: "Research",
      projectRoot: "/tmp/research",
      transport: "stdio",
      command: "node",
      url: null,
      configurationFile: "/tmp/research/.mcp.json",
      configurationFormat: "json",
    }),
  ];

  assert.deepEqual(
    createMcpInventoryView(servers, {
      applicationIds: ["claude"],
      projectIds: ["claude:project"],
      query: "research",
    }).map((server) => server.name),
    ["database"],
  );
  assert.deepEqual(
    createMcpInventoryView(servers, { scopes: ["global"] }).map((server) => server.name),
    ["docs"],
  );
});

test("filters plugins and searches their included components", () => {
  const plugins = [
    createPlugin(),
    createPlugin({
      application: "claude",
      applicationName: "Claude",
      name: "research",
      displayName: "Research",
      directory: "/tmp/research",
      manifestFile: "/tmp/research/.claude-plugin/plugin.json",
      scope: "project",
      projectId: "claude:project",
      projectName: "Research project",
      projectRoot: "/tmp/project",
      status: "incomplete",
      skills: [],
      mcpServers: [{ name: "paper-search", configurationFile: "/tmp/research/.mcp.json" }],
    }),
  ];

  assert.deepEqual(
    createPluginInventoryView(plugins, {
      applicationIds: ["claude"],
      projectIds: ["claude:project"],
      statuses: ["incomplete"],
      query: "paper-search",
    }).map((plugin) => plugin.name),
    ["research"],
  );
});

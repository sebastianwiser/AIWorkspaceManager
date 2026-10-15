import assert from "node:assert/strict";
import test from "node:test";
import { createRelationshipMap } from "../src/relationships.js";
import type {
  DiscoveredMcpServer,
  DiscoveredPlugin,
  DiscoveredSkill,
  ScanResult,
} from "../src/types.js";

function skill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "research",
    folderName: "research",
    description: null,
    metadataStatus: "valid",
    metadataIssues: [],
    directory: "/plugins/research/skills/research",
    instructionFile: "/plugins/research/skills/research/SKILL.md",
    source: "plugin",
    sourceName: "Plugin",
    sourceLabel: "Plugins",
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    modifiedAt: null,
    ...overrides,
  };
}

function server(overrides: Partial<DiscoveredMcpServer> = {}): DiscoveredMcpServer {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "research",
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    transport: "stdio",
    command: "[REDACTED]",
    arguments: [],
    url: null,
    environmentVariables: ["API_KEY"],
    headerNames: [],
    configurationFile: "/config.toml",
    configurationFormat: "toml",
    safeConfiguration: "[REDACTED]",
    endpointMatchId: null,
    status: "valid",
    issues: [],
    ...overrides,
  };
}

function plugin(overrides: Partial<DiscoveredPlugin> = {}): DiscoveredPlugin {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "research",
    displayName: "Research",
    version: "1.0.0",
    description: null,
    author: null,
    license: null,
    homepage: null,
    repository: null,
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
    origin: "local",
    originName: "Local",
    installationStatus: "confirmed",
    directory: "/plugins/research",
    manifestFile: "/plugins/research/plugin.json",
    manifestFormat: "portable",
    skills: [{ name: "research", instructionFile: "/plugins/research/skills/research/SKILL.md" }],
    mcpServers: [{ name: "research", configurationFile: "/plugins/research/.mcp.json" }],
    apps: [],
    hasHooks: false,
    status: "valid",
    issues: [],
    modifiedAt: null,
    ...overrides,
  };
}

function scan(overrides: Partial<ScanResult> = {}): ScanResult {
  return { skills: [], mcpServers: [], plugins: [], diagnostics: [], ...overrides };
}

test("connects a plugin to exact discovered skill files, without claiming packaged MCP is configured", () => {
  const map = createRelationshipMap(
    scan({ skills: [skill()], plugins: [plugin()], mcpServers: [server()] }),
  );

  assert.equal(map.scopes.length, 1);
  assert.equal(map.scopes[0].plugins[0].skills.length, 1);
  assert.equal(map.scopes[0].plugins[0].configuredMcpServers.length, 0);
  assert.equal(map.scopes[0].plugins[0].packagedMcpServers.length, 1);
  assert.equal(map.scopes[0].otherSkills.length, 0);
  assert.equal(map.scopes[0].otherMcpServers.length, 1);
});

test("links a packaged MCP only when its application, scope, name, and file match a configured server", () => {
  const bundled = plugin();
  const configured = server({ configurationFile: "/plugins/research/.mcp.json" });
  const map = createRelationshipMap(scan({ plugins: [bundled], mcpServers: [configured] }));

  assert.equal(map.scopes[0].plugins[0].configuredMcpServers.length, 1);
  assert.equal(map.scopes[0].otherMcpServers.length, 0);

  const otherScope = createRelationshipMap(
    scan({
      plugins: [bundled],
      mcpServers: [
        server({
          configurationFile: "/plugins/research/.mcp.json",
          scope: "project",
          projectId: "project-1",
          projectName: "Project 1",
          projectRoot: "/projects/one",
        }),
      ],
    }),
  );
  assert.equal(otherScope.scopes[0].plugins[0].configuredMcpServers.length, 0);
  assert.equal(otherScope.scopes[1].otherMcpServers.length, 1);
});

test("separates application and project locations even for a shared skill file", () => {
  const shared = skill({
    source: "project",
    sourceName: "Project",
    scope: "project",
    projectId: "project-1",
    projectName: "Project 1",
    projectRoot: "/projects/one",
    instructionFile: "/projects/one/.agents/skills/research/SKILL.md",
  });
  const map = createRelationshipMap(
    scan({
      skills: [shared, { ...shared, application: "claude", applicationName: "Claude" }],
    }),
  );

  assert.equal(map.scopes.length, 2);
  assert.equal(map.scopes[0].otherSkills.length, 1);
  assert.equal(map.scopes[1].otherSkills.length, 1);
  assert.equal(map.skillConnections[0].matchBasis, "shared-location");
});

test("keeps multiple registered folders visible under one project identity", () => {
  const map = createRelationshipMap(
    scan({
      skills: [
        skill({
          scope: "project",
          projectId: "workspace",
          projectName: "Workspace",
          projectRoot: "/projects/one",
        }),
        skill({
          name: "writing",
          instructionFile: "/projects/two/writing/SKILL.md",
          scope: "project",
          projectId: "workspace",
          projectName: "Workspace",
          projectRoot: "/projects/two",
        }),
      ],
    }),
  );

  assert.equal(map.scopes.length, 1);
  assert.deepEqual(map.scopes[0].projectRoots, ["/projects/one", "/projects/two"]);
  assert.equal(map.scopes[0].otherSkills.length, 2);
});

test("retains a name-only cross-app candidate without merging original records", () => {
  const map = createRelationshipMap(
    scan({
      skills: [
        skill(),
        skill({
          application: "claude",
          applicationName: "Claude",
          directory: "/claude/research",
          instructionFile: "/claude/research/SKILL.md",
        }),
      ],
      mcpServers: [
        server(),
        server({
          application: "claude",
          applicationName: "Claude",
          configurationFile: "/claude/mcp.json",
        }),
      ],
    }),
  );

  assert.equal(map.skillConnections[0].matchBasis, "matching-name");
  assert.equal(map.mcpConnections[0].matchBasis, "matching-name");
  assert.equal(map.skillConnections[0].definitions.length, 2);
  assert.equal(map.scopes.length, 2);
});

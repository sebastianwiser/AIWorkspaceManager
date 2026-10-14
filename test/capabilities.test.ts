import assert from "node:assert/strict";
import test from "node:test";
import {
  createMcpCapabilityGroups,
  createSkillCapabilityGroups,
  normalizeCapabilityName,
} from "../src/capabilities.js";
import type { DiscoveredMcpServer, DiscoveredSkill } from "../src/types.js";

function skill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "documents",
    folderName: "documents",
    description: null,
    metadataStatus: "valid",
    metadataIssues: [],
    directory: "/skills/documents",
    instructionFile: "/skills/documents/SKILL.md",
    source: "personal",
    sourceName: "Personal",
    sourceLabel: "Skills",
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
    configurationFile: "/config.toml",
    configurationFormat: "toml",
    safeConfiguration: "",
    status: "valid",
    issues: [],
    ...overrides,
  };
}

test("normalizes capability names without erasing meaningful punctuation", () => {
  assert.equal(normalizeCapabilityName("  My   Skill  "), "my skill");
  assert.notEqual(normalizeCapabilityName("my-skill"), normalizeCapabilityName("my skill"));
});

test("groups shared skill files across applications with strong evidence", () => {
  const groups = createSkillCapabilityGroups([
    skill(),
    skill({ application: "claude", applicationName: "Claude" }),
  ]);

  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].applications, ["chatgpt", "claude"]);
  assert.equal(groups[0].matchBasis, "shared-location");
  assert.equal(groups[0].definitions.length, 2);
});

test("treats same-name skills at different locations as a reviewable candidate", () => {
  const [group] = createSkillCapabilityGroups([
    skill(),
    skill({
      application: "claude",
      applicationName: "Claude",
      directory: "/claude/documents",
      instructionFile: "/claude/documents/SKILL.md",
    }),
  ]);

  assert.equal(group.matchBasis, "matching-name");
});

test("groups same-name MCP definitions and explains endpoint evidence", () => {
  const exact = createMcpCapabilityGroups([
    server(),
    server({ application: "claude", applicationName: "Claude", configurationFile: "/mcp.json" }),
  ])[0];
  const candidate = createMcpCapabilityGroups([
    server(),
    server({
      application: "claude",
      applicationName: "Claude",
      url: "https://other.example.com/mcp",
      configurationFile: "/mcp.json",
    }),
  ])[0];

  assert.equal(exact.matchBasis, "shared-endpoint");
  assert.equal(candidate.matchBasis, "matching-name");
});

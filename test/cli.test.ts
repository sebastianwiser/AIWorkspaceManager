import assert from "node:assert/strict";
import test from "node:test";
import { formatDetailedSkillGroups, formatSkillGroups, parseArguments } from "../src/cli.js";
import type { ApplicationIdentity, DiscoveredSkill } from "../src/types.js";

function createSkill(overrides: Partial<DiscoveredSkill> = {}): DiscoveredSkill {
  return {
    application: "chatgpt",
    applicationName: "ChatGPT",
    name: "example",
    folderName: "example",
    description: "Example skill.",
    metadataStatus: "valid",
    metadataIssues: [],
    directory: "/tmp/example",
    instructionFile: "/tmp/example/SKILL.md",
    source: "personal",
    sourceName: "Personal",
    sourceLabel: "Test skills",
    modifiedAt: null,
    ...overrides,
  };
}

test("parses a ChatGPT scan command", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "chatgpt"]), {
    application: "chatgpt",
    details: false,
    json: false,
    help: false,
    search: null,
    sources: [],
    metadataStatuses: [],
    sortBy: "application",
    sortOrder: "asc",
  });
});

test("parses JSON output", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "all", "--json"]), {
    application: "all",
    details: false,
    json: true,
    help: false,
    search: null,
    sources: [],
    metadataStatuses: [],
    sortBy: "application",
    sortOrder: "asc",
  });
});

test("parses detailed output", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "claude", "--details"]), {
    application: "claude",
    details: true,
    json: false,
    help: false,
    search: null,
    sources: [],
    metadataStatuses: [],
    sortBy: "application",
    sortOrder: "asc",
  });
});

test("parses inventory filters and sorting", () => {
  assert.deepEqual(
    parseArguments([
      "scan",
      "--app",
      "all",
      "--search",
      "document",
      "--source",
      "personal,plugin",
      "--source",
      "system",
      "--status",
      "valid,incomplete",
      "--sort",
      "modified",
      "--order",
      "desc",
    ]),
    {
      application: "all",
      details: false,
      json: false,
      help: false,
      search: "document",
      sources: ["personal", "plugin", "system"],
      metadataStatuses: ["valid", "incomplete"],
      sortBy: "modified",
      sortOrder: "desc",
    },
  );
});

test("rejects an unsupported application", () => {
  assert.throws(() => parseArguments(["scan", "--app", "other"]), /Unsupported application/);
});

test("rejects unknown arguments", () => {
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/);
});

test("rejects unsupported inventory filter values", () => {
  assert.throws(() => parseArguments(["--source", "remote"]), /Unsupported source/);
  assert.throws(() => parseArguments(["--status", "broken"]), /Unsupported status/);
  assert.throws(() => parseArguments(["--sort", "size"]), /Unsupported sort/);
  assert.throws(() => parseArguments(["--order", "sideways"]), /Unsupported order/);
});

test("requires values after inventory options", () => {
  assert.throws(() => parseArguments(["--search"]), /--search requires a value/);
  assert.throws(() => parseArguments(["--source", "--json"]), /--source requires a value/);
});

test("groups human-readable skill output by application", () => {
  const applications: ApplicationIdentity[] = [
    { id: "chatgpt", displayName: "ChatGPT" },
    { id: "claude", displayName: "Claude" },
  ];
  const skills = [createSkill({ name: "pdf" }), createSkill({ name: "presentations" })];

  assert.equal(
    formatSkillGroups(skills, applications),
    ["ChatGPT", "  pdf", "  presentations", "", "Claude", "  No local skills found.", ""].join(
      "\n",
    ),
  );
});

test("marks same-named definitions as variants in simple output", () => {
  const applications: ApplicationIdentity[] = [{ id: "claude", displayName: "Claude" }];
  const skills = [
    createSkill({ application: "claude", applicationName: "Claude", name: "review" }),
    createSkill({ application: "claude", applicationName: "Claude", name: "review" }),
  ];

  assert.match(formatSkillGroups(skills, applications), /review \(2 variants\)/);
});

test("formats descriptions and source information in detailed output", () => {
  const applications: ApplicationIdentity[] = [{ id: "chatgpt", displayName: "ChatGPT" }];
  const skills = [
    createSkill({
      name: "pdf",
      description: "Work with PDF files.",
      sourceName: "Plugin cache",
      directory: "/tmp/pdf",
    }),
  ];

  const output = formatDetailedSkillGroups(skills, applications);
  assert.match(output, /Description: Work with PDF files\./);
  assert.match(output, /Source: Plugin cache/);
  assert.match(output, /Metadata: Valid/);
});

test("marks missing metadata in simple output", () => {
  const applications: ApplicationIdentity[] = [{ id: "chatgpt", displayName: "ChatGPT" }];
  const skills = [
    createSkill({
      name: "legacy-skill",
      metadataStatus: "missing",
    }),
  ];

  assert.match(formatSkillGroups(skills, applications), /legacy-skill \[metadata: missing\]/);
});

test("strips terminal control sequences from human-readable output", () => {
  const applications: ApplicationIdentity[] = [{ id: "chatgpt", displayName: "ChatGPT" }];
  const skills = [
    createSkill({
      name: "\u001b[31mdanger\u001b[0m",
    }),
  ];

  const output = formatSkillGroups(skills, applications);
  assert.match(output, /danger/);
  assert.equal(output.includes("\u001b"), false);
});

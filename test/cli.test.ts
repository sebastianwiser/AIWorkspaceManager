import assert from "node:assert/strict";
import test from "node:test";
import {
  formatAuditReport,
  formatDetailedSkillGroups,
  formatSkillGroups,
  parseArguments,
} from "../src/cli.js";
import type { ApplicationIdentity, AuditReport, DiscoveredSkill } from "../src/types.js";

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
    scope: "global",
    projectId: null,
    projectName: null,
    projectRoot: null,
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
    kind: "skills",
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
    kind: "skills",
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
    kind: "skills",
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
      kind: "skills",
      search: "document",
      sources: ["personal", "plugin", "system"],
      metadataStatuses: ["valid", "incomplete"],
      sortBy: "modified",
      sortOrder: "desc",
    },
  );
});

test("parses MCP inventory output", () => {
  assert.equal(parseArguments(["scan", "--kind", "mcp", "--app", "all"]).kind, "mcp");
});

test("parses plugin inventory output", () => {
  assert.equal(parseArguments(["scan", "--kind", "plugins", "--app", "all"]).kind, "plugins");
});

test("parses read-only audit output and formats coverage without raw evidence", () => {
  assert.equal(parseArguments(["scan", "--kind", "audit", "--app", "all"]).kind, "audit");
  const report: AuditReport = {
    generatedAt: "2026-10-15T00:00:00.000Z",
    findings: [
      {
        id: "one",
        ruleId: "file.credential-pattern",
        family: "exposure",
        severity: "warning",
        confidence: "possible",
        title: "Credential-like text found",
        explanation: "A pattern was observed.",
        remedy: "Inspect the line privately.",
        application: "chatgpt",
        itemKind: "skill",
        itemIds: ["one"],
        sourceFile: "/skills/SKILL.md",
        line: 2,
        evidence: "Only a signal was retained.",
      },
    ],
    coverage: [
      {
        application: "chatgpt",
        family: "exposure",
        status: "partial",
        reasons: ["file-not-inspected"],
      },
    ],
  };
  const output = formatAuditReport(report, { details: true, search: null });
  assert.match(output, /Credential-like text found/);
  assert.match(output, /Coverage is incomplete/);
  assert.match(output, /No server or command was run/);
});

test("summarizes a long audit by default while details includes every finding", () => {
  const findings: AuditReport["findings"] = Array.from({ length: 32 }, (_, index) => ({
    id: `finding-${index}`,
    ruleId: "file.unreadable",
    family: "structure",
    severity: "warning",
    confidence: "observed",
    title: `Finding ${index}`,
    explanation: "The file was unreadable.",
    remedy: "Review it.",
    application: "chatgpt",
    itemKind: "skill",
    itemIds: [`skill-${index}`],
    sourceFile: `/skills/${index}/SKILL.md`,
    line: null,
    evidence: "Bounded read failed.",
  }));
  const report: AuditReport = { generatedAt: "2026-10-15T00:00:00.000Z", findings, coverage: [] };
  assert.match(formatAuditReport(report, { details: false, search: null }), /Showing the first 30/);
  assert.doesNotMatch(formatAuditReport(report, { details: false, search: null }), /Finding 31/);
  assert.match(formatAuditReport(report, { details: true, search: null }), /Finding 31/);
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

test("accepts the project source filter", () => {
  assert.deepEqual(parseArguments(["--source", "project"]).sources, ["project"]);
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

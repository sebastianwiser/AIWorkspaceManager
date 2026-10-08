import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDetailedSkillGroups,
  formatSkillGroups,
  parseArguments,
} from "../src/cli.js";

test("parses a ChatGPT scan command", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "chatgpt"]), {
    application: "chatgpt",
    details: false,
    json: false,
    help: false,
  });
});

test("parses JSON output", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "all", "--json"]), {
    application: "all",
    details: false,
    json: true,
    help: false,
  });
});

test("parses detailed output", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "claude", "--details"]), {
    application: "claude",
    details: true,
    json: false,
    help: false,
  });
});

test("rejects an unsupported application", () => {
  assert.throws(
    () => parseArguments(["scan", "--app", "other"]),
    /Unsupported application/,
  );
});

test("rejects unknown arguments", () => {
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/);
});

test("groups human-readable skill output by application", () => {
  const applications = [
    { id: "chatgpt", displayName: "ChatGPT" },
    { id: "claude", displayName: "Claude" },
  ];
  const skills = [
    { application: "chatgpt", name: "pdf", metadataStatus: "valid" },
    { application: "chatgpt", name: "presentations", metadataStatus: "valid" },
  ];

  assert.equal(
    formatSkillGroups(skills, applications),
    [
      "ChatGPT",
      "  pdf",
      "  presentations",
      "",
      "Claude",
      "  No local skills found.",
      "",
    ].join("\n"),
  );
});

test("marks same-named definitions as variants in simple output", () => {
  const applications = [{ id: "claude", displayName: "Claude" }];
  const skills = [
    { application: "claude", name: "review", metadataStatus: "valid" },
    { application: "claude", name: "review", metadataStatus: "valid" },
  ];

  assert.match(formatSkillGroups(skills, applications), /review \(2 variants\)/);
});

test("formats descriptions and source information in detailed output", () => {
  const applications = [{ id: "chatgpt", displayName: "ChatGPT" }];
  const skills = [{
    application: "chatgpt",
    name: "pdf",
    description: "Work with PDF files.",
    sourceName: "Plugin cache",
    metadataStatus: "valid",
    metadataIssues: [],
    directory: "/tmp/pdf",
  }];

  const output = formatDetailedSkillGroups(skills, applications);
  assert.match(output, /Description: Work with PDF files\./);
  assert.match(output, /Source: Plugin cache/);
  assert.match(output, /Metadata: Valid/);
});

test("marks missing metadata in simple output", () => {
  const applications = [{ id: "chatgpt", displayName: "ChatGPT" }];
  const skills = [{
    application: "chatgpt",
    name: "legacy-skill",
    metadataStatus: "missing",
  }];

  assert.match(
    formatSkillGroups(skills, applications),
    /legacy-skill \[metadata: missing\]/,
  );
});

test("strips terminal control sequences from human-readable output", () => {
  const applications = [{ id: "chatgpt", displayName: "ChatGPT" }];
  const skills = [{
    application: "chatgpt",
    name: "\u001b[31mdanger\u001b[0m",
    metadataStatus: "valid",
  }];

  const output = formatSkillGroups(skills, applications);
  assert.match(output, /danger/);
  assert.doesNotMatch(output, /\u001b/);
});

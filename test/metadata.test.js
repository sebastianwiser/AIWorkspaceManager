import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillMetadata } from "../src/metadata.js";

test("parses valid skill metadata", () => {
  const result = parseSkillMetadata(
    "---\nname: pdf\ndescription: Work with PDF files.\n---\n# Instructions\n",
    "folder-name",
  );

  assert.deepEqual(result, {
    name: "pdf",
    description: "Work with PDF files.",
    metadataStatus: "valid",
    metadataIssues: [],
  });
});

test("parses multiline descriptions", () => {
  const result = parseSkillMetadata(
    "---\nname: research\ndescription: |\n  Research a topic.\n  Summarize the evidence.\n---\n",
    "folder-name",
  );

  assert.equal(result.description, "Research a topic.\nSummarize the evidence.");
  assert.equal(result.metadataStatus, "valid");
});

test("uses the folder name when frontmatter is missing", () => {
  const result = parseSkillMetadata("# Instructions\n", "folder-name");

  assert.equal(result.name, "folder-name");
  assert.equal(result.metadataStatus, "missing");
  assert.equal(result.description, null);
});

test("reports invalid YAML without throwing", () => {
  const result = parseSkillMetadata(
    "---\nname: [not closed\ndescription: Broken\n---\n",
    "folder-name",
  );

  assert.equal(result.name, "folder-name");
  assert.equal(result.metadataStatus, "invalid");
  assert.match(result.metadataIssues[0], /Invalid YAML/);
});

test("reports incomplete metadata", () => {
  const result = parseSkillMetadata(
    "---\nname: no-description\n---\n",
    "folder-name",
  );

  assert.equal(result.metadataStatus, "incomplete");
  assert.deepEqual(result.metadataIssues, ["Metadata is missing a valid description."]);
});

test("ignores a very large instruction body after valid frontmatter", () => {
  const body = "x".repeat(100_000);
  const result = parseSkillMetadata(
    `---\nname: large\ndescription: Large body test.\n---\n${body}`,
    "folder-name",
  );

  assert.equal(result.metadataStatus, "valid");
  assert.equal(result.name, "large");
});

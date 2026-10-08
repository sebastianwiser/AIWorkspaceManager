import assert from "node:assert/strict";
import test from "node:test";
import { formatSkillGroups, parseArguments } from "../src/cli.js";

test("parses a ChatGPT scan command", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "chatgpt"]), {
    application: "chatgpt",
    json: false,
    help: false,
  });
});

test("parses JSON output", () => {
  assert.deepEqual(parseArguments(["scan", "--app", "all", "--json"]), {
    application: "all",
    json: true,
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
    { application: "chatgpt", name: "pdf" },
    { application: "chatgpt", name: "presentations" },
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

import assert from "node:assert/strict";
import test from "node:test";
import { createInventoryView } from "../src/inventory.js";
import type { DiscoveredSkill } from "../src/types.js";

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

test("sorts modified dates while keeping unknown dates last", () => {
  const skills = [
    createSkill({ name: "older", modifiedAt: "2026-01-01T00:00:00.000Z" }),
    createSkill({ name: "unknown", modifiedAt: null }),
    createSkill({ name: "newer", modifiedAt: "2026-02-01T00:00:00.000Z" }),
  ];

  assert.deepEqual(
    createInventoryView(skills, { sortBy: "modified", sortOrder: "desc" }).map(
      (skill) => skill.name,
    ),
    ["newer", "older", "unknown"],
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

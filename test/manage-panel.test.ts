import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ImportRiskNotice,
  ManagePanel,
  statusMessage,
} from "../src/desktop/renderer/ManagePanel.js";
import type { SkillImportHistoryEntry, SkillImportPreview } from "../src/types.js";

test("management view explains its narrow, confirmed, recoverable import", () => {
  const html = renderToStaticMarkup(
    createElement(ManagePanel, { onChanged: async () => undefined }),
  );
  assert.match(html, /Add to ChatGPT/);
  assert.match(html, /Add to Claude/);
  assert.match(html, /never replaced/);
  assert.match(html, /even after restarting the app/);
  assert.match(html, /Import history/);
  assert.match(html, /Archives, overwrites, updates, and automatic setup/);
});

test("recovery guidance distinguishes interrupted import, interrupted undo, and missing recovery", () => {
  const entry: SkillImportHistoryEntry = {
    id: "6aefbeee-b3f7-4c0f-9faf-dc82e76eece4",
    application: "chatgpt",
    destinationDirectory: "/tmp/skills/example",
    fileCount: 1,
    startedAt: "2026-10-22T12:00:00.000Z",
    appliedAt: null,
    recoveryDirectory: "/tmp/skills/.skillmanager-recovery-example-id",
    status: "needs-review",
    reviewReason: "incomplete-import",
  };
  assert.match(statusMessage(entry), /did not reach verified completion/);
  assert.match(
    statusMessage({ ...entry, reviewReason: "incomplete-undo" }),
    /whether the skill is at the destination or recovery/,
  );
  assert.match(
    statusMessage({ ...entry, reviewReason: "recovery-missing" }),
    /recorded recovery folder is missing/,
  );
});

test("import risk preview shows controlled reasons and file locations", () => {
  const preview: SkillImportPreview = {
    id: "6aefbeee-b3f7-4c0f-9faf-dc82e76eece4",
    application: "chatgpt",
    sourceDirectory: "/tmp/source",
    destinationDirectory: "/tmp/destination",
    fileCount: 1,
    totalBytes: 80,
    includesScripts: false,
    instructionRiskCount: 1,
    instructionRisks: [
      { signal: "instruction-private-data-egress", relativePath: "SKILL.md", line: 3 },
    ],
    expiresAt: "2026-10-22T12:10:00.000Z",
  };
  const html = renderToStaticMarkup(createElement(ImportRiskNotice, { preview }));
  assert.match(html, /possible AI-instruction risk to review/);
  assert.match(html, /Possible outward transfer of private data/);
  assert.match(html, /SKILL.md:3/);
  assert.match(html, /not proof of an attack/);
});

import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AuditPanel } from "../src/desktop/renderer/AuditPanel.js";
import type { AuditFinding, DesktopScanResult } from "../src/types.js";

const finding: AuditFinding = {
  id: "finding-1",
  ruleId: "file.credential-pattern",
  family: "exposure",
  severity: "warning",
  confidence: "possible",
  title: "Credential-like text found",
  explanation: "A pattern was observed; it may be an example.",
  remedy: "Inspect the line privately.",
  application: "chatgpt",
  itemKind: "skill",
  itemIds: ["chatgpt\u0000/skills/example/SKILL.md"],
  sourceFile: "/skills/example/SKILL.md",
  line: 4,
  evidence: "Only the category and line number are retained.",
};

const emptyScan: DesktopScanResult = {
  skills: [],
  mcpServers: [],
  plugins: [],
  diagnostics: [],
  scannedAt: "2026-10-15T00:00:00.000Z",
  changes: {
    baselineCreated: false,
    baselineScannedAt: null,
    comparedAt: "2026-10-15T00:00:00.000Z",
    items: [],
  },
  audit: { generatedAt: "2026-10-15T00:00:00.000Z", findings: [], coverage: [] },
};

function render(scanResult: DesktopScanResult | null, error: string | null = null): string {
  return renderToStaticMarkup(
    createElement(AuditPanel, {
      scanResult,
      isScanning: scanResult === null,
      error,
      onRetry: () => undefined,
      onInspect: () => undefined,
    }),
  );
}

test("audit view distinguishes loading, empty, error, and partial coverage", () => {
  assert.match(render(null), /Checking the local inventory/);
  assert.match(render(emptyScan), /No findings from the supported checks/);
  assert.match(render(emptyScan, "Scan failed"), /The local audit could not be refreshed/);
  const html = render({
    ...emptyScan,
    audit: {
      ...emptyScan.audit,
      coverage: [
        {
          application: "chatgpt",
          family: "exposure",
          status: "partial",
          reasons: ["file-not-inspected"],
        },
      ],
    },
  });
  assert.match(html, /Some checks are incomplete/);
  assert.match(html, /partial/);
  const baselineError = render({
    ...emptyScan,
    audit: {
      ...emptyScan.audit,
      fileChangeTrackingError: "File-change tracking is unavailable. The baseline was preserved.",
    },
  });
  assert.match(baselineError, /File-change tracking is unavailable/);
});

test("audit view presents sanitized evidence and links to the affected item", () => {
  const html = render({
    ...emptyScan,
    audit: { ...emptyScan.audit, findings: [finding] },
  });
  assert.match(html, /Credential-like text found/);
  assert.match(html, /SKILL.md:4/);
  assert.match(html, /View item/);
  assert.doesNotMatch(html, /sk-zzzz|API_KEY=/);
});

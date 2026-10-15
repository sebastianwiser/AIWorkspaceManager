import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RelationshipPanel } from "../src/desktop/renderer/RelationshipPanel.js";
import type { DesktopScanResult } from "../src/types.js";

const emptyScan: DesktopScanResult = {
  skills: [],
  mcpServers: [],
  plugins: [],
  diagnostics: [],
  scannedAt: "2026-10-14T12:00:00.000Z",
  changes: {
    baselineCreated: false,
    baselineScannedAt: null,
    comparedAt: "2026-10-14T12:00:00.000Z",
    items: [],
  },
  audit: { generatedAt: "2026-10-14T12:00:00.000Z", findings: [], coverage: [] },
};

function render(scanResult: DesktopScanResult | null, error: string | null = null): string {
  return renderToStaticMarkup(
    createElement(RelationshipPanel, {
      scanResult,
      isScanning: scanResult === null,
      error,
      onRetry: () => undefined,
    }),
  );
}

test("relationship view distinguishes loading, empty, and error states", () => {
  assert.match(render(null), /Building the local workspace map/);
  assert.match(render(emptyScan), /No local relationships found/);
  assert.match(render(emptyScan, "Scan failed"), /The relationship map could not be refreshed/);
  assert.match(render(emptyScan, "Scan failed"), /Scan failed/);
});

test("relationship view shows packaged MCP separately and does not render private endpoint values", () => {
  const html = render({
    ...emptyScan,
    plugins: [
      {
        application: "chatgpt",
        applicationName: "ChatGPT",
        name: "research",
        displayName: "Research",
        version: null,
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
        skills: [],
        mcpServers: [{ name: "private-search", configurationFile: "/plugins/research/mcp.json" }],
        apps: [],
        hasHooks: false,
        status: "valid",
        issues: [],
        modifiedAt: null,
      },
    ],
    mcpServers: [
      {
        application: "chatgpt",
        applicationName: "ChatGPT",
        name: "private-search",
        scope: "global",
        projectId: null,
        projectName: null,
        projectRoot: null,
        transport: "http",
        command: null,
        arguments: [],
        url: "https://example.com/secret-token",
        environmentVariables: ["API_KEY"],
        headerNames: [],
        configurationFile: "/config.toml",
        configurationFormat: "toml",
        safeConfiguration: "[REDACTED]",
        endpointMatchId: null,
        status: "valid",
        issues: [],
      },
    ],
  });

  assert.match(html, /Packaged MCP · not confirmed configured/);
  assert.match(html, /Configured MCP · http/);
  assert.doesNotMatch(html, /secret-token/);
});

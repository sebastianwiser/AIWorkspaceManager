import { discoverMcpServers, type McpDiscoveryOptions } from "./mcp.js";
import { scanApplications } from "./scanner.js";
import type { ApplicationDefinition, ScanResult } from "./types.js";

/** Run the shared, read-only discovery used by both the CLI and desktop app. */
export async function scanLocalInventory({
  applications,
  mcpOptions,
}: {
  applications: readonly ApplicationDefinition[];
  mcpOptions?: McpDiscoveryOptions;
}): Promise<ScanResult> {
  const applicationIds = new Set(applications.map((application) => application.id));
  const [skillResult, mcpResult] = await Promise.all([
    scanApplications({ applications: [...applications] }),
    discoverMcpServers(mcpOptions),
  ]);

  return {
    skills: skillResult.skills,
    mcpServers: mcpResult.mcpServers.filter((server) => applicationIds.has(server.application)),
    diagnostics: [
      ...skillResult.diagnostics,
      ...mcpResult.diagnostics.filter((diagnostic) => applicationIds.has(diagnostic.application)),
    ],
  };
}

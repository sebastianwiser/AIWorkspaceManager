import { discoverMcpServers, type McpDiscoveryOptions } from "./mcp.js";
import { attachPluginSkills, discoverPlugins, type PluginDiscoveryOptions } from "./plugins.js";
import { scanApplications } from "./scanner.js";
import type { ApplicationDefinition, ScanResult } from "./types.js";

/** Run the shared, read-only discovery used by both the CLI and desktop app. */
export async function scanLocalInventory({
  applications,
  mcpOptions,
  pluginOptions,
}: {
  applications: readonly ApplicationDefinition[];
  mcpOptions?: McpDiscoveryOptions;
  pluginOptions?: PluginDiscoveryOptions;
}): Promise<ScanResult> {
  const applicationIds = new Set(applications.map((application) => application.id));
  const [skillResult, mcpResult, pluginResult] = await Promise.all([
    scanApplications({ applications: [...applications] }),
    discoverMcpServers(mcpOptions),
    discoverPlugins(pluginOptions),
  ]);

  const plugins = attachPluginSkills(
    pluginResult.plugins.filter((plugin) => applicationIds.has(plugin.application)),
    skillResult.skills,
  );

  return {
    skills: skillResult.skills,
    mcpServers: mcpResult.mcpServers.filter((server) => applicationIds.has(server.application)),
    plugins,
    diagnostics: [
      ...skillResult.diagnostics,
      ...mcpResult.diagnostics.filter((diagnostic) => applicationIds.has(diagnostic.application)),
      ...pluginResult.diagnostics.filter((diagnostic) =>
        applicationIds.has(diagnostic.application),
      ),
    ],
  };
}

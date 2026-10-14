import type {
  DiscoveredMcpServer,
  DiscoveredPlugin,
  DiscoveredSkill,
  InventoryOptions,
  InventorySortField,
  McpInventoryOptions,
  PluginInventoryOptions,
  SortOrder,
} from "./types.js";

/**
 * Return the stable identity used for one skill entry in the interface.
 *
 * A shared project skill can intentionally appear once for ChatGPT and once
 * for Claude. Its file path is therefore not unique on its own.
 */
export function getSkillIdentity(skill: DiscoveredSkill): string {
  return `${skill.application}\u0000${skill.instructionFile}`;
}

export function getMcpServerIdentity(server: DiscoveredMcpServer): string {
  return `${server.application}\u0000${server.scope}\u0000${server.projectId ?? "global"}\u0000${server.name}\u0000${server.configurationFile}`;
}

export function getPluginIdentity(plugin: DiscoveredPlugin): string {
  return `${plugin.application}\u0000${plugin.directory}`;
}

/** Filter first-class plugin inventory without reading or executing plugin contents. */
export function createPluginInventoryView(
  plugins: readonly DiscoveredPlugin[],
  options: PluginInventoryOptions = {},
): DiscoveredPlugin[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const applicationIds = new Set(options.applicationIds ?? []);
  const scopes = new Set(options.scopes ?? []);
  const projectIds = new Set(options.projectIds ?? []);
  const statuses = new Set(options.statuses ?? []);

  return plugins
    .filter((plugin) => {
      if (applicationIds.size > 0 && !applicationIds.has(plugin.application)) return false;
      if (scopes.size > 0 && !scopes.has(plugin.scope)) return false;
      if (projectIds.size > 0 && (!plugin.projectId || !projectIds.has(plugin.projectId))) {
        return false;
      }
      if (statuses.size > 0 && !statuses.has(plugin.status)) return false;
      return (
        query === "" ||
        [
          plugin.name,
          plugin.displayName,
          plugin.description ?? "",
          plugin.author ?? "",
          plugin.originName,
          ...plugin.skills.map((skill) => skill.name),
          ...plugin.mcpServers.map((server) => server.name),
          ...plugin.apps,
        ]
          .join("\n")
          .toLocaleLowerCase()
          .includes(query)
      );
    })
    .sort(
      (left, right) =>
        left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
        left.application.localeCompare(right.application) ||
        left.directory.localeCompare(right.directory),
    );
}

/** Filter MCP inventory without exposing configuration values or performing I/O. */
export function createMcpInventoryView(
  servers: readonly DiscoveredMcpServer[],
  options: McpInventoryOptions = {},
): DiscoveredMcpServer[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const applicationIds = new Set(options.applicationIds ?? []);
  const scopes = new Set(options.scopes ?? []);
  const projectIds = new Set(options.projectIds ?? []);

  return servers
    .filter((server) => {
      if (applicationIds.size > 0 && !applicationIds.has(server.application)) return false;
      if (scopes.size > 0 && !scopes.has(server.scope)) return false;
      if (projectIds.size > 0 && (!server.projectId || !projectIds.has(server.projectId))) {
        return false;
      }
      return (
        query === "" ||
        [server.name, server.applicationName, server.projectName ?? "", server.transport]
          .join("\n")
          .toLocaleLowerCase()
          .includes(query)
      );
    })
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
        left.application.localeCompare(right.application) ||
        left.configurationFile.localeCompare(right.configurationFile),
    );
}

/**
 * Create an inventory view without changing the original scan results.
 *
 * Keeping this function free of filesystem and terminal code makes it safe to
 * reuse from the CLI, tests, and a future desktop interface.
 */
export function createInventoryView(
  skills: readonly DiscoveredSkill[],
  options: InventoryOptions = {},
): DiscoveredSkill[] {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const applicationIds = new Set(options.applicationIds ?? []);
  const sources = new Set(options.sources ?? []);
  const metadataStatuses = new Set(options.metadataStatuses ?? []);
  const scopes = new Set(options.scopes ?? []);
  const projectIds = new Set(options.projectIds ?? []);
  const sortBy = options.sortBy ?? "application";
  const sortOrder = options.sortOrder ?? "asc";

  return skills
    .filter((skill) => {
      if (applicationIds.size > 0 && !applicationIds.has(skill.application)) {
        return false;
      }

      if (sources.size > 0 && !sources.has(skill.source)) {
        return false;
      }

      if (metadataStatuses.size > 0 && !metadataStatuses.has(skill.metadataStatus)) {
        return false;
      }

      if (scopes.size > 0 && !scopes.has(skill.scope)) {
        return false;
      }

      if (projectIds.size > 0 && (!skill.projectId || !projectIds.has(skill.projectId))) {
        return false;
      }

      return query === "" || searchableText(skill).includes(query);
    })
    .sort((left, right) => compareSkills(left, right, sortBy, sortOrder));
}

function searchableText(skill: DiscoveredSkill): string {
  return [skill.name, skill.folderName, skill.description ?? "", skill.projectName ?? ""]
    .join("\n")
    .toLocaleLowerCase();
}

function compareSkills(
  left: DiscoveredSkill,
  right: DiscoveredSkill,
  sortBy: InventorySortField,
  sortOrder: SortOrder,
): number {
  let comparison: number;

  if (sortBy === "modified") {
    comparison = compareOptionalDates(left.modifiedAt, right.modifiedAt, sortOrder);
  } else {
    comparison = getSortValue(left, sortBy).localeCompare(getSortValue(right, sortBy), undefined, {
      sensitivity: "base",
    });
    comparison = sortOrder === "desc" ? -comparison : comparison;
  }

  // Use consistent tie-breakers so CLI and desktop results appear in the same order.
  return (
    comparison ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
    left.application.localeCompare(right.application) ||
    left.directory.localeCompare(right.directory)
  );
}

function getSortValue(skill: DiscoveredSkill, sortBy: Exclude<InventorySortField, "modified">) {
  if (sortBy === "name") {
    return skill.name;
  }

  if (sortBy === "source") {
    return skill.sourceName;
  }

  return skill.applicationName;
}

function compareOptionalDates(
  left: string | null,
  right: string | null,
  sortOrder: SortOrder,
): number {
  const leftIsUnavailable = isUnavailableDate(left);
  const rightIsUnavailable = isUnavailableDate(right);

  // Missing, invalid, and placeholder dates remain at the end in both
  // directions instead of appearing to be the oldest or newest skills.
  if (leftIsUnavailable && rightIsUnavailable) {
    return 0;
  }
  if (leftIsUnavailable) {
    return 1;
  }
  if (rightIsUnavailable) {
    return -1;
  }

  const comparison = Date.parse(left ?? "") - Date.parse(right ?? "");
  return sortOrder === "desc" ? -comparison : comparison;
}

function isUnavailableDate(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1970;
}

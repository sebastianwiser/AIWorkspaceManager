import type { DiscoveredSkill, InventoryOptions, InventorySortField, SortOrder } from "./types.js";

/**
 * Return the stable identity used for one skill entry in the interface.
 *
 * A shared project skill can intentionally appear once for ChatGPT and once
 * for Claude. Its file path is therefore not unique on its own.
 */
export function getSkillIdentity(skill: DiscoveredSkill): string {
  return `${skill.application}\u0000${skill.instructionFile}`;
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
  // Unknown dates remain at the end in both directions instead of looking newest.
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }

  const comparison = left.localeCompare(right);
  return sortOrder === "desc" ? -comparison : comparison;
}

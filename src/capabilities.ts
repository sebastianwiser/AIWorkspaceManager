import type {
  ApplicationId,
  CapabilityMatchBasis,
  DiscoveredMcpServer,
  DiscoveredSkill,
  McpCapabilityGroup,
  SkillCapabilityGroup,
} from "./types.js";

/**
 * Group app-specific records into cautious, explainable capability candidates.
 *
 * Matching names create a candidate rather than asserting equivalence. Shared
 * files and identical sanitized endpoints provide stronger local evidence.
 */
export function createSkillCapabilityGroups(
  skills: readonly DiscoveredSkill[],
): SkillCapabilityGroup[] {
  return groupByNormalizedName(skills, "skill").map(([normalizedName, definitions]) => {
    const id = `skill:${normalizedName}`;
    return {
      id,
      kind: "skill",
      name: chooseDisplayName(definitions),
      applications: uniqueApplications(definitions),
      matchBasis: getSkillMatchBasis(definitions),
      definitions,
      variants: createSkillVariants(id, definitions),
    };
  });
}

export function createMcpCapabilityGroups(
  servers: readonly DiscoveredMcpServer[],
): McpCapabilityGroup[] {
  return groupByNormalizedName(servers, "mcp").map(([normalizedName, definitions]) => ({
    id: `mcp:${normalizedName}`,
    kind: "mcp",
    name: chooseDisplayName(definitions),
    applications: uniqueApplications(definitions),
    matchBasis: getMcpMatchBasis(definitions),
    definitions,
  }));
}

export function normalizeCapabilityName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function groupByNormalizedName<T extends { name: string }>(
  definitions: readonly T[],
  kind: "skill" | "mcp",
): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const definition of definitions) {
    const normalizedName = normalizeCapabilityName(definition.name);
    const key = normalizedName || `${kind}:unnamed`;
    const group = groups.get(key) ?? [];
    group.push(definition);
    groups.set(key, group);
  }

  return [...groups.entries()].sort((left, right) =>
    left[0].localeCompare(right[0], undefined, { sensitivity: "base" }),
  );
}

function chooseDisplayName<T extends { name: string }>(definitions: readonly T[]): string {
  return [...definitions]
    .map((definition) => definition.name.trim())
    .sort((left, right) => left.length - right.length || left.localeCompare(right))[0];
}

function uniqueApplications<T extends { application: ApplicationId }>(
  definitions: readonly T[],
): ApplicationId[] {
  return [...new Set(definitions.map((definition) => definition.application))].sort();
}

function createSkillVariants(capabilityId: string, definitions: readonly DiscoveredSkill[]) {
  const byFile = new Map<string, DiscoveredSkill[]>();
  for (const definition of definitions) {
    const variant = byFile.get(definition.instructionFile) ?? [];
    variant.push(definition);
    byFile.set(definition.instructionFile, variant);
  }

  return [...byFile.entries()]
    .map(([instructionFile, variantDefinitions]) => ({
      id: `${capabilityId}:variant:${instructionFile}`,
      instructionFile,
      applications: uniqueApplications(variantDefinitions),
      definitions: variantDefinitions,
    }))
    .sort((left, right) => left.instructionFile.localeCompare(right.instructionFile));
}

function getSkillMatchBasis(definitions: readonly DiscoveredSkill[]): CapabilityMatchBasis {
  if (uniqueApplications(definitions).length < 2) return "single-application";
  const locations = new Set(definitions.map((definition) => definition.instructionFile));
  return locations.size < definitions.length ? "shared-location" : "matching-name";
}

function getMcpMatchBasis(definitions: readonly DiscoveredMcpServer[]): CapabilityMatchBasis {
  if (uniqueApplications(definitions).length < 2) return "single-application";
  const endpoints = definitions.map((definition) => definition.endpointMatchId);
  return endpoints.every((endpoint) => endpoint !== null && endpoint === endpoints[0])
    ? "shared-endpoint"
    : "matching-name";
}

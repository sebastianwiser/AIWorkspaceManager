import { createMcpCapabilityGroups, createSkillCapabilityGroups } from "./capabilities.js";
import { getMcpServerIdentity, getPluginIdentity, getSkillIdentity } from "./inventory.js";
import type {
  ApplicationId,
  DiscoveredMcpServer,
  DiscoveredPlugin,
  DiscoveredSkill,
  McpCapabilityGroup,
  PluginMcpReference,
  ScanResult,
  SkillCapabilityGroup,
  SkillScope,
} from "./types.js";

export interface RelationshipPlugin {
  id: string;
  plugin: DiscoveredPlugin;
  skills: DiscoveredSkill[];
  configuredMcpServers: DiscoveredMcpServer[];
  /** Bundle declarations are not evidence that a server is configured or running. */
  packagedMcpServers: PluginMcpReference[];
}

export interface RelationshipScope {
  id: string;
  application: ApplicationId;
  applicationName: string;
  scope: SkillScope;
  projectId: string | null;
  projectName: string | null;
  projectRoots: string[];
  plugins: RelationshipPlugin[];
  otherSkills: DiscoveredSkill[];
  otherMcpServers: DiscoveredMcpServer[];
}

export interface RelationshipMap {
  scopes: RelationshipScope[];
  /** Cross-app links retain every original definition and its evidence strength. */
  skillConnections: SkillCapabilityGroup[];
  mcpConnections: McpCapabilityGroup[];
}

export type RelationshipScopedItem = Pick<
  DiscoveredSkill,
  "application" | "applicationName" | "scope" | "projectId" | "projectName" | "projectRoot"
>;

/** A deterministic, read-only projection of one scan; it never infers ownership from a name. */
export function createRelationshipMap(scan: Readonly<ScanResult>): RelationshipMap {
  const scopes = new Map<string, RelationshipScope>();
  for (const item of [...scan.skills, ...scan.mcpServers, ...scan.plugins]) {
    const id = getRelationshipScopeId(item);
    if (!scopes.has(id)) {
      scopes.set(id, {
        id,
        application: item.application,
        applicationName: item.applicationName,
        scope: item.scope,
        projectId: item.projectId,
        projectName: item.projectName,
        projectRoots: item.projectRoot ? [item.projectRoot] : [],
        plugins: [],
        otherSkills: [],
        otherMcpServers: [],
      });
    } else if (item.projectRoot) {
      const scope = scopes.get(id);
      if (scope && !scope.projectRoots.includes(item.projectRoot)) {
        scope.projectRoots.push(item.projectRoot);
      }
    }
  }

  const ownedSkills = new Set<string>();
  const ownedServers = new Set<string>();

  for (const plugin of scan.plugins) {
    const scope = scopes.get(getRelationshipScopeId(plugin));
    if (!scope) continue;
    const skillFiles = new Set(plugin.skills.map((reference) => reference.instructionFile));
    const skills = scan.skills.filter(
      (skill) => inSameScope(skill, plugin) && skillFiles.has(skill.instructionFile),
    );
    for (const skill of skills) ownedSkills.add(getSkillIdentity(skill));

    const packagedKeys = new Set(
      plugin.mcpServers.map((reference) => `${reference.name}\u0000${reference.configurationFile}`),
    );
    const configuredMcpServers = scan.mcpServers.filter(
      (server) =>
        inSameScope(server, plugin) &&
        packagedKeys.has(`${server.name}\u0000${server.configurationFile}`),
    );
    for (const server of configuredMcpServers) ownedServers.add(getMcpServerIdentity(server));

    scope.plugins.push({
      id: getPluginIdentity(plugin),
      plugin,
      skills: sortByName(skills),
      configuredMcpServers: sortByName(configuredMcpServers),
      packagedMcpServers: [...plugin.mcpServers].sort(compareNamed),
    });
  }

  for (const skill of scan.skills) {
    if (!ownedSkills.has(getSkillIdentity(skill))) {
      scopes.get(getRelationshipScopeId(skill))?.otherSkills.push(skill);
    }
  }
  for (const server of scan.mcpServers) {
    if (!ownedServers.has(getMcpServerIdentity(server))) {
      scopes.get(getRelationshipScopeId(server))?.otherMcpServers.push(server);
    }
  }

  return {
    scopes: [...scopes.values()]
      .map((scope) => ({
        ...scope,
        projectRoots: scope.projectRoots.sort(),
        plugins: scope.plugins.sort((left, right) =>
          left.plugin.displayName.localeCompare(right.plugin.displayName),
        ),
        otherSkills: sortByName(scope.otherSkills),
        otherMcpServers: sortByName(scope.otherMcpServers),
      }))
      .sort(
        (left, right) =>
          left.application.localeCompare(right.application) ||
          (left.scope === "global" ? -1 : right.scope === "global" ? 1 : 0) ||
          (left.projectName ?? "").localeCompare(right.projectName ?? "") ||
          left.id.localeCompare(right.id),
      ),
    skillConnections: createSkillCapabilityGroups(scan.skills).filter(
      (group) => group.applications.length > 1,
    ),
    mcpConnections: createMcpCapabilityGroups(scan.mcpServers).filter(
      (group) => group.applications.length > 1,
    ),
  };
}

export function getRelationshipScopeId(item: RelationshipScopedItem): string {
  return `${item.application}\u0000${item.scope}\u0000${item.scope === "global" ? "global" : (item.projectId ?? item.projectRoot ?? "unknown")}`;
}

function inSameScope(left: RelationshipScopedItem, right: RelationshipScopedItem): boolean {
  return getRelationshipScopeId(left) === getRelationshipScopeId(right);
}

function sortByName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort(compareNamed);
}

function compareNamed(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  ApplicationId,
  DiscoveredPlugin,
  DiscoveredSkill,
  PluginManifestFormat,
  PluginMcpReference,
  PluginOrigin,
  ScanDiagnostic,
  SkillScope,
} from "./types.js";
import { discoverKnownProjects, type KnownProject } from "./projects.js";
import { readRegularFileBounded } from "./safe-file.js";

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_COMPONENT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 8;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".trash",
  ".remote-plugin-install-staging",
  ".plugin-appserver",
  "data",
  "marketplaces",
  "node_modules",
]);

export interface PluginDiscoveryLocation {
  application: ApplicationId;
  path: string;
  origin: PluginOrigin;
  originName: string;
  scope?: SkillScope;
  projectId?: string;
  projectName?: string;
  projectRoot?: string;
  exact?: boolean;
}

export interface PluginDiscoveryOptions {
  homeDirectory?: string;
  projects?: readonly KnownProject[];
  locations?: readonly PluginDiscoveryLocation[];
  maxDepth?: number;
}

export interface PluginScanResult {
  plugins: DiscoveredPlugin[];
  diagnostics: ScanDiagnostic[];
}

/** Discover installed plugin bundles without executing their components. */
export async function discoverPlugins(
  options: PluginDiscoveryOptions = {},
): Promise<PluginScanResult> {
  const home = options.homeDirectory ?? os.homedir();
  const diagnostics: ScanDiagnostic[] = [];
  const defaults = options.locations
    ? null
    : await getDefaultPluginLocations(home, options.projects ?? (await discoverKnownProjects()));
  const locations = options.locations ?? defaults?.locations ?? [];
  diagnostics.push(...(defaults?.diagnostics ?? []));
  const manifestCandidates: ManifestCandidate[] = [];

  for (const location of locations) {
    const candidates = await findPluginManifests(location, options.maxDepth ?? DEFAULT_MAX_DEPTH);
    manifestCandidates.push(...candidates.manifests);
    diagnostics.push(...candidates.diagnostics);
  }

  const pluginsByRoot = new Map<string, DiscoveredPlugin>();
  for (const candidate of manifestCandidates.sort(compareManifestCandidates)) {
    const identity = `${candidate.location.application}\u0000${candidate.pluginRoot}`;
    if (pluginsByRoot.has(identity)) continue;
    const result = await readPluginManifest(candidate);
    if (result.plugin) pluginsByRoot.set(identity, result.plugin);
    if (result.diagnostic) diagnostics.push(result.diagnostic);
  }

  const plugins = [...pluginsByRoot.values()].sort(
    (left, right) =>
      left.displayName.localeCompare(right.displayName, undefined, { sensitivity: "base" }) ||
      left.application.localeCompare(right.application) ||
      left.directory.localeCompare(right.directory),
  );

  return { plugins, diagnostics };
}

/** Attach skills already discovered by the shared scanner to their owning plugin roots. */
export function attachPluginSkills(
  plugins: readonly DiscoveredPlugin[],
  skills: readonly DiscoveredSkill[],
): DiscoveredPlugin[] {
  const owners = new Map<DiscoveredSkill, DiscoveredPlugin>();
  for (const skill of skills) {
    const owner = plugins
      .filter(
        (plugin) =>
          skill.application === plugin.application &&
          isPathInside(plugin.directory, skill.directory),
      )
      .sort((left, right) => right.directory.length - left.directory.length)[0];
    if (owner) owners.set(skill, owner);
  }
  return plugins.map((plugin) => {
    const references = skills
      .filter((skill) => owners.get(skill) === plugin)
      .map((skill) => ({ name: skill.name, instructionFile: skill.instructionFile }))
      .filter(
        (reference, index, items) =>
          items.findIndex((item) => item.instructionFile === reference.instructionFile) === index,
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { sensitivity: "base" }),
      );

    return { ...plugin, skills: references };
  });
}

async function getDefaultPluginLocations(
  home: string,
  projects: readonly KnownProject[] | undefined,
): Promise<{ locations: PluginDiscoveryLocation[]; diagnostics: ScanDiagnostic[] }> {
  const locations: PluginDiscoveryLocation[] = [
    {
      application: "chatgpt",
      path: path.join(home, ".codex", "plugins"),
      origin: "local",
      originName: "Codex plugins",
    },
    {
      application: "claude",
      path: path.join(home, ".claude", "plugins", "synced"),
      origin: "synced",
      originName: "Claude synced",
    },
    {
      application: "claude",
      path: path.join(home, ".claude", "skills"),
      origin: "skills-directory",
      originName: "Claude skills directory",
    },
  ];

  const installRecord = path.join(home, ".claude", "plugins", "installed_plugins.json");
  const installResult = await readClaudeInstallLocations(installRecord);
  locations.push(...installResult.locations);

  for (const project of projects ?? []) {
    if (project.application !== "claude") continue;
    locations.push({
      application: "claude",
      path: path.join(project.path, ".claude", "skills"),
      origin: "skills-directory",
      originName: "Project skills directory",
      scope: "project",
      projectId: project.id,
      projectName: project.name,
      projectRoot: project.path,
    });
  }

  return { locations: deduplicateLocations(locations), diagnostics: installResult.diagnostics };
}

async function readClaudeInstallLocations(
  recordFile: string,
): Promise<{ locations: PluginDiscoveryLocation[]; diagnostics: ScanDiagnostic[] }> {
  let document: unknown;
  try {
    const stats = await fs.lstat(recordFile);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_COMPONENT_BYTES) {
      throw new Error("The plugin install record is not a bounded regular file.");
    }
    document = JSON.parse(
      (await readRegularFileBounded(recordFile, MAX_COMPONENT_BYTES)).toString("utf8"),
    ) as unknown;
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") return { locations: [], diagnostics: [] };
    return {
      locations: [],
      diagnostics: [
        {
          application: "claude",
          location: recordFile,
          severity: "warning",
          code: "PLUGIN_RECORD_INVALID",
          message:
            "Could not read Claude's plugin install record. Check its format and permissions.",
        },
      ],
    };
  }

  const root = asObject(document);
  const plugins = asObject(root?.plugins) ?? root;
  if (!plugins) {
    return {
      locations: [],
      diagnostics: [
        {
          application: "claude",
          location: recordFile,
          severity: "warning",
          code: "PLUGIN_RECORD_INVALID",
          message: "Claude's plugin install record is not a JSON object.",
        },
      ],
    };
  }

  const locations: PluginDiscoveryLocation[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const trustedPluginRoot = await fs.realpath(path.dirname(recordFile)).catch(() => null);
  if (!trustedPluginRoot) {
    return {
      locations: [],
      diagnostics: [
        {
          application: "claude",
          location: recordFile,
          severity: "warning",
          code: "PLUGIN_RECORD_INVALID",
          message: "Claude's plugin directory changed during discovery.",
        },
      ],
    };
  }
  for (const [pluginId, rawRecords] of Object.entries(plugins)) {
    if (pluginId === "version" || pluginId === "schemaVersion") continue;
    const records = Array.isArray(rawRecords) ? rawRecords : [rawRecords];
    for (const rawRecord of records) {
      const record = asObject(rawRecord);
      const installPath = getString(record?.installPath) ?? getString(record?.path);
      if (
        !installPath ||
        !path.isAbsolute(installPath) ||
        !isPathInside(path.dirname(recordFile), installPath)
      ) {
        diagnostics.push({
          application: "claude",
          location: recordFile,
          severity: "warning",
          code: "PLUGIN_RECORD_INVALID",
          message:
            "A plugin install path is missing or outside Claude's plugin directory and was skipped.",
        });
        continue;
      }
      try {
        if (!isPathInside(trustedPluginRoot, await fs.realpath(installPath))) {
          diagnostics.push({
            application: "claude",
            location: recordFile,
            severity: "warning",
            code: "PLUGIN_RECORD_INVALID",
            message:
              "A plugin install path resolves outside Claude's plugin directory and was skipped.",
          });
          continue;
        }
      } catch {
        continue;
      }
      const scopeName = getString(record?.scope)?.toLowerCase();
      const projectRoot = getString(record?.projectPath) ?? getString(record?.projectRoot);
      locations.push({
        application: "claude",
        path: installPath,
        exact: true,
        origin: "marketplace",
        originName: pluginId.includes("@")
          ? `Marketplace: ${pluginId.slice(pluginId.indexOf("@") + 1)}`
          : "Claude marketplace",
        scope: scopeName === "project" || scopeName === "local" ? "project" : "global",
        projectId: projectRoot ? `claude:${projectRoot}` : undefined,
        projectName: projectRoot ? path.basename(projectRoot) : undefined,
        projectRoot: projectRoot ?? undefined,
      });
    }
  }
  return { locations, diagnostics };
}

async function findPluginManifests(
  location: PluginDiscoveryLocation,
  maxDepth: number,
): Promise<{ manifests: ManifestCandidate[]; diagnostics: ScanDiagnostic[] }> {
  const root = path.resolve(location.path);
  let stats;
  try {
    stats = await fs.lstat(root);
  } catch {
    return { manifests: [], diagnostics: [] };
  }
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    return { manifests: [], diagnostics: [] };
  }

  const manifests: ManifestCandidate[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  await walkForManifests(root, 0, location.exact ? 2 : maxDepth, location, manifests, diagnostics);
  return { manifests, diagnostics };
}

async function walkForManifests(
  currentPath: string,
  depth: number,
  maxDepth: number,
  location: PluginDiscoveryLocation,
  manifests: ManifestCandidate[],
  diagnostics: ScanDiagnostic[],
): Promise<void> {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    diagnostics.push({
      application: location.application,
      location: currentPath,
      severity: "warning",
      code: "PLUGIN_RECORD_INVALID",
      message: "Could not inspect this plugin directory. Check its permissions.",
    });
    return;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name === "plugin.json") {
      const parentName = path.basename(currentPath);
      const format: PluginManifestFormat =
        parentName === ".codex-plugin"
          ? "codex"
          : parentName === ".claude-plugin"
            ? "claude"
            : "portable";
      manifests.push({
        location,
        manifestFile: path.join(currentPath, entry.name),
        pluginRoot: format === "portable" ? currentPath : path.resolve(currentPath, ".."),
        format,
      });
    }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRECTORIES.has(entry.name)) continue;
    await walkForManifests(
      path.join(currentPath, entry.name),
      depth + 1,
      maxDepth,
      location,
      manifests,
      diagnostics,
    );
  }
}

async function readPluginManifest(
  candidate: ManifestCandidate,
): Promise<{ plugin: DiscoveredPlugin | null; diagnostic: ScanDiagnostic | null }> {
  if (await isRegularFile(path.join(candidate.pluginRoot, ".orphaned_at"))) {
    return { plugin: null, diagnostic: null };
  }

  let stats;
  let document: Record<string, unknown>;
  try {
    stats = await fs.lstat(candidate.manifestFile);
    if (!stats.isFile() || stats.isSymbolicLink())
      throw new Error("The manifest is not a regular file.");
    if (stats.size > MAX_MANIFEST_BYTES)
      throw new Error("The manifest exceeds the 1 MB safety limit.");
    const parsed: unknown = JSON.parse(
      (await readRegularFileBounded(candidate.manifestFile, MAX_MANIFEST_BYTES)).toString("utf8"),
    );
    const parsedObject = asObject(parsed);
    if (!parsedObject) throw new Error("The manifest root is not an object.");
    document = parsedObject;
  } catch {
    return {
      plugin: null,
      diagnostic: {
        application: candidate.location.application,
        location: candidate.manifestFile,
        severity: "warning",
        code: "PLUGIN_MANIFEST_INVALID",
        message: "Could not parse this plugin manifest. Check its format and size.",
      },
    };
  }

  const extension = asObject(asObject(document.extensions)?.["com.openai"]);
  const interfaceMetadata = asObject(extension?.interface) ?? asObject(document.interface);
  const rawName = getString(document.name)?.trim() ?? "";
  const issues: string[] = [];
  if (!rawName) issues.push("The plugin name is missing.");
  const version = getString(document.version)?.trim() || null;
  const description =
    getString(document.description)?.trim() ||
    getString(interfaceMetadata?.longDescription)?.trim() ||
    getString(interfaceMetadata?.shortDescription)?.trim() ||
    null;
  if (!description) issues.push("The plugin description is missing.");
  for (const declared of [
    document.mcpServers ?? extension?.mcpServers,
    extension?.apps ?? document.apps,
  ]) {
    if (typeof declared !== "string") continue;
    const resolved = resolveInside(candidate.pluginRoot, declared);
    if (!resolved || !(await isSafeDeclaredComponent(candidate.pluginRoot, resolved))) {
      issues.push(
        "A declared plugin component path is missing, unreadable, or outside the plugin directory.",
      );
    }
  }
  const name = rawName || path.basename(candidate.pluginRoot);
  const mcpServers = await readMcpReferences(
    candidate.pluginRoot,
    candidate.manifestFile,
    document,
  );
  const apps = await readAppNames(candidate.pluginRoot, document, extension);
  const hasHooks =
    document.hooks !== undefined ||
    extension?.hooks !== undefined ||
    (await isRegularFile(path.join(candidate.pluginRoot, "hooks", "hooks.json")));
  const origin = inferOrigin(candidate.location, candidate.pluginRoot);

  return {
    plugin: {
      application: candidate.location.application,
      applicationName: candidate.location.application === "chatgpt" ? "ChatGPT" : "Claude",
      name,
      displayName: getString(interfaceMetadata?.displayName)?.trim() || name,
      version,
      description,
      author: getPersonName(document.author) ?? getString(interfaceMetadata?.developerName),
      license: getString(document.license),
      homepage: safePublicWebsite(
        getString(document.homepage) ?? getString(interfaceMetadata?.websiteURL),
      ),
      repository: safePublicWebsite(getRepositoryUrl(document.repository)),
      scope: candidate.location.scope ?? "global",
      projectId: candidate.location.projectId ?? null,
      projectName: candidate.location.projectName ?? null,
      projectRoot: candidate.location.projectRoot ?? null,
      origin: origin.origin,
      originName: origin.name,
      installationStatus: getInstallationStatus(candidate, origin.origin),
      directory: candidate.pluginRoot,
      manifestFile: candidate.manifestFile,
      manifestFormat: candidate.format,
      skills: [],
      mcpServers,
      apps,
      hasHooks,
      status: !rawName ? "invalid" : issues.length > 0 ? "incomplete" : "valid",
      issues,
      modifiedAt: stats.mtime?.toISOString() ?? null,
    },
    diagnostic: !rawName
      ? {
          application: candidate.location.application,
          location: candidate.manifestFile,
          severity: "warning",
          code: "PLUGIN_MANIFEST_INVALID",
          message: "A plugin manifest is missing its name.",
        }
      : null,
  };
}

async function readMcpReferences(
  pluginRoot: string,
  manifestFile: string,
  manifest: Record<string, unknown>,
): Promise<PluginMcpReference[]> {
  const extension = asObject(asObject(manifest.extensions)?.["com.openai"]);
  const declared = manifest.mcpServers ?? extension?.mcpServers;
  const references: PluginMcpReference[] = [];

  if (asObject(declared)) {
    for (const name of Object.keys(asObject(declared) ?? {})) {
      references.push({ name, configurationFile: manifestFile });
    }
  }

  const candidates = new Set([
    path.join(pluginRoot, ".mcp.json"),
    path.join(pluginRoot, "mcp.json"),
  ]);
  if (typeof declared === "string") {
    const resolved = resolveInside(pluginRoot, declared);
    if (resolved) candidates.add(resolved);
  }

  for (const configurationFile of candidates) {
    const names = await readNamedObjectKeys(pluginRoot, configurationFile, "mcpServers");
    for (const name of names) references.push({ name, configurationFile });
  }

  return references.filter(
    (reference, index, items) =>
      items.findIndex(
        (item) =>
          item.name === reference.name && item.configurationFile === reference.configurationFile,
      ) === index,
  );
}

async function readAppNames(
  pluginRoot: string,
  manifest: Record<string, unknown>,
  extension: Record<string, unknown> | null,
): Promise<string[]> {
  const declared = extension?.apps ?? manifest.apps;
  if (asObject(declared)) return Object.keys(asObject(declared) ?? {}).sort();
  const configurationFile =
    typeof declared === "string"
      ? resolveInside(pluginRoot, declared)
      : path.join(pluginRoot, ".app.json");
  return configurationFile ? await readNamedObjectKeys(pluginRoot, configurationFile, "apps") : [];
}

async function readNamedObjectKeys(
  pluginRoot: string,
  filePath: string,
  containerName: string,
): Promise<string[]> {
  try {
    const [realRoot, realFile] = await Promise.all([
      fs.realpath(pluginRoot),
      fs.realpath(filePath),
    ]);
    if (!isPathInside(realRoot, realFile)) return [];
    const stats = await fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_COMPONENT_BYTES) return [];
    const document = asObject(
      JSON.parse(
        (await readRegularFileBounded(filePath, MAX_COMPONENT_BYTES)).toString("utf8"),
      ) as unknown,
    );
    return Object.keys(asObject(document?.[containerName]) ?? {}).sort();
  } catch {
    return [];
  }
}

function getInstallationStatus(
  candidate: ManifestCandidate,
  origin: PluginOrigin,
): DiscoveredPlugin["installationStatus"] {
  if (candidate.location.exact && candidate.location.origin === "marketplace") return "confirmed";
  if (origin === "bundled") return "bundled";
  if (candidate.pluginRoot.split(path.sep).includes("cache")) return "cached";
  if (origin === "synced") return "confirmed";
  return "unverified";
}

function safePublicWebsite(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? `${url.protocol}//${url.host}/`
      : null;
  } catch {
    return null;
  }
}

function inferOrigin(
  location: PluginDiscoveryLocation,
  pluginRoot: string,
): { origin: PluginOrigin; name: string } {
  const parts = pluginRoot.split(path.sep);
  const cacheIndex = parts.lastIndexOf("cache");
  const channel = cacheIndex >= 0 ? parts[cacheIndex + 1] : null;
  if (channel === "openai-bundled") return { origin: "bundled", name: "OpenAI bundled" };
  if (channel === "openai-primary-runtime") {
    return { origin: "bundled", name: "OpenAI runtime" };
  }
  if (channel === "openai-curated-remote") {
    return { origin: "marketplace", name: "OpenAI curated" };
  }
  if (channel) return { origin: "marketplace", name: humanizeIdentifier(channel) };
  return { origin: location.origin, name: location.originName };
}

function compareManifestCandidates(left: ManifestCandidate, right: ManifestCandidate): number {
  const priority = { portable: 0, codex: 1, claude: 2 } satisfies Record<
    PluginManifestFormat,
    number
  >;
  return (
    left.pluginRoot.localeCompare(right.pluginRoot) ||
    priority[left.format] - priority[right.format] ||
    left.manifestFile.localeCompare(right.manifestFile)
  );
}

function deduplicateLocations(
  locations: readonly PluginDiscoveryLocation[],
): PluginDiscoveryLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const identity = `${location.application}\u0000${path.resolve(location.path)}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function resolveInside(root: string, relativePath: string): string | null {
  if (!relativePath.startsWith("./") || relativePath.includes("\\")) return null;
  const resolved = path.resolve(root, relativePath);
  return isPathInside(root, resolved) ? resolved : null;
}

async function isSafeDeclaredComponent(root: string, filePath: string): Promise<boolean> {
  try {
    const [realRoot, realFile, stats] = await Promise.all([
      fs.realpath(root),
      fs.realpath(filePath),
      fs.lstat(filePath),
    ]);
    return (
      isPathInside(realRoot, realFile) &&
      stats.isFile() &&
      !stats.isSymbolicLink() &&
      stats.size <= MAX_COMPONENT_BYTES
    );
  } catch {
    return false;
  }
}

function isPathInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(filePath);
    return stats.isFile() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function getPersonName(value: unknown): string | null {
  if (typeof value === "string") return value;
  return getString(asObject(value)?.name);
}

function getRepositoryUrl(value: unknown): string | null {
  if (typeof value === "string") return value;
  return getString(asObject(value)?.url);
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function humanizeIdentifier(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function getNodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

interface ManifestCandidate {
  location: PluginDiscoveryLocation;
  manifestFile: string;
  pluginRoot: string;
  format: PluginManifestFormat;
}

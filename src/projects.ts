import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readRegularFileBounded } from "./safe-file.js";
import type { ApplicationId, ScanDiagnostic, ScanLocationDefinition } from "./types.js";

const PROJECT_SEARCH_DEPTH = 4;
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const IGNORED_PROJECT_FOLDERS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "_archive",
  ".archive",
]);

export interface KnownProject {
  application: ApplicationId;
  id: string;
  name: string;
  path: string;
}

export interface ProjectDiscoveryResult {
  projects: KnownProject[];
  diagnostics: ScanDiagnostic[];
}

export interface ProjectDiscoveryOptions {
  codexStateFile?: string;
  claudeStateFile?: string;
  claudeSpacesFiles?: readonly string[];
}

interface LocatedProjectSkills {
  application: ApplicationId;
  location: ScanLocationDefinition;
}

/**
 * Find project-local skill folders from the projects already known to Codex
 * and Claude. This avoids scanning the entire home directory.
 */
export async function discoverProjectSkillLocations(
  options: ProjectDiscoveryOptions = {},
): Promise<LocatedProjectSkills[]> {
  const roots = await discoverKnownProjects(options);
  return findProjectSkillLocations(roots);
}

/** Locate skill folders for an already-read project registry. */
export async function findProjectSkillLocations(
  roots: readonly KnownProject[],
): Promise<LocatedProjectSkills[]> {
  const locations = new Map<string, LocatedProjectSkills>();

  for (const root of roots) {
    await findSkillFolders(root, root.path, 0, locations);
  }

  return [...locations.values()].sort((left, right) =>
    left.location.path.localeCompare(right.location.path),
  );
}

/** Read the bounded project registries already maintained by Codex and Claude. */
export async function discoverKnownProjects(
  options: ProjectDiscoveryOptions = {},
): Promise<KnownProject[]> {
  return (await discoverKnownProjectsDetailed(options)).projects;
}

/** Read project registries and retain failures that could make a scan incomplete. */
export async function discoverKnownProjectsDetailed(
  options: ProjectDiscoveryOptions = {},
): Promise<ProjectDiscoveryResult> {
  const home = os.homedir();
  const claudeSpacesFiles =
    options.claudeSpacesFiles ??
    (await findClaudeSpacesFiles(
      path.join(home, "Library", "Application Support", "Claude", "local-agent-mode-sessions"),
    ));

  return readProjectRoots(
    options.codexStateFile ?? path.join(home, ".codex", ".codex-global-state.json"),
    options.claudeStateFile ?? path.join(home, ".claude.json"),
    claudeSpacesFiles,
  );
}

async function readProjectRoots(
  codexStateFile: string,
  claudeStateFile: string,
  claudeSpacesFiles: readonly string[],
): Promise<ProjectDiscoveryResult> {
  const roots = new Map<string, KnownProject>();
  const diagnostics: ScanDiagnostic[] = [];
  const codexResult = await readJsonObject(codexStateFile, "chatgpt");
  diagnostics.push(...codexResult.diagnostics);
  const codexState = codexResult.document;
  const localProjects = asObject(codexState?.["local-projects"]);

  for (const [projectId, value] of Object.entries(localProjects ?? {})) {
    const project = asObject(value);
    const name = typeof project?.name === "string" ? project.name : null;
    const rootPaths = Array.isArray(project?.rootPaths) ? project.rootPaths : [];
    for (const rootPath of rootPaths) {
      if (typeof rootPath === "string") {
        addProjectRoot(roots, "chatgpt", rootPath, `codex:${projectId}`, name);
      }
    }
  }

  const claudeResult = await readJsonObject(claudeStateFile, "claude");
  diagnostics.push(...claudeResult.diagnostics);
  const claudeState = claudeResult.document;
  const claudeProjects = asObject(claudeState?.projects);
  for (const rootPath of Object.keys(claudeProjects ?? {})) {
    addProjectRoot(roots, "claude", rootPath, `claude:${path.resolve(rootPath)}`, null);
  }

  // Claude Desktop stores named Cowork projects as spaces. Their names and
  // IDs are more useful than the folder-only entries in ~/.claude.json, so
  // apply them after reading the general Claude directory registry.
  for (const spacesFile of claudeSpacesFiles) {
    const spacesResult = await readJsonObject(spacesFile, "claude");
    diagnostics.push(...spacesResult.diagnostics);
    const spacesState = spacesResult.document;
    const spaces = Array.isArray(spacesState?.spaces) ? spacesState.spaces : [];

    for (const value of spaces) {
      const space = asObject(value);
      const projectId = typeof space?.id === "string" ? space.id : null;
      const name = typeof space?.name === "string" ? space.name : null;
      const folders = Array.isArray(space?.folders) ? space.folders : [];
      if (!projectId || !name) {
        continue;
      }

      for (const folderValue of folders) {
        const folder = asObject(folderValue);
        if (typeof folder?.path === "string") {
          addProjectRoot(roots, "claude", folder.path, `claude-space:${projectId}`, name, true);
        }
      }
    }
  }

  return { projects: [...roots.values()], diagnostics };
}

function addProjectRoot(
  roots: Map<string, KnownProject>,
  application: ApplicationId,
  rootPath: string,
  projectId: string,
  preferredName: string | null,
  replaceExisting = false,
): void {
  const resolvedPath = path.resolve(rootPath);
  const key = `${application}:${resolvedPath}`;
  const current = roots.get(key);
  roots.set(key, {
    application,
    id: replaceExisting ? projectId : (current?.id ?? projectId),
    path: resolvedPath,
    name: replaceExisting
      ? (preferredName ?? path.basename(resolvedPath))
      : (preferredName ?? current?.name ?? path.basename(resolvedPath)),
  });
}

async function findSkillFolders(
  registeredRoot: KnownProject,
  currentPath: string,
  depth: number,
  locations: Map<string, LocatedProjectSkills>,
): Promise<void> {
  if (depth > PROJECT_SEARCH_DEPTH) {
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const marker of [".agents", ".codex", ".claude"] as const) {
    const markerEntry = entries.find((entry) => entry.name === marker && entry.isDirectory());
    if (!markerEntry) {
      continue;
    }

    const skillsPath = path.join(currentPath, marker, "skills");
    if (!(await isRealDirectory(skillsPath))) {
      continue;
    }

    const markerMatchesApplication =
      marker === ".agents" ||
      (marker === ".codex" && registeredRoot.application === "chatgpt") ||
      (marker === ".claude" && registeredRoot.application === "claude");
    if (!markerMatchesApplication) {
      continue;
    }

    const application = registeredRoot.application;
    const key = `${application}:${skillsPath}`;
    const candidate: LocatedProjectSkills = {
      application,
      location: {
        label: `${registeredRoot.name} project skills`,
        path: skillsPath,
        source: "project",
        scope: "project",
        projectId: registeredRoot.id,
        projectName: registeredRoot.name,
        projectRoot: registeredRoot.path,
      },
    };
    const existing = locations.get(key);

    // A broad root such as ~/Documents can overlap a more specific project
    // such as ~/Documents/Job Apps. The closest registered root is the useful
    // project association for a nested skill folder.
    if (!existing || getProjectRootDepth(candidate) > getProjectRootDepth(existing)) {
      locations.set(key, candidate);
    }
  }

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      IGNORED_PROJECT_FOLDERS.has(entry.name)
    ) {
      continue;
    }

    await findSkillFolders(
      registeredRoot,
      path.join(currentPath, entry.name),
      depth + 1,
      locations,
    );
  }
}

function getProjectRootDepth(item: LocatedProjectSkills): number {
  return item.location.projectRoot?.split(path.sep).filter(Boolean).length ?? 0;
}

async function findClaudeSpacesFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  let accounts;

  try {
    accounts = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const account of accounts) {
    if (!account.isDirectory()) {
      continue;
    }

    let profiles;
    try {
      profiles = await fs.readdir(path.join(directory, account.name), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const profile of profiles) {
      if (!profile.isDirectory()) {
        continue;
      }

      const spacesFile = path.join(directory, account.name, profile.name, "spaces.json");
      try {
        if ((await fs.lstat(spacesFile)).isFile()) {
          files.push(spacesFile);
        }
      } catch {
        // Most local-agent sessions do not contain named project metadata.
      }
    }
  }

  return files;
}

async function isRealDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(directory);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readJsonObject(
  filePath: string,
  application: ApplicationId,
): Promise<{ document: Record<string, unknown> | null; diagnostics: ScanDiagnostic[] }> {
  try {
    const stats = await fs.lstat(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAX_REGISTRY_BYTES) {
      throw new Error("invalid registry file");
    }
    const contents = (await readRegularFileBounded(filePath, MAX_REGISTRY_BYTES)).toString("utf8");
    const document = asObject(JSON.parse(contents));
    if (!document) throw new Error("invalid registry format");
    return { document, diagnostics: [] };
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") return { document: null, diagnostics: [] };
    return {
      document: null,
      diagnostics: [
        {
          application,
          location: filePath,
          severity: "warning",
          code: "PROJECT_REGISTRY_INVALID",
          message:
            "A project registry could not be read safely; project inventory may be incomplete.",
        },
      ],
    };
  }
}

function getNodeErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

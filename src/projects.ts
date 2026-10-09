import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ApplicationId, ScanLocationDefinition } from "./types.js";

const PROJECT_SEARCH_DEPTH = 4;
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

interface ProjectRoot {
  id: string;
  name: string;
  path: string;
}

interface ProjectDiscoveryOptions {
  codexStateFile?: string;
  claudeStateFile?: string;
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
  const home = os.homedir();
  const roots = await readProjectRoots(
    options.codexStateFile ?? path.join(home, ".codex", ".codex-global-state.json"),
    options.claudeStateFile ?? path.join(home, ".claude.json"),
  );
  const locations = new Map<string, LocatedProjectSkills>();

  for (const root of roots) {
    await findSkillFolders(root, root.path, 0, locations);
  }

  return [...locations.values()].sort((left, right) =>
    left.location.path.localeCompare(right.location.path),
  );
}

async function readProjectRoots(
  codexStateFile: string,
  claudeStateFile: string,
): Promise<ProjectRoot[]> {
  const roots = new Map<string, ProjectRoot>();
  const codexState = await readJsonObject(codexStateFile);
  const localProjects = asObject(codexState?.["local-projects"]);

  for (const [projectId, value] of Object.entries(localProjects ?? {})) {
    const project = asObject(value);
    const name = typeof project?.name === "string" ? project.name : null;
    const rootPaths = Array.isArray(project?.rootPaths) ? project.rootPaths : [];
    for (const rootPath of rootPaths) {
      if (typeof rootPath === "string") {
        addProjectRoot(roots, rootPath, `codex:${projectId}`, name);
      }
    }
  }

  const claudeState = await readJsonObject(claudeStateFile);
  const claudeProjects = asObject(claudeState?.projects);
  for (const rootPath of Object.keys(claudeProjects ?? {})) {
    addProjectRoot(roots, rootPath, `claude:${path.resolve(rootPath)}`, null);
  }

  return [...roots.values()];
}

function addProjectRoot(
  roots: Map<string, ProjectRoot>,
  rootPath: string,
  projectId: string,
  preferredName: string | null,
): void {
  const resolvedPath = path.resolve(rootPath);
  const current = roots.get(resolvedPath);
  roots.set(resolvedPath, {
    id: current?.id ?? projectId,
    path: resolvedPath,
    name: preferredName ?? current?.name ?? path.basename(resolvedPath),
  });
}

async function findSkillFolders(
  registeredRoot: ProjectRoot,
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

    const applications: ApplicationId[] =
      marker === ".agents" ? ["chatgpt", "claude"] : marker === ".codex" ? ["chatgpt"] : ["claude"];

    for (const application of applications) {
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

      // A broad Claude root such as ~/Documents can overlap a more specific
      // ChatGPT project such as ~/Documents/Job Apps. The closest registered
      // root is the useful project association for a nested skill folder.
      if (!existing || getProjectRootDepth(candidate) > getProjectRootDepth(existing)) {
        locations.set(key, candidate);
      }
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

async function isRealDirectory(directory: string): Promise<boolean> {
  try {
    const stats = await fs.lstat(directory);
    return stats.isDirectory() && !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const contents = await fs.readFile(filePath, "utf8");
    return asObject(JSON.parse(contents));
  } catch {
    // A missing, unreadable, or partially-written application state file only
    // means that application's project roots cannot be discovered this scan.
    return null;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

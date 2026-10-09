import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { readSkillMetadata } from "./metadata.js";
import type {
  ApplicationDefinition,
  ApplicationId,
  DiscoveredSkill,
  InternalDiscoveredSkill,
  LocationScanResult,
  LocationSource,
  ScanDiagnostic,
  ScanLocationDefinition,
  ScanResult,
  SkillSourceId,
} from "./types.js";

const SKILL_FILENAME = "SKILL.md";
const DEFAULT_MAX_DEPTH = 10;

// These folders can be very large and cannot contain a skill definition that
// belongs to the parent package. Skipping them makes scans faster and safer.
const IGNORED_DIRECTORY_NAMES = new Set([
  ".git",
  "node_modules",
  "coverage",
  "dist",
  "build",
  "target",
  "__pycache__",
]);

/**
 * Scan one or more application locations for directories containing SKILL.md.
 *
 * This function is deliberately read-only. It parses declarative frontmatter
 * but never executes skill instructions or supporting files.
 */
export async function scanApplications({
  applications,
  maxDepth = DEFAULT_MAX_DEPTH,
}: ScanApplicationsOptions): Promise<ScanResult> {
  const skills: DiscoveredSkill[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const seenSkills = new Set<string>();

  for (const application of applications) {
    for (const location of application.locations) {
      const result = await scanLocation({
        application,
        location,
        maxDepth,
      });

      diagnostics.push(...result.diagnostics);

      for (const skill of result.skills) {
        // Claude Desktop can keep identical copies of a skill for multiple
        // sessions. Name + content identifies exact mirrors without merging two
        // different skills that happen to use the same folder name.
        const identity = skill.contentFingerprint
          ? `${skill.application}:${skill.scope}:${skill.projectRoot ?? "global"}:${skill.name}:${skill.contentFingerprint}`
          : `${skill.application}:${skill.instructionFile}`;

        if (!seenSkills.has(identity)) {
          seenSkills.add(identity);
          const { contentFingerprint: _contentFingerprint, ...publicSkill } = skill;
          skills.push(publicSkill);
        }
      }
    }
  }

  skills.sort((left, right) => {
    const byApplication = left.application.localeCompare(right.application);
    return byApplication || left.name.localeCompare(right.name);
  });

  return { skills, diagnostics };
}

/**
 * Scan a single configured location.
 * Exported for focused tests and future custom-location support.
 */
export async function scanLocation({
  application,
  location,
  maxDepth = DEFAULT_MAX_DEPTH,
}: ScanLocationOptions): Promise<LocationScanResult> {
  const skills: InternalDiscoveredSkill[] = [];
  const diagnostics: ScanDiagnostic[] = [];
  const rootPath = path.resolve(location.path);

  let rootStats;
  try {
    rootStats = await fs.lstat(rootPath);
  } catch (error) {
    diagnostics.push(createAccessDiagnostic(application, location, rootPath, error));
    return { skills, diagnostics };
  }

  if (rootStats.isSymbolicLink()) {
    diagnostics.push({
      application: application.id,
      location: rootPath,
      severity: "warning",
      code: "SYMLINK_ROOT_SKIPPED",
      message: "The scan root is a symbolic link, so it was skipped for safety.",
    });
    return { skills, diagnostics };
  }

  if (!rootStats.isDirectory()) {
    diagnostics.push({
      application: application.id,
      location: rootPath,
      severity: "warning",
      code: "NOT_A_DIRECTORY",
      message: "The configured scan location is not a directory.",
    });
    return { skills, diagnostics };
  }

  await walkDirectory({
    application,
    location,
    currentPath: rootPath,
    depth: 0,
    maxDepth,
    skills,
    diagnostics,
  });

  return { skills, diagnostics };
}

async function walkDirectory({
  application,
  location,
  currentPath,
  depth,
  maxDepth,
  skills,
  diagnostics,
}: WalkDirectoryOptions): Promise<void> {
  if (depth > maxDepth) {
    diagnostics.push({
      application: application.id,
      location: currentPath,
      severity: "warning",
      code: "MAX_DEPTH_REACHED",
      message: `Stopped scanning below the maximum depth of ${maxDepth}.`,
    });
    return;
  }

  let entries;
  try {
    entries = await fs.readdir(currentPath, { withFileTypes: true });
  } catch (error) {
    diagnostics.push({
      application: application.id,
      location: currentPath,
      severity: "warning",
      code: getNodeErrorCode(error) === "EACCES" ? "PERMISSION_DENIED" : "READ_FAILED",
      message: `Could not read this directory: ${getErrorMessage(error)}`,
    });
    return;
  }

  const instructionEntry = entries.find((entry) => entry.isFile() && entry.name === SKILL_FILENAME);

  if (instructionEntry) {
    const instructionFile = path.join(currentPath, SKILL_FILENAME);
    const folderName = path.basename(currentPath);
    const stats = await safeStat(instructionFile);
    const contentFingerprint = await createFileFingerprint(instructionFile);
    const metadata = await readSkillMetadata(instructionFile, folderName);
    const source = classifySkillSource(application.id, location.source, currentPath);

    skills.push({
      application: application.id,
      applicationName: application.displayName,
      name: metadata.name,
      folderName,
      description: metadata.description,
      metadataStatus: metadata.metadataStatus,
      metadataIssues: metadata.metadataIssues,
      directory: currentPath,
      instructionFile,
      source: source.id,
      sourceName: source.displayName,
      sourceLabel: location.label,
      scope: location.scope ?? "global",
      projectId: location.projectId ?? null,
      projectName: location.projectName ?? null,
      projectRoot: location.projectRoot ?? null,
      modifiedAt: stats?.mtime?.toISOString() ?? null,
      contentFingerprint,
    });

    // A folder containing SKILL.md is a skill root. Do not recursively treat
    // supporting folders inside the skill as separate installed skills.
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || IGNORED_DIRECTORY_NAMES.has(entry.name)) {
      continue;
    }

    // Dirent#isDirectory is false for symbolic links, so links are not followed.
    await walkDirectory({
      application,
      location,
      currentPath: path.join(currentPath, entry.name),
      depth: depth + 1,
      maxDepth,
      skills,
      diagnostics,
    });
  }
}

async function safeStat(filePath: string): Promise<Stats | null> {
  try {
    return await fs.stat(filePath);
  } catch {
    // A file can disappear while a scan is running. Discovery should continue.
    return null;
  }
}

async function createFileFingerprint(filePath: string): Promise<string | null> {
  try {
    const contents = await fs.readFile(filePath);
    return createHash("sha256").update(contents).digest("hex");
  } catch {
    // If a file disappears or becomes unreadable, path-based identity is still
    // enough to report the discovered marker without stopping the whole scan.
    return null;
  }
}

interface ClassifiedSource {
  id: SkillSourceId;
  displayName: string;
}

function classifySkillSource(
  applicationId: ApplicationId,
  configuredSource: LocationSource,
  skillPath: string,
): ClassifiedSource {
  if (applicationId === "chatgpt" && configuredSource === "default") {
    const isSystemSkill = skillPath.split(path.sep).includes(".system");
    return isSystemSkill
      ? { id: "system", displayName: "System" }
      : { id: "personal", displayName: "Personal" };
  }

  if (applicationId === "chatgpt" && configuredSource === "plugin") {
    const isCache = skillPath.split(path.sep).includes("cache");
    return isCache
      ? { id: "plugin-cache", displayName: "Plugin cache" }
      : { id: "plugin", displayName: "Plugin" };
  }

  if (configuredSource === "desktop-plugin") {
    return { id: "claude-desktop-plugin", displayName: "Claude Desktop plugin" };
  }

  if (configuredSource === "project") {
    return { id: "project", displayName: "Project" };
  }

  if (configuredSource === "plugin") {
    return { id: "plugin", displayName: "Plugin" };
  }

  return { id: "personal", displayName: "Personal" };
}

function createAccessDiagnostic(
  application: ApplicationDefinition,
  location: ScanLocationDefinition,
  rootPath: string,
  error: unknown,
): ScanDiagnostic {
  if (getNodeErrorCode(error) === "ENOENT") {
    return {
      application: application.id,
      location: rootPath,
      severity: "info",
      code: "LOCATION_NOT_FOUND",
      message: `${location.label} was not found. This usually means no items are installed there.`,
    };
  }

  return {
    application: application.id,
    location: rootPath,
    severity: "warning",
    code: getNodeErrorCode(error) === "EACCES" ? "PERMISSION_DENIED" : "READ_FAILED",
    message: `Could not inspect ${location.label}: ${getErrorMessage(error)}`,
  };
}

interface ScanApplicationsOptions {
  applications: ApplicationDefinition[];
  maxDepth?: number;
}

interface ScanLocationOptions {
  application: ApplicationDefinition;
  location: ScanLocationDefinition;
  maxDepth?: number;
}

interface WalkDirectoryOptions {
  application: ApplicationDefinition;
  location: ScanLocationDefinition;
  currentPath: string;
  depth: number;
  maxDepth: number;
  skills: InternalDiscoveredSkill[];
  diagnostics: ScanDiagnostic[];
}

function getNodeErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String(error.code)
    : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

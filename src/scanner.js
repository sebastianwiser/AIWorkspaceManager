import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

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
 * This function is deliberately read-only. It does not parse or execute skill
 * content. A later milestone can inspect metadata after discovery is trusted.
 *
 * @param {object} options
 * @param {Array<object>} options.applications Application definitions to scan.
 * @param {number} [options.maxDepth] Maximum directory depth below each root.
 * @returns {Promise<{skills: Array<object>, diagnostics: Array<object>}>}
 */
export async function scanApplications({
  applications,
  maxDepth = DEFAULT_MAX_DEPTH,
}) {
  const skills = [];
  const diagnostics = [];
  const seenSkills = new Set();

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
          ? `${skill.application}:${skill.name}:${skill.contentFingerprint}`
          : `${skill.application}:${skill.instructionFile}`;

        if (!seenSkills.has(identity)) {
          seenSkills.add(identity);
          const { contentFingerprint, ...publicSkill } = skill;
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
export async function scanLocation({ application, location, maxDepth = DEFAULT_MAX_DEPTH }) {
  const skills = [];
  const diagnostics = [];
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
}) {
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
      code: error.code === "EACCES" ? "PERMISSION_DENIED" : "READ_FAILED",
      message: `Could not read this directory: ${error.message}`,
    });
    return;
  }

  const instructionEntry = entries.find(
    (entry) => entry.isFile() && entry.name === SKILL_FILENAME,
  );

  if (instructionEntry) {
    const instructionFile = path.join(currentPath, SKILL_FILENAME);
    const stats = await safeStat(instructionFile);
    const contentFingerprint = await createFileFingerprint(instructionFile);

    skills.push({
      application: application.id,
      applicationName: application.displayName,
      name: path.basename(currentPath),
      directory: currentPath,
      instructionFile,
      source: location.source,
      sourceLabel: location.label,
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

async function safeStat(filePath) {
  try {
    return await fs.stat(filePath);
  } catch {
    // A file can disappear while a scan is running. Discovery should continue.
    return null;
  }
}

async function createFileFingerprint(filePath) {
  try {
    const contents = await fs.readFile(filePath);
    return createHash("sha256").update(contents).digest("hex");
  } catch {
    // If a file disappears or becomes unreadable, path-based identity is still
    // enough to report the discovered marker without stopping the whole scan.
    return null;
  }
}

function createAccessDiagnostic(application, location, rootPath, error) {
  if (error.code === "ENOENT") {
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
    code: error.code === "EACCES" ? "PERMISSION_DENIED" : "READ_FAILED",
    message: `Could not inspect ${location.label}: ${error.message}`,
  };
}

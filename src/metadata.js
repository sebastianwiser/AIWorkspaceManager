import fs from "node:fs/promises";
import { parseDocument } from "yaml";

// Skill instructions can be large, but useful frontmatter should remain small.
// Limiting only the parsed header avoids feeding an unexpectedly large YAML
// document to the parser while leaving the rest of the skill untouched.
const MAX_FRONTMATTER_BYTES = 64 * 1024;

/**
 * Read and parse the YAML frontmatter at the beginning of a SKILL.md file.
 *
 * The YAML library only creates plain data. No discovered code is executed.
 */
export async function readSkillMetadata(filePath, fallbackName) {
  try {
    const contents = await fs.readFile(filePath);
    return parseSkillMetadata(contents, fallbackName);
  } catch (error) {
    return createMetadataResult({
      name: fallbackName,
      status: "unreadable",
      issues: [`Could not read metadata: ${error.message}`],
    });
  }
}

/** Parse metadata from a Buffer or string. Exported for isolated tests. */
export function parseSkillMetadata(contents, fallbackName) {
  const header = Buffer.isBuffer(contents)
    ? contents.subarray(0, MAX_FRONTMATTER_BYTES).toString("utf8")
    : String(contents).slice(0, MAX_FRONTMATTER_BYTES);
  const normalizedHeader = header.replace(/^\uFEFF/, "");

  if (!normalizedHeader.startsWith("---\n") && !normalizedHeader.startsWith("---\r\n")) {
    return createMetadataResult({
      name: fallbackName,
      status: "missing",
      issues: ["SKILL.md does not start with YAML frontmatter."],
    });
  }

  const match = normalizedHeader.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    return createMetadataResult({
      name: fallbackName,
      status: "invalid",
      issues: ["YAML frontmatter is not closed within the first 64 KB."],
    });
  }

  const document = parseDocument(match[1], {
    prettyErrors: false,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    return createMetadataResult({
      name: fallbackName,
      status: "invalid",
      issues: document.errors.map((error) => `Invalid YAML: ${error.message}`),
    });
  }

  let data;
  try {
    data = document.toJS({ maxAliasCount: 10 });
  } catch (error) {
    return createMetadataResult({
      name: fallbackName,
      status: "invalid",
      issues: [`Invalid YAML: ${error.message}`],
    });
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return createMetadataResult({
      name: fallbackName,
      status: "invalid",
      issues: ["YAML frontmatter must contain name and description fields."],
    });
  }

  const declaredName = normalizeTextValue(data.name);
  const description = normalizeTextValue(data.description);
  const issues = [];

  if (!declaredName) {
    issues.push("Metadata is missing a valid name.");
  }
  if (!description) {
    issues.push("Metadata is missing a valid description.");
  }

  return createMetadataResult({
    name: declaredName || fallbackName,
    description,
    status: issues.length === 0 ? "valid" : "incomplete",
    issues,
  });
}

function normalizeTextValue(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createMetadataResult({ name, description = null, status, issues }) {
  return {
    name,
    description,
    metadataStatus: status,
    metadataIssues: issues,
  };
}

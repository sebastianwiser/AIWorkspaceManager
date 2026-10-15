import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getMcpServerIdentity, getPluginIdentity, getSkillIdentity } from "../inventory.js";
import { hashRegularFile, readRegularFileBounded } from "../safe-file.js";
import type {
  ApplicationId,
  AuditFileRecord,
  AuditItemKind,
  AuditObservation,
  AuditSignal,
  ScanResult,
} from "../types.js";

interface FileAssociation {
  itemKind: Exclude<AuditItemKind, "source">;
  itemId: string;
  application: ApplicationId;
  inspectText: boolean;
  sensitiveConfig: boolean;
  executable: boolean;
}

interface FileTarget {
  filePath: string;
  maxBytes: number;
  associations: FileAssociation[];
}

const MAX_SKILL_BYTES = 512 * 1024;
const MAX_PLUGIN_BYTES = 1024 * 1024;
const MAX_MCP_BYTES = 2 * 1024 * 1024;
const MAX_BUNDLE_FILES = 256;
const MAX_BUNDLE_DEPTH = 5;
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
const BUNDLE_IGNORED = new Set([".git", "node_modules", ".venv", "dist", "build"]);
const TEXT_FILE =
  /\.(?:md|txt|json|jsonc|yaml|yml|toml|js|cjs|mjs|ts|py|sh|bash|zsh|ps1|bat|cmd|html|css)$/i;
const SCRIPT_FILE = /\.(?:js|cjs|mjs|ts|py|sh|bash|zsh|ps1|bat|cmd)$/i;

export interface AuditEvidence {
  observations: AuditObservation[];
  files: AuditFileRecord[];
}

/**
 * Inspect only files already named by discovery. No contents, matched values, or commands
 * leave this trusted layer: the pure audit engine receives controlled signal codes only.
 */
export async function collectAuditObservations(
  scan: Readonly<ScanResult>,
): Promise<AuditObservation[]> {
  return (await collectAuditEvidence(scan)).observations;
}

export async function collectAuditEvidence(scan: Readonly<ScanResult>): Promise<AuditEvidence> {
  const targets = new Map<string, FileTarget>();
  const bundleObservations: AuditObservation[] = [];
  const add = (filePath: string, maxBytes: number, association: FileAssociation): void => {
    const target = targets.get(filePath) ?? { filePath, maxBytes, associations: [] };
    target.maxBytes = Math.max(target.maxBytes, maxBytes);
    const existing = target.associations.find(
      (item) =>
        item.itemKind === association.itemKind &&
        item.itemId === association.itemId &&
        item.application === association.application &&
        item.executable === association.executable,
    );
    if (existing) {
      existing.inspectText ||= association.inspectText;
      existing.sensitiveConfig ||= association.sensitiveConfig;
    } else {
      target.associations.push(association);
    }
    targets.set(filePath, target);
  };

  for (const skill of scan.skills) {
    const association: FileAssociation = {
      itemKind: "skill",
      itemId: getSkillIdentity(skill),
      application: skill.application,
      inspectText: true,
      sensitiveConfig: false,
      executable: false,
    };
    add(skill.instructionFile, MAX_SKILL_BYTES, association);
    bundleObservations.push(
      ...(await addBundleTargets(skill.directory, MAX_SKILL_BYTES, association, add)),
    );
  }

  for (const server of scan.mcpServers) {
    const association: FileAssociation = {
      itemKind: "mcp",
      itemId: getMcpServerIdentity(server),
      application: server.application,
      inspectText: true,
      sensitiveConfig: true,
      executable: false,
    };
    add(server.configurationFile, MAX_MCP_BYTES, association);
    if (server.transport === "stdio" && server.command && path.isAbsolute(server.command)) {
      add(server.command, 0, {
        ...association,
        inspectText: false,
        sensitiveConfig: false,
        executable: true,
      });
    }
  }

  for (const plugin of scan.plugins) {
    const association: FileAssociation = {
      itemKind: "plugin",
      itemId: getPluginIdentity(plugin),
      application: plugin.application,
      inspectText: true,
      sensitiveConfig: false,
      executable: false,
    };
    add(plugin.manifestFile, MAX_PLUGIN_BYTES, association);
    bundleObservations.push(
      ...(await addBundleTargets(plugin.directory, MAX_PLUGIN_BYTES, association, add)),
    );
    // Skill references are scanned as first-class skills; re-reading them here would
    // produce duplicate findings attributed to both the skill and its plugin.
    for (const reference of plugin.mcpServers) {
      const filePath = reference.configurationFile;
      if (isInside(plugin.directory, filePath)) add(filePath, MAX_PLUGIN_BYTES, association);
    }
    if (plugin.hasHooks) {
      const hookFile = path.join(plugin.directory, "hooks", "hooks.json");
      try {
        await fs.lstat(hookFile);
        add(hookFile, MAX_PLUGIN_BYTES, association);
      } catch {
        // Hooks may be declared inline in the manifest instead of a separate file.
      }
    }
  }

  const observations: AuditObservation[] = [...bundleObservations];
  const files: AuditFileRecord[] = [];
  for (const target of [...targets.values()].sort((left, right) =>
    left.filePath.localeCompare(right.filePath),
  )) {
    const inspected = await inspectTarget(target);
    observations.push(...inspected.observations);
    files.push(...inspected.files);
  }
  return {
    observations: observations.sort(
      (left, right) =>
        left.application.localeCompare(right.application) ||
        left.sourceFile.localeCompare(right.sourceFile) ||
        left.signal.localeCompare(right.signal) ||
        left.itemId.localeCompare(right.itemId),
    ),
    files: files.sort(
      (left, right) =>
        left.application.localeCompare(right.application) ||
        left.sourceFile.localeCompare(right.sourceFile) ||
        left.itemId.localeCompare(right.itemId),
    ),
  };
}

async function inspectTarget(target: FileTarget): Promise<AuditEvidence> {
  const result: AuditObservation[] = [];
  const files: AuditFileRecord[] = [];
  const add = (signal: AuditSignal, line: number | null, association: FileAssociation): void => {
    result.push({
      itemKind: association.itemKind,
      itemId: association.itemId,
      application: association.application,
      sourceFile: target.filePath,
      line,
      signal,
    });
  };
  let stats;
  try {
    stats = await fs.lstat(target.filePath);
  } catch (error) {
    const signal = isMissing(error) ? "missing-file" : "unreadable-file";
    for (const association of target.associations) {
      add(
        association.executable && signal === "missing-file" ? "missing-executable" : signal,
        null,
        association,
      );
    }
    return { observations: result, files };
  }
  if (stats.isSymbolicLink()) {
    for (const association of target.associations) add("symlink-file", null, association);
    return { observations: result, files };
  }
  if (!stats.isFile()) {
    for (const association of target.associations)
      add(association.executable ? "non-executable" : "unreadable-file", null, association);
    return { observations: result, files };
  }
  for (const association of target.associations) {
    if (process.platform !== "win32" && (stats.mode & 0o022) !== 0)
      add("world-writable", null, association);
    if (process.platform !== "win32" && association.sensitiveConfig && (stats.mode & 0o004) !== 0) {
      add("world-readable-config", null, association);
    }
    if (association.executable && process.platform !== "win32" && (stats.mode & 0o111) === 0) {
      add("non-executable", null, association);
    }
  }
  if (!target.associations.some((association) => association.inspectText)) {
    const bundleFiles = target.associations.filter((association) => !association.executable);
    if (bundleFiles.length > 0) {
      if (stats.size > target.maxBytes) {
        for (const association of bundleFiles) add("oversized-file", null, association);
      } else {
        try {
          const sha256 = await hashRegularFile(target.filePath, target.maxBytes);
          for (const association of bundleFiles) {
            files.push({
              application: association.application,
              itemKind: association.itemKind,
              itemId: association.itemId,
              sourceFile: target.filePath,
              bytes: stats.size,
              sha256,
              isScript: SCRIPT_FILE.test(target.filePath),
            });
          }
        } catch {
          for (const association of bundleFiles) add("unreadable-file", null, association);
        }
      }
    }
    return { observations: result, files };
  }
  if (stats.size > target.maxBytes) {
    for (const association of target.associations.filter((item) => item.inspectText))
      add("oversized-file", null, association);
    return { observations: result, files };
  }
  let data: Buffer;
  try {
    data = await readRegularFileBounded(target.filePath, target.maxBytes);
  } catch {
    for (const association of target.associations.filter((item) => item.inspectText))
      add("unreadable-file", null, association);
    return { observations: result, files };
  }
  const sha256 = createHash("sha256").update(data).digest("hex");
  const contents = data.toString("utf8");
  for (const association of target.associations.filter((item) => item.inspectText)) {
    files.push({
      application: association.application,
      itemKind: association.itemKind,
      itemId: association.itemId,
      sourceFile: target.filePath,
      bytes: stats.size,
      sha256,
      isScript: SCRIPT_FILE.test(target.filePath),
    });
  }
  const patterns: Array<[AuditSignal, RegExp]> = [
    [
      "literal-credential-pattern",
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16})\b/i,
    ],
    [
      "credential-assignment",
      /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*["']?\s*[:=]\s*["']?(?!\$|<|\[REDACTED\]|process\.env|os\.environ)[^\s"']{8,}/i,
    ],
    [
      "risky-command-pattern",
      /\b(?:curl|wget)\b[^\n]{0,200}\|\s*(?:sh|bash|zsh)\b|\brm\s+-[rRfF]{2,}\b|\bsudo\s+[^\n]{1,120}/i,
    ],
    [
      "broad-access-pattern",
      /--(?:dangerously-skip-permissions|allow-all)\b|\bchmod\s+777\b|--filesystem(?:=|\s+)\/(?:\s|$)/i,
    ],
  ];
  for (const [signal, pattern] of patterns) {
    const match = pattern.exec(contents);
    if (!match) continue;
    const line = 1 + (contents.slice(0, match.index).match(/\n/g)?.length ?? 0);
    for (const association of target.associations.filter((item) => item.inspectText))
      add(signal, line, association);
  }
  const skillAssociations = target.associations.filter((item) => item.itemKind === "skill");
  if (skillAssociations.length > 0) {
    const links = contents.matchAll(/!?\[[^\]\n]{0,120}\]\(([^)\n]{1,300})\)/g);
    let checked = 0;
    for (const match of links) {
      if (++checked > 64) {
        for (const association of skillAssociations)
          add("resource-check-limited", null, association);
        break;
      }
      const raw = match[1]?.trim().split(/\s+["']/)[0] ?? "";
      if (!raw || raw.startsWith("#") || raw.startsWith("//") || /^[a-z][a-z0-9+.-]*:/i.test(raw))
        continue;
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw.split(/[?#]/)[0]);
      } catch {
        continue;
      }
      if (!decoded || path.isAbsolute(decoded)) continue;
      const root = path.dirname(target.filePath);
      const resolved = path.resolve(root, decoded);
      const line = 1 + (contents.slice(0, match.index).match(/\n/g)?.length ?? 0);
      // Relative links outside the skill directory are common documentation links.
      // They are outside this bounded check, not evidence of a broken resource.
      if (!isInside(root, resolved)) continue;
      const signal = await inspectResourcePath(root, resolved);
      if (signal) for (const association of skillAssociations) add(signal, line, association);
    }
  }
  return { observations: result, files };
}

async function addBundleTargets(
  root: string,
  maxBytes: number,
  association: FileAssociation,
  add: (filePath: string, maxBytes: number, association: FileAssociation) => void,
): Promise<AuditObservation[]> {
  const observations: AuditObservation[] = [];
  let count = 0;
  let totalBytes = 0;
  const limited = (): void => {
    if (observations.some((item) => item.signal === "bundle-check-limited")) return;
    observations.push({
      itemKind: association.itemKind,
      itemId: association.itemId,
      application: association.application,
      sourceFile: root,
      line: null,
      signal: "bundle-check-limited",
    });
  };
  const walk = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_BUNDLE_DEPTH) return limited();
    let handle;
    try {
      handle = await fs.opendir(directory);
      for await (const entry of handle) {
        if (BUNDLE_IGNORED.has(entry.name) || entry.name.startsWith(".skillmanager-")) continue;
        if (++count > MAX_BUNDLE_FILES) return limited();
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          add(candidate, 0, { ...association, inspectText: false });
        } else if (entry.isDirectory()) {
          await walk(candidate, depth + 1);
        } else if (entry.isFile()) {
          let stats;
          try {
            stats = await fs.lstat(candidate);
          } catch {
            add(candidate, maxBytes, association);
            continue;
          }
          totalBytes += stats.size;
          if (totalBytes > MAX_BUNDLE_BYTES) return limited();
          add(candidate, maxBytes, {
            ...association,
            inspectText: TEXT_FILE.test(candidate),
          });
        }
      }
    } catch {
      limited();
    } finally {
      await handle?.close().catch(() => undefined);
    }
  };
  await walk(root, 0);
  return observations;
}

async function inspectResourcePath(root: string, candidate: string): Promise<AuditSignal | null> {
  const relative = path.relative(root, candidate);
  let current = root;
  for (const component of relative.split(path.sep)) {
    if (!component) continue;
    current = path.join(current, component);
    try {
      const stats = await fs.lstat(current);
      if (stats.isSymbolicLink()) return "resource-symlink";
    } catch (error) {
      return isMissing(error) ? "missing-resource" : "unreadable-file";
    }
  }
  return null;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

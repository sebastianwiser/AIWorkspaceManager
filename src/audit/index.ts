import { createHash } from "node:crypto";
import { getMcpServerIdentity, getPluginIdentity, getSkillIdentity } from "../inventory.js";
import type {
  ApplicationId,
  AuditCoverage,
  AuditFamily,
  AuditFileRecord,
  AuditFinding,
  AuditObservation,
  AuditReport,
  AuditSignal,
  ScanResult,
} from "../types.js";

const FAMILIES = [
  "structure",
  "exposure",
  "commands",
  "provenance",
] as const satisfies readonly AuditFamily[];
const INCOMPLETE_DIAGNOSTICS = new Set([
  "PERMISSION_DENIED",
  "READ_FAILED",
  "SYMLINK_ROOT_SKIPPED",
  "NOT_A_DIRECTORY",
  "MAX_DEPTH_REACHED",
  "PROJECT_REGISTRY_INVALID",
  "MCP_CONFIG_INVALID",
  "PLUGIN_MANIFEST_INVALID",
  "PLUGIN_RECORD_INVALID",
]);
const UNINSPECTED_SIGNALS = new Set<AuditSignal>([
  "missing-file",
  "unreadable-file",
  "oversized-file",
  "symlink-file",
  "resource-symlink",
  "resource-check-limited",
  "bundle-check-limited",
]);

type FindingInput = Omit<AuditFinding, "id">;

/** Deterministic findings over sanitized scan records and controlled observation codes. */
export function createAuditReport(
  scan: Readonly<ScanResult>,
  observations: readonly AuditObservation[],
  applicationIds: readonly ApplicationId[],
  generatedAt: string,
  files: readonly AuditFileRecord[] = [],
): AuditReport {
  const findings = new Map<string, AuditFinding>();
  const add = (input: FindingInput): void => {
    const itemIds = [...new Set(input.itemIds)].sort();
    const id = createHash("sha256")
      .update(
        JSON.stringify([
          input.ruleId,
          input.application,
          input.itemKind,
          itemIds,
          input.sourceFile,
          input.line,
        ]),
      )
      .digest("hex");
    findings.set(id, { ...input, id, itemIds });
  };

  for (const skill of scan.skills) {
    if (skill.metadataStatus === "valid") continue;
    add({
      ruleId: "skill.metadata",
      family: "structure",
      severity: skill.metadataStatus === "incomplete" ? "info" : "warning",
      confidence: "observed",
      title: "Skill metadata needs attention",
      explanation: "The discovered skill did not produce complete, valid metadata.",
      remedy: "Review the SKILL.md frontmatter and rescan after correcting it.",
      application: skill.application,
      itemKind: "skill",
      itemIds: [getSkillIdentity(skill)],
      sourceFile: skill.instructionFile,
      line: null,
      evidence: `Metadata status: ${skill.metadataStatus}.`,
    });
  }

  for (const server of scan.mcpServers) {
    const itemId = getMcpServerIdentity(server);
    if (
      server.status === "invalid" ||
      server.issues.some((issue) => !issue.startsWith("Another server"))
    ) {
      add({
        ruleId: "mcp.invalid",
        family: "structure",
        severity: "warning",
        confidence: "observed",
        title: "MCP definition is invalid",
        explanation:
          "The configuration parser found an unsupported or incomplete server declaration.",
        remedy: "Review the source configuration and its transport requirements.",
        application: server.application,
        itemKind: "mcp",
        itemIds: [itemId],
        sourceFile: server.configurationFile,
        line: null,
        evidence: "The discovered server has validation issues; private values are not shown.",
      });
    }
    if (server.url?.startsWith("http://")) {
      add({
        ruleId: "mcp.plaintext-http",
        family: "exposure",
        severity: "warning",
        confidence: "possible",
        title: "MCP endpoint uses plain HTTP",
        explanation:
          "A configured network endpoint does not use TLS. Whether sensitive data is sent is unknown.",
        remedy: "Prefer HTTPS when the server supports it, and review what data is sent.",
        application: server.application,
        itemKind: "mcp",
        itemIds: [itemId],
        sourceFile: server.configurationFile,
        line: null,
        evidence: "The sanitized endpoint begins with http://.",
      });
    }
    if (
      [...server.environmentVariables, ...server.headerNames].some((name) =>
        /(?:api[_-]?key|secret|token|password|authorization|cookie|credential)/i.test(name),
      )
    ) {
      add({
        ruleId: "mcp.sensitive-name",
        family: "exposure",
        severity: "info",
        confidence: "observed",
        title: "Sensitive configuration name declared",
        explanation:
          "The server names a credential-like environment variable or header. This does not show whether a value is exposed.",
        remedy:
          "Confirm the value is supplied privately and not committed in a configuration file.",
        application: server.application,
        itemKind: "mcp",
        itemIds: [itemId],
        sourceFile: server.configurationFile,
        line: null,
        evidence:
          "A credential-like variable or header name was observed; its name and value are omitted here.",
      });
    }
    if (
      server.transport === "stdio" &&
      server.command &&
      /(?:^|\/)(?:sh|bash|zsh|powershell|pwsh|cmd)(?:\.exe)?$/i.test(server.command)
    ) {
      add({
        ruleId: "mcp.shell-command",
        family: "commands",
        severity: "warning",
        confidence: "possible",
        title: "MCP server uses a shell interpreter",
        explanation:
          "A shell can execute dynamic input. The static scan does not determine what this command will run.",
        remedy: "Inspect the complete local command and arguments before starting the server.",
        application: server.application,
        itemKind: "mcp",
        itemIds: [itemId],
        sourceFile: server.configurationFile,
        line: null,
        evidence: "The configured command is a shell interpreter.",
      });
    }
  }

  const duplicateMcp = new Map<string, typeof scan.mcpServers>();
  for (const server of scan.mcpServers) {
    const key = JSON.stringify([
      server.application,
      server.scope,
      server.projectId,
      server.name.toLocaleLowerCase(),
    ]);
    duplicateMcp.set(key, [...(duplicateMcp.get(key) ?? []), server]);
  }
  for (const group of duplicateMcp.values()) {
    if (group.length < 2 || new Set(group.map((item) => item.configurationFile)).size < 2) continue;
    const ordered = [...group].sort((left, right) =>
      left.configurationFile.localeCompare(right.configurationFile),
    );
    add({
      ruleId: "mcp.same-scope-duplicate",
      family: "structure",
      severity: "warning",
      confidence: "observed",
      title: "MCP server declared more than once",
      explanation:
        "Multiple configuration files declare the same server name for one application and scope.",
      remedy: "Compare the declarations and remove or rename the unintended duplicate manually.",
      application: ordered[0].application,
      itemKind: "mcp",
      itemIds: ordered.map(getMcpServerIdentity),
      sourceFile: ordered[0].configurationFile,
      line: null,
      evidence: `${group.length} declarations were observed in this scope.`,
    });
  }

  const sameNameSkills = new Map<string, typeof scan.skills>();
  for (const skill of scan.skills) {
    const key = JSON.stringify([
      skill.application,
      skill.scope,
      skill.projectId,
      skill.name.toLocaleLowerCase(),
    ]);
    sameNameSkills.set(key, [...(sameNameSkills.get(key) ?? []), skill]);
  }
  for (const group of sameNameSkills.values()) {
    if (new Set(group.map((item) => item.instructionFile)).size < 2) continue;
    const ordered = [...group].sort((left, right) =>
      left.instructionFile.localeCompare(right.instructionFile),
    );
    add({
      ruleId: "skill.same-name-candidate",
      family: "structure",
      severity: "info",
      confidence: "possible",
      title: "Same-name skill variants share a scope",
      explanation:
        "Separate files use the same skill name. They may be deliberate variants, not duplicates.",
      remedy:
        "Compare the variants and confirm that both are intended for this application and scope.",
      application: ordered[0].application,
      itemKind: "skill",
      itemIds: ordered.map(getSkillIdentity),
      sourceFile: ordered[0].instructionFile,
      line: null,
      evidence: `${group.length} distinct skill files were observed.`,
    });
  }

  for (const plugin of scan.plugins) {
    const itemId = getPluginIdentity(plugin);
    if (plugin.status !== "valid") {
      add({
        ruleId: "plugin.manifest",
        family: "structure",
        severity: plugin.status === "invalid" ? "warning" : "info",
        confidence: "observed",
        title: "Plugin manifest needs attention",
        explanation: "A plugin manifest is invalid or missing recommended metadata.",
        remedy: "Review the manifest and rescan after fixing its declared fields.",
        application: plugin.application,
        itemKind: "plugin",
        itemIds: [itemId],
        sourceFile: plugin.manifestFile,
        line: null,
        evidence: `Manifest status: ${plugin.status}.`,
      });
    }
    if (plugin.issues.some((issue) => issue.startsWith("A declared plugin component path"))) {
      add({
        ruleId: "plugin.broken-component-reference",
        family: "structure",
        severity: "warning",
        confidence: "observed",
        title: "Plugin component reference could not be resolved",
        explanation:
          "A declared component file is absent, unreadable, or outside its plugin boundary.",
        remedy:
          "Review the manifest's component paths and restore a regular file inside the plugin bundle.",
        application: plugin.application,
        itemKind: "plugin",
        itemIds: [itemId],
        sourceFile: plugin.manifestFile,
        line: null,
        evidence: "A declared component path failed a bounded local path check.",
      });
    }
    if (plugin.installationStatus === "cached" || plugin.installationStatus === "unverified") {
      add({
        ruleId: "plugin.installation-unverified",
        family: "provenance",
        severity: "info",
        confidence: "observed",
        title: "Plugin installation is unverified",
        explanation:
          "A local bundle or cache entry is not proof that the application has installed or enabled it.",
        remedy: "Confirm its installation state in the owning application before relying on it.",
        application: plugin.application,
        itemKind: "plugin",
        itemIds: [itemId],
        sourceFile: plugin.manifestFile,
        line: null,
        evidence: `Installation evidence: ${plugin.installationStatus}.`,
      });
    }
    if (!plugin.version || !plugin.author || !plugin.license) {
      add({
        ruleId: "plugin.provenance-incomplete",
        family: "provenance",
        severity: "info",
        confidence: "observed",
        title: "Plugin provenance is incomplete",
        explanation: "The manifest omits one or more version, publisher, or license fields.",
        remedy: "Check the plugin source and record the missing provenance before sharing it.",
        application: plugin.application,
        itemKind: "plugin",
        itemIds: [itemId],
        sourceFile: plugin.manifestFile,
        line: null,
        evidence: "A version, publisher, or license field is absent.",
      });
    }
    if (plugin.hasHooks) {
      add({
        ruleId: "plugin.hooks-declared",
        family: "commands",
        severity: "info",
        confidence: "observed",
        title: "Plugin declares hooks",
        explanation:
          "Hooks can trigger application-managed actions. This audit does not execute or verify them.",
        remedy: "Inspect the hook definitions before enabling or sharing the plugin.",
        application: plugin.application,
        itemKind: "plugin",
        itemIds: [itemId],
        sourceFile: plugin.manifestFile,
        line: null,
        evidence: "A hook declaration or hook file was discovered.",
      });
    }
  }

  for (const diagnostic of scan.diagnostics) {
    if (
      ![
        "MCP_CONFIG_INVALID",
        "MCP_SERVER_INVALID",
        "PLUGIN_MANIFEST_INVALID",
        "PLUGIN_RECORD_INVALID",
      ].includes(diagnostic.code)
    )
      continue;
    add({
      ruleId: `source.${diagnostic.code.toLocaleLowerCase()}`,
      family: "structure",
      severity: "warning",
      confidence: "observed",
      title: "A configuration source could not be fully parsed",
      explanation: "The scanner reported an invalid local configuration or record.",
      remedy: "Open the source in its owning application or a text editor and check its format.",
      application: diagnostic.application,
      itemKind: "source",
      itemIds: [],
      sourceFile: diagnostic.location,
      line: null,
      evidence: `Diagnostic code: ${diagnostic.code}.`,
    });
  }

  const groupedObservations = new Map<string, AuditObservation[]>();
  for (const observation of observations) {
    const key = JSON.stringify([
      observation.application,
      observation.itemKind,
      observation.sourceFile,
      observation.line,
      observation.signal,
    ]);
    groupedObservations.set(key, [...(groupedObservations.get(key) ?? []), observation]);
  }
  for (const group of groupedObservations.values()) {
    const first = group[0];
    const rule = OBSERVATION_RULES[first.signal];
    add({
      ruleId: rule.ruleId,
      family: rule.family,
      severity: rule.severity,
      confidence: rule.confidence,
      title: rule.title,
      explanation: rule.explanation,
      remedy: rule.remedy,
      application: first.application,
      itemKind: first.itemKind,
      itemIds: group.map((item) => item.itemId),
      sourceFile: first.sourceFile,
      line: first.line,
      evidence: rule.evidence,
    });
  }

  const coverage: AuditCoverage[] = [...new Set(applicationIds)].flatMap((application) =>
    FAMILIES.map((family) => {
      const reasons: AuditCoverage["reasons"] = [];
      if (
        scan.diagnostics.some(
          (item) => item.application === application && INCOMPLETE_DIAGNOSTICS.has(item.code),
        )
      ) {
        reasons.push("scan-incomplete");
      }
      if (
        observations.some(
          (item) => item.application === application && UNINSPECTED_SIGNALS.has(item.signal),
        )
      ) {
        reasons.push("file-not-inspected");
      }
      const hasRecords = [...scan.skills, ...scan.mcpServers, ...scan.plugins].some(
        (item) => item.application === application,
      );
      return {
        application,
        family,
        status: reasons.length === 0 ? "evaluated" : hasRecords ? "partial" : "not-evaluated",
        reasons,
      };
    }),
  );

  return {
    generatedAt,
    findings: [...findings.values()].sort(compareFindings),
    coverage,
    files: [...files].sort(
      (left, right) =>
        left.application.localeCompare(right.application) ||
        left.sourceFile.localeCompare(right.sourceFile) ||
        left.itemId.localeCompare(right.itemId),
    ),
  };
}

const OBSERVATION_RULES: Record<
  AuditSignal,
  Omit<FindingInput, "application" | "itemKind" | "itemIds" | "sourceFile" | "line">
> = {
  "missing-file": {
    ruleId: "file.missing",
    family: "structure",
    severity: "warning",
    confidence: "observed",
    title: "Referenced file is missing",
    explanation:
      "A file observed or referenced during discovery is no longer at its recorded path.",
    remedy: "Check the owning item and rescan after restoring or removing the reference.",
    evidence: "The path was absent during the bounded audit check.",
  },
  "unreadable-file": {
    ruleId: "file.unreadable",
    family: "structure",
    severity: "warning",
    confidence: "observed",
    title: "Referenced file could not be inspected",
    explanation: "The local file was not readable as a regular file during the audit.",
    remedy: "Check its permissions and type, then rescan.",
    evidence: "The bounded read did not complete.",
  },
  "oversized-file": {
    ruleId: "file.oversized",
    family: "structure",
    severity: "info",
    confidence: "observed",
    title: "File exceeded the audit limit",
    explanation:
      "The file was larger than the read-only inspection ceiling and was not analyzed for text patterns.",
    remedy: "Review the file manually or reduce its size before rescanning.",
    evidence: "The file was not read beyond its safety limit.",
  },
  "symlink-file": {
    ruleId: "file.symlink",
    family: "structure",
    severity: "warning",
    confidence: "observed",
    title: "Referenced path is a symbolic link",
    explanation: "The audit did not follow this path, so its target was not inspected.",
    remedy:
      "Review the target and replace the reference with a supported regular file if appropriate.",
    evidence: "A final-component symbolic link was observed.",
  },
  "world-writable": {
    ruleId: "file.writable",
    family: "exposure",
    severity: "warning",
    confidence: "observed",
    title: "Local file is writable by others",
    explanation: "Group or other users may be able to change this discovered file on this machine.",
    remedy: "Review file ownership and permissions before trusting the item.",
    evidence: "The file mode includes group or other write permission.",
  },
  "world-readable-config": {
    ruleId: "mcp.readable-config",
    family: "exposure",
    severity: "info",
    confidence: "possible",
    title: "MCP configuration is readable by others",
    explanation:
      "Other local users may be able to read this configuration; the audit does not know whether it contains secrets.",
    remedy: "Keep private values out of the file and review its permissions.",
    evidence: "The file mode includes other-read permission.",
  },
  "literal-credential-pattern": {
    ruleId: "file.credential-pattern",
    family: "exposure",
    severity: "warning",
    confidence: "possible",
    title: "Credential-like text found",
    explanation:
      "A known token or private-key pattern appears in a local file. It may be an example or a live credential.",
    remedy:
      "Inspect the cited line privately; rotate a real exposed credential and move it to a secret store.",
    evidence:
      "Only the pattern category and line number are retained; the matched value is discarded.",
  },
  "credential-assignment": {
    ruleId: "file.credential-assignment",
    family: "exposure",
    severity: "warning",
    confidence: "possible",
    title: "Possible inline credential found",
    explanation:
      "A credential-like key appears assigned to a literal value. Static matching can produce false positives.",
    remedy:
      "Inspect the cited line privately and use an environment or secret provider for real values.",
    evidence: "A credential assignment pattern was observed; its name and value are not retained.",
  },
  "risky-command-pattern": {
    ruleId: "file.command-pattern",
    family: "commands",
    severity: "warning",
    confidence: "possible",
    title: "Risky command pattern found",
    explanation:
      "The file contains a shell download/execute, privileged command, or recursive deletion pattern. Text alone does not prove execution.",
    remedy: "Review the cited line and surrounding context before running or enabling the item.",
    evidence: "A static command pattern was observed; the command text is not retained.",
  },
  "broad-access-pattern": {
    ruleId: "file.broad-access",
    family: "commands",
    severity: "warning",
    confidence: "possible",
    title: "Broad access pattern found",
    explanation:
      "The file contains a flag or mode associated with broad permissions. It may be documentation rather than active configuration.",
    remedy: "Inspect the cited line and limit permissions where possible.",
    evidence: "A broad-access pattern was observed; the original text is not retained.",
  },
  "missing-executable": {
    ruleId: "mcp.missing-executable",
    family: "structure",
    severity: "warning",
    confidence: "observed",
    title: "MCP executable path is missing",
    explanation: "An absolute stdio command path does not exist on this machine.",
    remedy: "Install the executable or correct the configured path; no command was started.",
    evidence: "The path was absent during a no-execution filesystem check.",
  },
  "non-executable": {
    ruleId: "mcp.non-executable",
    family: "structure",
    severity: "warning",
    confidence: "observed",
    title: "MCP command path is not executable",
    explanation:
      "An absolute stdio command path is not a regular file or has no execute permission bit.",
    remedy: "Review the command path and its permissions without starting it.",
    evidence: "The file type or execute permission did not meet the static check.",
  },
  "missing-resource": {
    ruleId: "skill.missing-resource",
    family: "structure",
    severity: "warning",
    confidence: "possible",
    title: "Skill resource link is missing",
    explanation:
      "A relative Markdown link points to a file or folder that could not be found inside the skill directory.",
    remedy: "Review the cited link and restore or correct its local target.",
    evidence:
      "The linked path was absent during a no-follow filesystem check; the path text is omitted.",
  },
  "resource-symlink": {
    ruleId: "skill.symlink-resource",
    family: "structure",
    severity: "info",
    confidence: "possible",
    title: "Skill resource uses a symbolic link",
    explanation: "The audit did not follow a symlink in a local resource path.",
    remedy:
      "Review the link target manually and use a regular local resource if portability matters.",
    evidence: "A symbolic link was encountered before the resource target.",
  },
  "resource-check-limited": {
    ruleId: "skill.resource-limit",
    family: "structure",
    severity: "info",
    confidence: "observed",
    title: "Skill has more links than the audit limit",
    explanation: "Only the first 64 Markdown links were checked to bound local work.",
    remedy: "Review remaining links manually or split the skill documentation.",
    evidence: "The local link check stopped at its configured limit.",
  },
  "bundle-check-limited": {
    ruleId: "bundle.inspection-limit",
    family: "structure",
    severity: "info",
    confidence: "observed",
    title: "Bundle inspection was limited",
    explanation:
      "This bundle exceeded the audit's file, depth, or size limit, or a directory could not be read.",
    remedy: "Review the uninspected files manually before installing or enabling this item.",
    evidence: "The bounded bundle walk stopped before every file could be inspected.",
  },
};

function compareFindings(left: AuditFinding, right: AuditFinding): number {
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  return (
    rank[left.severity] - rank[right.severity] ||
    left.family.localeCompare(right.family) ||
    left.sourceFile.localeCompare(right.sourceFile) ||
    left.ruleId.localeCompare(right.ruleId) ||
    left.id.localeCompare(right.id)
  );
}

export type ApplicationId = "chatgpt" | "claude";
export type ApplicationChoice = ApplicationId | "all";

export type LocationSource = "default" | "plugin" | "desktop-plugin" | "project";
export type SkillSourceId =
  "personal" | "system" | "plugin" | "plugin-cache" | "claude-desktop-plugin" | "project";

export type SkillScope = "global" | "project";
export type InventoryKind = "skills" | "mcp" | "plugins";
export type AuditFamily = "structure" | "exposure" | "commands" | "provenance" | "instructions";
export type AuditItemKind = "skill" | "mcp" | "plugin" | "source";
export type InstructionRiskSignal =
  | "instruction-authority-override"
  | "instruction-concealed-action"
  | "instruction-private-data-egress";
export type AuditSignal =
  | "missing-file"
  | "unreadable-file"
  | "oversized-file"
  | "symlink-file"
  | "world-writable"
  | "world-readable-config"
  | "literal-credential-pattern"
  | "credential-assignment"
  | "risky-command-pattern"
  | "broad-access-pattern"
  | "missing-executable"
  | "non-executable"
  | "missing-resource"
  | "resource-symlink"
  | "resource-check-limited"
  | "bundle-check-limited"
  | InstructionRiskSignal;
export type McpTransport = "stdio" | "http" | "sse" | "unknown";
export type McpConfigurationFormat = "json" | "toml";
export type McpStatus = "valid" | "invalid" | "duplicate";
export type PluginStatus = "valid" | "incomplete" | "invalid";
export type PluginOrigin = "bundled" | "marketplace" | "local" | "synced" | "skills-directory";
export type PluginManifestFormat = "portable" | "codex" | "claude";
export type CapabilityMatchBasis =
  "single-application" | "shared-location" | "shared-endpoint" | "matching-name";

export type MetadataStatus = "valid" | "incomplete" | "missing" | "invalid" | "unreadable";

export type InventorySortField = "name" | "application" | "source" | "modified";
export type SortOrder = "asc" | "desc";

export type DiagnosticCode =
  | "LOCATION_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "READ_FAILED"
  | "SYMLINK_ROOT_SKIPPED"
  | "NOT_A_DIRECTORY"
  | "MAX_DEPTH_REACHED"
  | "PROJECT_REGISTRY_INVALID"
  | "BASELINE_PRESERVED"
  | "MCP_CONFIG_INVALID"
  | "MCP_SERVER_INVALID"
  | "MCP_SERVER_DUPLICATE"
  | "PLUGIN_MANIFEST_INVALID"
  | "PLUGIN_RECORD_INVALID";

export interface ScanLocationDefinition {
  label: string;
  path: string;
  source: LocationSource;
  scope?: SkillScope;
  projectId?: string;
  projectName?: string;
  projectRoot?: string;
}

export interface ApplicationIdentity {
  id: ApplicationId;
  displayName: string;
}

export interface ApplicationDefinition extends ApplicationIdentity {
  locations: ScanLocationDefinition[];
}

export interface SkillMetadata {
  name: string;
  description: string | null;
  metadataStatus: MetadataStatus;
  metadataIssues: string[];
}

export interface DiscoveredSkill extends SkillMetadata {
  application: ApplicationId;
  applicationName: string;
  folderName: string;
  directory: string;
  instructionFile: string;
  source: SkillSourceId;
  sourceName: string;
  sourceLabel: string;
  scope: SkillScope;
  projectId: string | null;
  projectName: string | null;
  projectRoot: string | null;
  modifiedAt: string | null;
}

export interface InternalDiscoveredSkill extends DiscoveredSkill {
  contentFingerprint: string | null;
}

export interface ScanDiagnostic {
  application: ApplicationId;
  location: string;
  severity: "info" | "warning";
  code: DiagnosticCode;
  message: string;
}

export interface ScanResult {
  skills: DiscoveredSkill[];
  mcpServers: DiscoveredMcpServer[];
  plugins: DiscoveredPlugin[];
  diagnostics: ScanDiagnostic[];
}

/** Sanitized, typed observations collected only from paths found by the trusted scan. */
export interface AuditObservation {
  itemKind: Exclude<AuditItemKind, "source">;
  itemId: string;
  application: ApplicationId;
  sourceFile: string;
  line: number | null;
  signal: AuditSignal;
}

export interface AuditFinding {
  id: string;
  ruleId: string;
  family: AuditFamily;
  severity: "info" | "warning" | "critical";
  confidence: "observed" | "possible";
  title: string;
  explanation: string;
  remedy: string;
  application: ApplicationId;
  itemKind: AuditItemKind;
  itemIds: string[];
  sourceFile: string;
  line: number | null;
  /** Controlled text only; never copied from a discovered file or configuration value. */
  evidence: string;
}

export interface AuditCoverage {
  application: ApplicationId;
  family: AuditFamily;
  status: "evaluated" | "partial" | "not-evaluated";
  /** Stable reasons rather than untrusted diagnostic or file contents. */
  reasons: Array<"scan-incomplete" | "file-not-inspected">;
}

export interface AuditReport {
  generatedAt: string;
  findings: AuditFinding[];
  coverage: AuditCoverage[];
  /** Local fingerprints; contents and matched values are never included. */
  files?: AuditFileRecord[];
  fileChanges?: AuditFileChange[];
  fileChangeTrackingError?: string;
}

export interface AuditFileRecord {
  application: ApplicationId;
  itemKind: Exclude<AuditItemKind, "source">;
  itemId: string;
  sourceFile: string;
  bytes: number;
  sha256: string;
  isScript: boolean;
}

export interface AuditFileChange {
  type: "added" | "modified" | "removed";
  file: AuditFileRecord;
}

export type AuditExcerptResult =
  | {
      ok: true;
      sourceFile: string;
      highlightedLine: number;
      lines: Array<{ number: number; text: string; truncated: boolean }>;
    }
  | { ok: false; error: string };

/** A narrowly scoped, local-folder skill import. Plans contain no file contents. */
export interface SkillImportPreview {
  id: string;
  application: ApplicationId;
  sourceDirectory: string;
  destinationDirectory: string;
  fileCount: number;
  totalBytes: number;
  includesScripts: boolean;
  instructionRiskCount: number;
  instructionRisks: Array<{
    signal: InstructionRiskSignal;
    relativePath: string;
    line: number;
  }>;
  expiresAt: string;
}

export type SkillImportSelection =
  { status: "cancelled" } | { status: "ready"; preview: SkillImportPreview };

export interface SkillImportReceipt {
  id: string;
  application: ApplicationId;
  destinationDirectory: string;
  fileCount: number;
  appliedAt: string;
}

export interface SkillImportHistoryEntry {
  id: string;
  application: ApplicationId;
  destinationDirectory: string;
  fileCount: number;
  startedAt: string;
  appliedAt: string | null;
  recoveryDirectory: string | null;
  status: "unchanged" | "changed" | "missing" | "needs-review" | "recovered";
  reviewReason?: "incomplete-import" | "incomplete-undo" | "recovery-missing" | "access-error";
}

export interface DiscoveredMcpServer {
  application: ApplicationId;
  applicationName: string;
  name: string;
  scope: SkillScope;
  projectId: string | null;
  projectName: string | null;
  projectRoot: string | null;
  transport: McpTransport;
  command: string | null;
  arguments: string[];
  url: string | null;
  environmentVariables: string[];
  headerNames: string[];
  configurationFile: string;
  configurationFormat: McpConfigurationFormat;
  safeConfiguration: string;
  /** Opaque, scan-local identity for an exact unredacted endpoint. Never contains configuration. */
  endpointMatchId: string | null;
  status: McpStatus;
  issues: string[];
}

export interface PluginSkillReference {
  name: string;
  instructionFile: string;
}

export interface PluginMcpReference {
  name: string;
  configurationFile: string;
}

export interface DiscoveredPlugin {
  application: ApplicationId;
  applicationName: string;
  name: string;
  displayName: string;
  version: string | null;
  description: string | null;
  author: string | null;
  license: string | null;
  homepage: string | null;
  repository: string | null;
  scope: SkillScope;
  projectId: string | null;
  projectName: string | null;
  projectRoot: string | null;
  origin: PluginOrigin;
  originName: string;
  installationStatus: "confirmed" | "cached" | "bundled" | "unverified";
  directory: string;
  manifestFile: string;
  manifestFormat: PluginManifestFormat;
  skills: PluginSkillReference[];
  mcpServers: PluginMcpReference[];
  apps: string[];
  hasHooks: boolean;
  status: PluginStatus;
  issues: string[];
  modifiedAt: string | null;
}

export interface SkillCapabilityGroup {
  id: string;
  kind: "skill";
  name: string;
  applications: ApplicationId[];
  matchBasis: CapabilityMatchBasis;
  definitions: DiscoveredSkill[];
  variants: SkillVariantGroup[];
}

export interface SkillVariantGroup {
  id: string;
  instructionFile: string;
  applications: ApplicationId[];
  definitions: DiscoveredSkill[];
}

export interface McpCapabilityGroup {
  id: string;
  kind: "mcp";
  name: string;
  applications: ApplicationId[];
  matchBasis: CapabilityMatchBasis;
  definitions: DiscoveredMcpServer[];
}

export type CapabilityGroup = SkillCapabilityGroup | McpCapabilityGroup;

export interface DesktopScanResult extends ScanResult {
  scannedAt: string;
  changes: InventoryChanges;
  audit: AuditReport;
}

export type SkillChangeType = "added" | "modified" | "moved" | "removed";

export interface SkillChange {
  type: SkillChangeType;
  skill: DiscoveredSkill;
  previousSkill: DiscoveredSkill | null;
}

export interface InventoryChanges {
  baselineCreated: boolean;
  baselinePreserved?: boolean;
  baselineScannedAt: string | null;
  comparedAt: string;
  items: SkillChange[];
}

export interface SkillContent {
  content: string;
  truncated: boolean;
}

export type SkillContentResult = ({ ok: true } & SkillContent) | { ok: false; error: string };

/** The complete, intentionally small API exposed to the desktop renderer. */
export interface DesktopApi {
  scan(): Promise<DesktopScanResult>;
  readSkillContent(instructionFile: string): Promise<SkillContentResult>;
  readAuditExcerpt(findingId: string): Promise<AuditExcerptResult>;
  resetBaseline(): Promise<InventoryChanges>;
  chooseSkillImport(application: ApplicationId): Promise<SkillImportSelection>;
  applySkillImport(planId: string): Promise<SkillImportReceipt | null>;
  undoSkillImport(receiptId: string): Promise<string | null>;
  listSkillImportHistory(): Promise<SkillImportHistoryEntry[]>;
}

export interface LocationScanResult {
  skills: InternalDiscoveredSkill[];
  diagnostics: ScanDiagnostic[];
}

export interface CliOptions {
  application: ApplicationChoice | null;
  details: boolean;
  json: boolean;
  help: boolean;
  kind: InventoryKind | "audit";
  search: string | null;
  sources: SkillSourceId[];
  metadataStatuses: MetadataStatus[];
  sortBy: InventorySortField;
  sortOrder: SortOrder;
}

export interface McpInventoryOptions {
  applicationIds?: readonly ApplicationId[];
  query?: string | null;
  scopes?: readonly SkillScope[];
  projectIds?: readonly string[];
}

export interface PluginInventoryOptions {
  applicationIds?: readonly ApplicationId[];
  query?: string | null;
  scopes?: readonly SkillScope[];
  projectIds?: readonly string[];
  statuses?: readonly PluginStatus[];
}

/** Options shared by the CLI today and the future desktop interface. */
export interface InventoryOptions {
  applicationIds?: readonly ApplicationId[];
  query?: string | null;
  sources?: readonly SkillSourceId[];
  metadataStatuses?: readonly MetadataStatus[];
  scopes?: readonly SkillScope[];
  projectIds?: readonly string[];
  sortBy?: InventorySortField;
  sortOrder?: SortOrder;
}

export interface CliIo {
  write(text: string): void;
  error(text: string): void;
  question(text: string): Promise<string>;
}

export interface SkillGroup {
  name: string;
  variants: DiscoveredSkill[];
}

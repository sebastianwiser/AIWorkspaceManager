export type ApplicationId = "chatgpt" | "claude";
export type ApplicationChoice = ApplicationId | "all";

export type LocationSource = "default" | "plugin" | "desktop-plugin";
export type SkillSourceId =
  "personal" | "system" | "plugin" | "plugin-cache" | "claude-desktop-plugin";

export type MetadataStatus = "valid" | "incomplete" | "missing" | "invalid" | "unreadable";

export type InventorySortField = "name" | "application" | "source" | "modified";
export type SortOrder = "asc" | "desc";

export type DiagnosticCode =
  | "LOCATION_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "READ_FAILED"
  | "SYMLINK_ROOT_SKIPPED"
  | "NOT_A_DIRECTORY"
  | "MAX_DEPTH_REACHED";

export interface ScanLocationDefinition {
  label: string;
  path: string;
  source: LocationSource;
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
  diagnostics: ScanDiagnostic[];
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
  search: string | null;
  sources: SkillSourceId[];
  metadataStatuses: MetadataStatus[];
  sortBy: InventorySortField;
  sortOrder: SortOrder;
}

/** Options shared by the CLI today and the future desktop interface. */
export interface InventoryOptions {
  applicationIds?: readonly ApplicationId[];
  query?: string | null;
  sources?: readonly SkillSourceId[];
  metadataStatuses?: readonly MetadataStatus[];
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

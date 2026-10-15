import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { discoverKnownProjects, type KnownProject } from "./projects.js";
import { readRegularFileBounded } from "./safe-file.js";
import type {
  ApplicationId,
  DiscoveredMcpServer,
  McpConfigurationFormat,
  McpTransport,
  ScanDiagnostic,
  SkillScope,
} from "./types.js";

const MAX_CONFIGURATION_BYTES = 2 * 1024 * 1024;
const REDACTED = "[REDACTED]";
const rawEndpointByServer = new WeakMap<DiscoveredMcpServer, string>();
const SAFE_ENVIRONMENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface McpConfigurationLocation {
  application: ApplicationId;
  path: string;
  format: McpConfigurationFormat;
  scope: SkillScope;
  projectId?: string;
  projectName?: string;
  projectRoot?: string;
  selector?: "root" | "claude-project";
}

export interface McpDiscoveryOptions {
  homeDirectory?: string;
  projects?: readonly KnownProject[];
  locations?: readonly McpConfigurationLocation[];
}

export interface McpScanResult {
  mcpServers: DiscoveredMcpServer[];
  diagnostics: ScanDiagnostic[];
}

/** Discover local MCP declarations without starting a process or making a network request. */
export async function discoverMcpServers(
  options: McpDiscoveryOptions = {},
): Promise<McpScanResult> {
  const locations = options.locations ?? (await getDefaultLocations(options));
  const servers: DiscoveredMcpServer[] = [];
  const diagnostics: ScanDiagnostic[] = [];

  for (const location of deduplicateLocations(locations)) {
    const result = await scanMcpConfiguration(location);
    servers.push(...result.mcpServers);
    diagnostics.push(...result.diagnostics);
  }

  // Compare exact private definitions here, then expose only random, scan-local
  // equality labels. Redacted URLs/arguments must never be used as evidence.
  const endpointIds = new Map<string, string>();
  for (const server of servers) {
    const rawEndpoint = rawEndpointByServer.get(server);
    if (!rawEndpoint) continue;
    let matchId = endpointIds.get(rawEndpoint);
    if (!matchId) {
      matchId = randomUUID();
      endpointIds.set(rawEndpoint, matchId);
    }
    server.endpointMatchId = matchId;
  }

  markDuplicates(servers, diagnostics);
  servers.sort(
    (left, right) =>
      left.application.localeCompare(right.application) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.configurationFile.localeCompare(right.configurationFile),
  );

  return { mcpServers: servers, diagnostics };
}

/** Parse one explicitly bounded configuration file. Exported for focused tests. */
export async function scanMcpConfiguration(
  location: McpConfigurationLocation,
): Promise<McpScanResult> {
  const configurationFile = path.resolve(location.path);
  let stats;

  try {
    stats = await fs.lstat(configurationFile);
  } catch (error) {
    if (getNodeErrorCode(error) === "ENOENT") {
      return { mcpServers: [], diagnostics: [] };
    }
    return {
      mcpServers: [],
      diagnostics: [accessDiagnostic(location.application, configurationFile, error)],
    };
  }

  if (stats.isSymbolicLink()) {
    return {
      mcpServers: [],
      diagnostics: [
        {
          application: location.application,
          location: configurationFile,
          severity: "warning",
          code: "SYMLINK_ROOT_SKIPPED",
          message: "The MCP configuration is a symbolic link, so it was skipped for safety.",
        },
      ],
    };
  }

  if (!stats.isFile()) {
    return {
      mcpServers: [],
      diagnostics: [
        {
          application: location.application,
          location: configurationFile,
          severity: "warning",
          code: "NOT_A_DIRECTORY",
          message: "The configured MCP location is not a regular file.",
        },
      ],
    };
  }

  if (stats.size > MAX_CONFIGURATION_BYTES) {
    return {
      mcpServers: [],
      diagnostics: [
        {
          application: location.application,
          location: configurationFile,
          severity: "warning",
          code: "MCP_CONFIG_INVALID",
          message: "The MCP configuration exceeds the 2 MB safety limit.",
        },
      ],
    };
  }

  let document: Record<string, unknown>;
  try {
    const contents = (
      await readRegularFileBounded(configurationFile, MAX_CONFIGURATION_BYTES)
    ).toString("utf8");
    const parsed: unknown = location.format === "toml" ? parseToml(contents) : JSON.parse(contents);
    const parsedObject = asObject(parsed);
    if (!parsedObject) {
      throw new Error("The configuration root is not an object.");
    }
    document = parsedObject;
  } catch {
    return {
      mcpServers: [],
      diagnostics: [
        {
          application: location.application,
          location: configurationFile,
          severity: "warning",
          code: "MCP_CONFIG_INVALID",
          message: `Could not parse the MCP configuration as ${location.format.toUpperCase()}.`,
        },
      ],
    };
  }

  const container = getServerContainer(document, location);
  if (!container) {
    return { mcpServers: [], diagnostics: [] };
  }

  const mcpServers: DiscoveredMcpServer[] = [];
  const diagnostics: ScanDiagnostic[] = [];

  for (const [name, value] of Object.entries(container)) {
    const definition = asObject(value);
    if (!definition) {
      diagnostics.push({
        application: location.application,
        location: configurationFile,
        severity: "warning",
        code: "MCP_SERVER_INVALID",
        message: `MCP server “${name}” must be an object or TOML table.`,
      });
      continue;
    }

    try {
      const server = createServer(name, definition, location, configurationFile);
      mcpServers.push(server);
      if (server.status !== "invalid") continue;
      diagnostics.push({
        application: location.application,
        location: configurationFile,
        severity: "warning",
        code: "MCP_SERVER_INVALID",
        message: `MCP server “${name}” is invalid: ${server.issues.join(" ")}`,
      });
    } catch {
      diagnostics.push({
        application: location.application,
        location: configurationFile,
        severity: "warning",
        code: "MCP_SERVER_INVALID",
        message: `MCP server “${name}” could not be inspected safely.`,
      });
    }
  }

  return { mcpServers, diagnostics };
}

async function getDefaultLocations(
  options: McpDiscoveryOptions,
): Promise<McpConfigurationLocation[]> {
  const home = options.homeDirectory ?? os.homedir();
  const projects = options.projects ?? (await discoverKnownProjects());
  const locations: McpConfigurationLocation[] = [
    {
      application: "chatgpt",
      path: path.join(home, ".codex", "config.toml"),
      format: "toml",
      scope: "global",
    },
    {
      application: "claude",
      path: path.join(home, ".claude.json"),
      format: "json",
      scope: "global",
    },
  ];

  if (process.platform === "darwin") {
    locations.push({
      application: "claude",
      path: path.join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      ),
      format: "json",
      scope: "global",
    });
  }

  for (const project of projects) {
    if (project.application === "chatgpt") {
      locations.push({
        application: "chatgpt",
        path: path.join(project.path, ".codex", "config.toml"),
        format: "toml",
        scope: "project",
        projectId: project.id,
        projectName: project.name,
        projectRoot: project.path,
      });
    } else {
      locations.push(
        {
          application: "claude",
          path: path.join(project.path, ".mcp.json"),
          format: "json",
          scope: "project",
          projectId: project.id,
          projectName: project.name,
          projectRoot: project.path,
        },
        {
          application: "claude",
          path: path.join(home, ".claude.json"),
          format: "json",
          scope: "project",
          projectId: project.id,
          projectName: project.name,
          projectRoot: project.path,
          selector: "claude-project",
        },
      );
    }
  }

  return locations;
}

function getServerContainer(
  document: Record<string, unknown>,
  location: McpConfigurationLocation,
): Record<string, unknown> | null {
  if (location.selector === "claude-project") {
    const projects = asObject(document.projects);
    const project = location.projectRoot ? asObject(projects?.[location.projectRoot]) : null;
    return asObject(project?.mcpServers);
  }

  return asObject(document.mcpServers) ?? asObject(document.mcp_servers);
}

function createServer(
  name: string,
  definition: Record<string, unknown>,
  location: McpConfigurationLocation,
  configurationFile: string,
): DiscoveredMcpServer {
  const rawCommand = typeof definition.command === "string" ? definition.command : null;
  const command = rawCommand ? sanitizeCommand(rawCommand) : null;
  const rawUrl = typeof definition.url === "string" ? definition.url : null;
  const explicitTransport =
    typeof definition.type === "string"
      ? definition.type
      : typeof definition.transport === "string"
        ? definition.transport
        : null;
  const transport = inferTransport(explicitTransport, rawCommand, rawUrl);
  const rawArguments = Array.isArray(definition.args)
    ? definition.args.filter((value): value is string => typeof value === "string")
    : [];
  const arguments_ = redactArguments(rawArguments);
  const url = rawUrl ? sanitizeUrl(rawUrl) : null;
  const environmentVariables = collectEnvironmentVariables(definition);
  const headerNames = collectHeaderNames(definition);
  const issues: string[] = [];

  if (!name.trim()) {
    issues.push("The server name is empty.");
  }
  if (transport === "unknown") {
    issues.push("A supported stdio, HTTP, or SSE transport could not be determined.");
  } else if (transport === "stdio" && !command) {
    issues.push("A stdio server must declare a command.");
  } else if ((transport === "http" || transport === "sse") && !rawUrl) {
    issues.push(`${transport.toUpperCase()} transport must declare a URL.`);
  }

  const safeDefinition = sanitizeDefinition(definition);

  const server: DiscoveredMcpServer = {
    application: location.application,
    applicationName: location.application === "chatgpt" ? "ChatGPT" : "Claude",
    name,
    scope: location.scope,
    projectId: location.projectId ?? null,
    projectName: location.projectName ?? null,
    projectRoot: location.projectRoot ?? null,
    transport,
    command,
    arguments: arguments_,
    url,
    environmentVariables,
    headerNames,
    configurationFile,
    configurationFormat: location.format,
    safeConfiguration: formatSafeConfiguration(name, safeDefinition, location.format),
    endpointMatchId: null,
    status: issues.length > 0 ? "invalid" : "valid",
    issues,
  };
  const rawEndpoint =
    transport === "stdio" && rawCommand
      ? JSON.stringify(["stdio", rawCommand, rawArguments])
      : rawUrl
        ? JSON.stringify([transport, rawUrl])
        : null;
  if (rawEndpoint) rawEndpointByServer.set(server, rawEndpoint);
  return server;
}

function inferTransport(
  explicit: string | null,
  command: string | null,
  url: string | null,
): McpTransport {
  const normalized = explicit?.toLowerCase();
  if (normalized === "stdio") return "stdio";
  if (normalized === "http" || normalized === "streamable-http") return "http";
  if (normalized === "sse") return "sse";
  if (normalized) return "unknown";
  if (command) return "stdio";
  if (url) return "http";
  return "unknown";
}

function sanitizeDefinition(definition: Record<string, unknown>): Record<string, unknown> {
  // Unknown fields are redacted by default. MCP implementations can place
  // credentials under arbitrary names, so a denylist cannot be complete.
  const result = redactUnknownObject(definition);
  if (Array.isArray(definition.args)) {
    result.args = redactArguments(
      definition.args.filter((value): value is string => typeof value === "string"),
    );
  }
  if (typeof definition.url === "string") {
    result.url = sanitizeUrl(definition.url);
  }
  if (typeof definition.command === "string") {
    result.command = sanitizeCommand(definition.command);
  }
  for (const key of ["type", "transport"] as const) {
    if (typeof definition[key] === "string") {
      result[key] = /^(stdio|http|streamable-http|sse)$/i.test(definition[key])
        ? definition[key]
        : REDACTED;
    }
  }
  for (const key of ["env", "headers", "http_headers"] as const) {
    const values = asObject(definition[key]);
    if (values)
      result[key] = Object.fromEntries(Object.keys(values).map((name) => [name, REDACTED]));
  }
  const envHeaders = asObject(definition.env_http_headers);
  if (envHeaders) {
    result.env_http_headers = Object.fromEntries(
      Object.entries(envHeaders).map(([name, value]) => [name, safeEnvironmentName(value)]),
    );
  }
  if (definition.bearer_token_env_var !== undefined) {
    result.bearer_token_env_var = safeEnvironmentName(definition.bearer_token_env_var);
  }
  return result;
}

function redactUnknownObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      Array.isArray(child)
        ? child.map(() => REDACTED)
        : asObject(child)
          ? redactUnknownObject(child as Record<string, unknown>)
          : REDACTED,
    ]),
  );
}

function redactArguments(args: readonly string[]): string[] {
  const result: string[] = [];
  let redactNext = false;
  for (const argument of args) {
    if (redactNext) {
      result.push(REDACTED);
      redactNext = false;
    } else if (/^--?[A-Za-z][A-Za-z0-9_-]*=/.test(argument)) {
      const separator = argument.indexOf("=");
      result.push(`${argument.slice(0, separator + 1)}${REDACTED}`);
    } else if (
      /^--?(?:api[-_]?key|authorization|cookie|credential|password|secret|token|header)$/i.test(
        argument,
      )
    ) {
      result.push(argument);
      redactNext = true;
    } else if (
      /^--?[A-Za-z][A-Za-z0-9_-]*$/.test(argument) ||
      /^[A-Za-z0-9_.-]+\.(?:js|mjs|cjs|py|ts|sh)$/.test(argument)
    ) {
      result.push(argument);
    } else {
      result.push(REDACTED);
    }
  }
  return result;
}

function sanitizeUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "[INVALID URL]";
    const pathname = url.pathname && url.pathname !== "/" ? "/[REDACTED PATH]" : "/";
    const query = url.search ? "?[REDACTED QUERY]" : "";
    const fragment = url.hash ? "#[REDACTED FRAGMENT]" : "";
    return `${url.protocol}//${url.host}${pathname}${query}${fragment}`;
  } catch {
    return "[INVALID URL]";
  }
}

function sanitizeCommand(value: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(value) && !looksLikeSecret(value) ? value : "[REDACTED COMMAND]";
}

function looksLikeSecret(value: string): boolean {
  return /^(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{8,}\.)/.test(value);
}

function safeEnvironmentName(value: unknown): string {
  return typeof value === "string" && SAFE_ENVIRONMENT_NAME.test(value) ? value : REDACTED;
}

function collectEnvironmentVariables(definition: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const key of Object.keys(asObject(definition.env) ?? {})) {
    if (SAFE_ENVIRONMENT_NAME.test(key)) names.add(key);
  }
  const bearerVariable = definition.bearer_token_env_var;
  if (typeof bearerVariable === "string" && SAFE_ENVIRONMENT_NAME.test(bearerVariable)) {
    names.add(bearerVariable);
  }
  for (const value of Object.values(asObject(definition.env_http_headers) ?? {})) {
    if (typeof value === "string" && SAFE_ENVIRONMENT_NAME.test(value)) names.add(value);
  }
  collectPlaceholders(definition, names);
  return [...names].sort((left, right) => left.localeCompare(right));
}

function collectPlaceholders(value: unknown, names: Set<string>): void {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-?[^}]*)?\}/g)) {
      if (match[1]) names.add(match[1]);
    }
  } else if (Array.isArray(value)) {
    for (const child of value) collectPlaceholders(child, names);
  } else {
    const object = asObject(value);
    if (object) for (const child of Object.values(object)) collectPlaceholders(child, names);
  }
}

function collectHeaderNames(definition: Record<string, unknown>): string[] {
  return [
    ...new Set([
      ...Object.keys(asObject(definition.headers) ?? {}),
      ...Object.keys(asObject(definition.http_headers) ?? {}),
      ...Object.keys(asObject(definition.env_http_headers) ?? {}),
    ]),
  ].sort((left, right) => left.localeCompare(right));
}

function formatSafeConfiguration(
  name: string,
  definition: Record<string, unknown>,
  format: McpConfigurationFormat,
): string {
  if (format === "toml") {
    try {
      return stringifyToml({ mcp_servers: { [name]: definition } });
    } catch {
      // JSON remains an inert and readable fallback for unusual TOML values.
    }
  }
  return `${JSON.stringify({ mcpServers: { [name]: definition } }, null, 2)}\n`;
}

function markDuplicates(servers: DiscoveredMcpServer[], diagnostics: ScanDiagnostic[]): void {
  const groups = new Map<string, DiscoveredMcpServer[]>();
  for (const server of servers) {
    const identity = `${server.application}\u0000${server.scope}\u0000${server.projectId ?? "global"}\u0000${server.name.toLocaleLowerCase()}`;
    const group = groups.get(identity) ?? [];
    group.push(server);
    groups.set(identity, group);
  }

  for (const group of groups.values()) {
    const uniqueFiles = new Set(group.map((server) => server.configurationFile));
    if (group.length < 2 || uniqueFiles.size < 2) continue;
    for (const server of group) {
      server.status = "duplicate";
      server.issues.push("Another server with this name exists in the same application and scope.");
    }
    const first = group[0];
    diagnostics.push({
      application: first.application,
      location: first.configurationFile,
      severity: "warning",
      code: "MCP_SERVER_DUPLICATE",
      message: `MCP server “${first.name}” is declared more than once in the same scope.`,
    });
  }
}

function deduplicateLocations(
  locations: readonly McpConfigurationLocation[],
): McpConfigurationLocation[] {
  const seen = new Set<string>();
  return locations.filter((location) => {
    const key = `${location.application}\u0000${path.resolve(location.path)}\u0000${location.scope}\u0000${location.projectId ?? ""}\u0000${location.selector ?? "root"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function accessDiagnostic(
  application: ApplicationId,
  location: string,
  error: unknown,
): ScanDiagnostic {
  return {
    application,
    location,
    severity: "warning",
    code: getNodeErrorCode(error) === "EACCES" ? "PERMISSION_DENIED" : "READ_FAILED",
    message: `Could not read the MCP configuration: ${getErrorMessage(error)}`,
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getNodeErrorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

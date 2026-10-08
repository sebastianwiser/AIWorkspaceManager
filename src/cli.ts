import process from "node:process";
import readline from "node:readline/promises";
import { getApplication, getApplications } from "./applications.js";
import { createInventoryView } from "./inventory.js";
import { scanApplications } from "./scanner.js";
import type {
  ApplicationChoice,
  ApplicationDefinition,
  ApplicationId,
  ApplicationIdentity,
  CliIo,
  CliOptions,
  DiscoveredSkill,
  InventorySortField,
  MetadataStatus,
  ScanResult,
  SkillGroup,
  SkillSourceId,
  SortOrder,
} from "./types.js";

const VALID_SOURCES = [
  "personal",
  "system",
  "plugin",
  "plugin-cache",
  "claude-desktop-plugin",
] as const satisfies readonly SkillSourceId[];
const VALID_METADATA_STATUSES = [
  "valid",
  "incomplete",
  "missing",
  "invalid",
  "unreadable",
] as const satisfies readonly MetadataStatus[];
const VALID_SORT_FIELDS = [
  "name",
  "application",
  "source",
  "modified",
] as const satisfies readonly InventorySortField[];
const VALID_SORT_ORDERS = ["asc", "desc"] as const satisfies readonly SortOrder[];

const HELP_TEXT = `SkillManagerOS - discover local AI skills

Usage:
  skillmanager
  skillmanager scan [options]
  skillmanager --help

Options:
  --app <name>       Choose chatgpt, claude, or all. If omitted, a menu is shown.
  --search <text>    Search skill names, folder names, and descriptions.
  --source <list>    Filter by comma-separated source IDs.
  --status <list>    Filter by comma-separated metadata statuses.
  --sort <field>     Sort by name, application, source, or modified.
  --order <order>    Use ascending (asc) or descending (desc) order.
  --details          Show descriptions, sources, metadata status, and locations.
  --json             Print complete machine-readable JSON.
  --help             Show this help message.

Examples:
  skillmanager scan --app chatgpt
  skillmanager scan --app chatgpt --details
  skillmanager scan --app all --search document --source personal,plugin
  skillmanager scan --app all --status invalid,missing --sort source
  skillmanager scan --app claude --json
`;

/** Run the command-line interface with an argv-style array. */
export async function runCli(args: string[], io: CliIo = defaultIo()): Promise<void> {
  let options: CliOptions;

  try {
    options = parseArguments(args);
  } catch (error) {
    io.error(getErrorMessage(error));
    io.error("Run skillmanager --help to see valid usage.");
    process.exitCode = 1;
    return;
  }

  if (options.help) {
    io.write(HELP_TEXT);
    return;
  }

  const applicationIds = options.application
    ? expandApplicationChoice(options.application)
    : await promptForApplications(io);

  const applications = applicationIds.map(getApplication);
  const scanResult = await scanApplications({ applications });
  const result: ScanResult = {
    ...scanResult,
    skills: createInventoryView(scanResult.skills, {
      applicationIds,
      query: options.search,
      sources: options.sources,
      metadataStatuses: options.metadataStatuses,
      sortBy: options.sortBy,
      sortOrder: options.sortOrder,
    }),
  };

  if (options.json) {
    io.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  printHumanReadableResult(result, applications, options, scanResult.skills.length, io);
}

export function parseArguments(args: string[]): CliOptions {
  const normalizedArgs = args[0] === "scan" ? args.slice(1) : args;
  const options: CliOptions = {
    application: null,
    details: false,
    json: false,
    help: false,
    search: null,
    sources: [],
    metadataStatuses: [],
    sortBy: "application",
    sortOrder: "asc",
  };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const argument = normalizedArgs[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--details") {
      options.details = true;
    } else if (argument === "--app") {
      const value = readOptionValue(normalizedArgs, index, "--app");
      options.application = value.toLowerCase() as ApplicationChoice;
      index += 1;
    } else if (argument === "--search") {
      options.search = readOptionValue(normalizedArgs, index, "--search");
      index += 1;
    } else if (argument === "--source") {
      const value = readOptionValue(normalizedArgs, index, "--source");
      options.sources = mergeUnique(
        options.sources,
        parseListOption(value, VALID_SOURCES, "--source"),
      );
      index += 1;
    } else if (argument === "--status") {
      const value = readOptionValue(normalizedArgs, index, "--status");
      options.metadataStatuses = mergeUnique(
        options.metadataStatuses,
        parseListOption(value, VALID_METADATA_STATUSES, "--status"),
      );
      index += 1;
    } else if (argument === "--sort") {
      const value = readOptionValue(normalizedArgs, index, "--sort");
      options.sortBy = parseSingleOption(value, VALID_SORT_FIELDS, "--sort");
      index += 1;
    } else if (argument === "--order") {
      const value = readOptionValue(normalizedArgs, index, "--order");
      options.sortOrder = parseSingleOption(value, VALID_SORT_ORDERS, "--order");
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (options.application && !["chatgpt", "claude", "all"].includes(options.application)) {
    throw new Error(`Unsupported application: ${options.application}`);
  }

  return options;
}

function expandApplicationChoice(choice: ApplicationChoice): ApplicationId[] {
  return choice === "all" ? getApplications().map((app) => app.id) : [choice];
}

async function promptForApplications(io: CliIo): Promise<ApplicationId[]> {
  io.write("Which application would you like to scan?\n");
  io.write("  1. ChatGPT\n");
  io.write("  2. Claude\n");
  io.write("  3. Both\n");

  const answer = (await io.question("Select 1, 2, or 3: ")).trim();
  const choices: Record<string, ApplicationId[]> = {
    1: ["chatgpt"],
    2: ["claude"],
    3: ["chatgpt", "claude"],
  };

  if (!choices[answer]) {
    throw new Error("Please select 1, 2, or 3.");
  }

  return choices[answer];
}

function printHumanReadableResult(
  result: ScanResult,
  applications: ApplicationDefinition[],
  options: CliOptions,
  totalSkillCount: number,
  io: CliIo,
): void {
  const names = applications.map((application) => application.displayName).join(" and ");
  io.write(`\nScanned local ${names} skill locations.\n`);

  if (result.skills.length === 0) {
    io.write(
      hasActiveFilters(options) && totalSkillCount > 0
        ? "\nNo local skills matched the current filters.\n"
        : "\nNo local skills were found.\n",
    );
  } else {
    const countMessage =
      result.skills.length === totalSkillCount
        ? `Found ${result.skills.length} local skill definition${result.skills.length === 1 ? "" : "s"}`
        : `Found ${result.skills.length} matching local skill definition${result.skills.length === 1 ? "" : "s"} (${totalSkillCount} scanned)`;
    io.write(`\n${countMessage}:\n\n`);
    io.write(
      options.details
        ? formatDetailedSkillGroups(result.skills, applications)
        : formatSkillGroups(result.skills, applications),
    );
  }

  const warnings = result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning");

  if (warnings.length > 0) {
    io.write(`\nWarnings (${warnings.length}):\n`);
    for (const warning of warnings) {
      io.write(`  - ${warning.message}\n`);
    }
  }

  const missingCount = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "LOCATION_NOT_FOUND",
  ).length;

  if (missingCount > 0) {
    io.write(
      `\n${missingCount} optional scan location${missingCount === 1 ? " was" : "s were"} not present.\n`,
    );
  }

  io.write("\nRead-only scan complete. No files were changed.\n");
}

/** Format skills as a simple list grouped by application. */
export function formatSkillGroups(
  skills: DiscoveredSkill[],
  applications: ApplicationIdentity[],
): string {
  const sections = applications.map((application) => {
    const groups = groupSkills(skills, application.id);

    const skillLines = groups.length
      ? groups.map((group) => {
          const variantLabel =
            group.variants.length > 1 ? ` (${group.variants.length} variants)` : "";
          const invalidStatuses = group.variants
            .map((skill) => skill.metadataStatus)
            .filter((status) => status !== "valid");
          const metadataLabel =
            invalidStatuses.length > 0
              ? ` [metadata: ${[...new Set(invalidStatuses)].join(", ")}]`
              : "";
          return `  ${sanitizeSingleLine(group.name)}${variantLabel}${metadataLabel}`;
        })
      : ["  No local skills found."];

    return [application.displayName, ...skillLines].join("\n");
  });

  return `${sections.join("\n\n")}\n`;
}

/** Format the same inventory with metadata intended for human inspection. */
export function formatDetailedSkillGroups(
  skills: DiscoveredSkill[],
  applications: ApplicationIdentity[],
): string {
  const sections = applications.map((application) => {
    const groups = groupSkills(skills, application.id);
    if (groups.length === 0) {
      return `${application.displayName}\n  No local skills found.`;
    }

    const skillBlocks = groups.map((group) => {
      const heading = `  ${sanitizeSingleLine(group.name)}${group.variants.length > 1 ? ` (${group.variants.length} variants)` : ""}`;
      const variants = group.variants.map((skill, index) => {
        const variantHeading = group.variants.length > 1 ? `    Variant ${index + 1}\n` : "";
        const indent = group.variants.length > 1 ? "      " : "    ";
        const description = skill.description
          ? indentMultiline(sanitizeTerminalText(skill.description), indent)
          : "Not provided";
        const issueLines =
          skill.metadataIssues.length > 0
            ? `\n${indent}Issues: ${sanitizeSingleLine(skill.metadataIssues.join(" "))}`
            : "";

        const lines = [
          `${indent}Description: ${description}`,
          `${indent}Source: ${sanitizeSingleLine(skill.sourceName)}`,
          `${indent}Metadata: ${capitalize(skill.metadataStatus)}`,
          `${indent}Location: ${sanitizeSingleLine(shortenHomePath(skill.directory))}${issueLines}`,
        ];

        return `${variantHeading}${lines.join("\n")}`;
      });

      return [heading, ...variants].join("\n");
    });

    return [application.displayName, ...skillBlocks].join("\n\n");
  });

  return `${sections.join("\n\n")}\n`;
}

function groupSkills(skills: DiscoveredSkill[], applicationId: ApplicationId): SkillGroup[] {
  const groups = new Map<string, SkillGroup>();

  for (const skill of skills.filter((item) => item.application === applicationId)) {
    const key = skill.name.toLocaleLowerCase();
    const group = groups.get(key) ?? { name: skill.name, variants: [] };
    group.variants.push(skill);
    groups.set(key, group);
  }

  return [...groups.values()];
}

function readOptionValue(args: string[], index: number, optionName: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${optionName} requires a value.`);
  }
  return value;
}

function parseListOption<T extends string>(
  value: string,
  validValues: readonly T[],
  optionName: string,
): T[] {
  const values = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (values.length === 0) {
    throw new Error(`${optionName} requires at least one value.`);
  }

  const invalidValues = values.filter((item) => !validValues.includes(item as T));
  if (invalidValues.length > 0) {
    throw new Error(
      `Unsupported ${optionName.slice(2)}: ${invalidValues.join(", ")}. Valid values: ${validValues.join(", ")}.`,
    );
  }

  return values as T[];
}

function parseSingleOption<T extends string>(
  value: string,
  validValues: readonly T[],
  optionName: string,
): T {
  const values = parseListOption(value, validValues, optionName);
  if (values.length !== 1) {
    throw new Error(`${optionName} accepts one value.`);
  }
  return values[0];
}

function mergeUnique<T>(existing: T[], additional: T[]): T[] {
  return [...new Set([...existing, ...additional])];
}

function hasActiveFilters(options: CliOptions): boolean {
  return Boolean(
    options.search || options.sources.length > 0 || options.metadataStatuses.length > 0,
  );
}

function indentMultiline(value: string, indent: string): string {
  return value.replace(/\r?\n/g, `\n${indent}             `);
}

function capitalize(value: MetadataStatus): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sanitizeTerminalText(value: string): string {
  return (
    String(value)
      // These control-character patterns intentionally prevent terminal escape injection.
      // eslint-disable-next-line no-control-regex
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
  );
}

function sanitizeSingleLine(value: string): string {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

function shortenHomePath(filePath: string): string {
  const home = process.env.HOME;
  return home && filePath.startsWith(`${home}/`)
    ? `~/${filePath.slice(home.length + 1)}`
    : filePath;
}

function defaultIo(): CliIo {
  return {
    write: (text) => process.stdout.write(text),
    error: (text) => process.stderr.write(`${text}\n`),
    question: async (text) => {
      // Create the readline interface only for an interactive command. Opening
      // it for commands that already include --app can keep a terminal alive.
      const prompt = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      try {
        return await prompt.question(text);
      } finally {
        prompt.close();
      }
    },
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

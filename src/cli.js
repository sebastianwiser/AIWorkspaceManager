import process from "node:process";
import readline from "node:readline/promises";
import { getApplication, getApplications } from "./applications.js";
import { scanApplications } from "./scanner.js";

const HELP_TEXT = `SkillManagerOS - discover local AI skills

Usage:
  skillmanager
  skillmanager scan [--app chatgpt|claude|all] [--details] [--json]
  skillmanager --help

Options:
  --app <name>  Choose ChatGPT, Claude, or all. If omitted, a menu is shown.
  --details     Show descriptions, sources, metadata status, and locations.
  --json        Print complete machine-readable JSON.
  --help        Show this help message.

Examples:
  skillmanager scan --app chatgpt
  skillmanager scan --app chatgpt --details
  skillmanager scan --app claude --json
  skillmanager scan --app all
`;

/** Run the command-line interface with an argv-style array. */
export async function runCli(args, io = defaultIo()) {
  let options;

  try {
    options = parseArguments(args);
  } catch (error) {
    io.error(error.message);
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
  const result = await scanApplications({ applications });

  if (options.json) {
    io.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  printHumanReadableResult(result, applications, options, io);
}

export function parseArguments(args) {
  const normalizedArgs = args[0] === "scan" ? args.slice(1) : args;
  const options = { application: null, details: false, json: false, help: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const argument = normalizedArgs[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "--details") {
      options.details = true;
    } else if (argument === "--app") {
      const value = normalizedArgs[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--app requires chatgpt, claude, or all.");
      }
      options.application = value.toLowerCase();
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

function expandApplicationChoice(choice) {
  return choice === "all" ? getApplications().map((app) => app.id) : [choice];
}

async function promptForApplications(io) {
  io.write("Which application would you like to scan?\n");
  io.write("  1. ChatGPT\n");
  io.write("  2. Claude\n");
  io.write("  3. Both\n");

  const answer = (await io.question("Select 1, 2, or 3: ")).trim();
  const choices = {
    1: ["chatgpt"],
    2: ["claude"],
    3: ["chatgpt", "claude"],
  };

  if (!choices[answer]) {
    throw new Error("Please select 1, 2, or 3.");
  }

  return choices[answer];
}

function printHumanReadableResult(result, applications, options, io) {
  const names = applications.map((application) => application.displayName).join(" and ");
  io.write(`\nScanned local ${names} skill locations.\n`);

  if (result.skills.length === 0) {
    io.write("\nNo local skills were found.\n");
  } else {
    io.write(`\nFound ${result.skills.length} local skill definition${result.skills.length === 1 ? "" : "s"}:\n\n`);
    io.write(
      options.details
        ? formatDetailedSkillGroups(result.skills, applications)
        : formatSkillGroups(result.skills, applications),
    );
  }

  const warnings = result.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "warning",
  );

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
    io.write(`\n${missingCount} optional scan location${missingCount === 1 ? " was" : "s were"} not present.\n`);
  }

  io.write("\nRead-only scan complete. No files were changed.\n");
}

/** Format skills as a simple list grouped by application. */
export function formatSkillGroups(skills, applications) {
  const sections = applications.map((application) => {
    const groups = groupSkills(skills, application.id);

    const skillLines = groups.length
      ? groups.map((group) => {
          const variantLabel = group.variants.length > 1
            ? ` (${group.variants.length} variants)`
            : "";
          const invalidStatuses = group.variants
            .map((skill) => skill.metadataStatus)
            .filter((status) => status !== "valid");
          const metadataLabel = invalidStatuses.length > 0
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
export function formatDetailedSkillGroups(skills, applications) {
  const sections = applications.map((application) => {
    const groups = groupSkills(skills, application.id);
    if (groups.length === 0) {
      return `${application.displayName}\n  No local skills found.`;
    }

    const skillBlocks = groups.map((group) => {
      const heading = `  ${sanitizeSingleLine(group.name)}${group.variants.length > 1 ? ` (${group.variants.length} variants)` : ""}`;
      const variants = group.variants.map((skill, index) => {
        const variantHeading = group.variants.length > 1
          ? `    Variant ${index + 1}\n`
          : "";
        const indent = group.variants.length > 1 ? "      " : "    ";
        const description = skill.description
          ? indentMultiline(sanitizeTerminalText(skill.description), indent)
          : "Not provided";
        const issueLines = skill.metadataIssues.length > 0
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

function groupSkills(skills, applicationId) {
  const groups = new Map();

  for (const skill of skills.filter((item) => item.application === applicationId)) {
    const key = skill.name.toLocaleLowerCase();
    const group = groups.get(key) ?? { name: skill.name, variants: [] };
    group.variants.push(skill);
    groups.set(key, group);
  }

  return [...groups.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function indentMultiline(value, indent) {
  return value.replace(/\r?\n/g, `\n${indent}             `);
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function sanitizeTerminalText(value) {
  return String(value)
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "");
}

function sanitizeSingleLine(value) {
  return sanitizeTerminalText(value).replace(/\s+/g, " ").trim();
}

function shortenHomePath(filePath) {
  const home = process.env.HOME;
  return home && filePath.startsWith(`${home}/`)
    ? `~/${filePath.slice(home.length + 1)}`
    : filePath;
}

function defaultIo() {
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

import process from "node:process";
import readline from "node:readline/promises";
import { getApplication, getApplications } from "./applications.js";
import { scanApplications } from "./scanner.js";

const HELP_TEXT = `SkillManagerOS - discover local AI skills

Usage:
  skillmanager
  skillmanager scan [--app chatgpt|claude|all] [--json]
  skillmanager --help

Options:
  --app <name>  Choose ChatGPT, Claude, or all. If omitted, a menu is shown.
  --json        Print machine-readable JSON instead of a table.
  --help        Show this help message.

Examples:
  skillmanager scan --app chatgpt
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

  printHumanReadableResult(result, applications, io);
}

export function parseArguments(args) {
  const normalizedArgs = args[0] === "scan" ? args.slice(1) : args;
  const options = { application: null, json: false, help: false };

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const argument = normalizedArgs[index];

    if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--json") {
      options.json = true;
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

function printHumanReadableResult(result, applications, io) {
  const names = applications.map((application) => application.displayName).join(" and ");
  io.write(`\nScanned local ${names} skill locations.\n`);

  if (result.skills.length === 0) {
    io.write("\nNo local skills were found.\n");
  } else {
    io.write(`\nFound ${result.skills.length} local skill${result.skills.length === 1 ? "" : "s"}:\n\n`);
    io.write(formatSkillGroups(result.skills, applications));
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
    const applicationSkills = skills.filter(
      (skill) => skill.application === application.id,
    );

    const skillLines = applicationSkills.length
      ? applicationSkills.map((skill) => `  ${skill.name}`)
      : ["  No local skills found."];

    return [application.displayName, ...skillLines].join("\n");
  });

  return `${sections.join("\n\n")}\n`;
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

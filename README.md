# SkillManagerOS

SkillManagerOS is an early, read-only command-line tool for discovering local AI skills installed
for ChatGPT and Claude.

This repository currently includes **MVP 1A: local skill discovery** and **MVP 1B: safe metadata
parsing**. The program finds folders containing `SKILL.md`, reads their declarative YAML
frontmatter, and reports what it finds. It does not execute, install, modify, or remove any skill.

## Project goals

The long-term goal is to build a local-first manager for skills, plugins, and Model Context Protocol
(MCP) connections used by AI applications. Starting with a small CLI lets the project validate local
discovery before adding a desktop interface or configuration management.

The current version answers one question:

> Which local skills are installed for ChatGPT and Claude, what do they do, and where did they come
> from?

## Current features

- Scan ChatGPT skill and plugin directories.
- Scan Claude skill and plugin directories.
- Select one application or scan both.
- Find direct and plugin-provided skills using the `SKILL.md` marker.
- Read declared skill names and descriptions from YAML frontmatter.
- Classify personal, system, plugin, plugin-cache, and Claude Desktop sources.
- Identify missing, incomplete, invalid, or unreadable metadata.
- Group same-named definitions as variants without discarding either one.
- Print a simple list grouped by application.
- Show richer metadata with `--details`.
- Produce JSON output for future integrations.
- Report missing or inaccessible scan locations.
- Avoid symbolic links and large dependency directories.
- Run completely offline after the one-time dependency installation.

## What it does not do yet

- Discover MCP configuration files.
- Discover plugin manifests as inventory items.
- Test whether an MCP server is running.
- Discover cloud-managed connections.
- Audit skill security.
- Install, disable, update, or remove anything.
- Provide a graphical interface.

## Requirements

- Node.js 20 or newer.
- macOS for the initial tested version.

The scanner is written with cross-platform Node.js APIs, but Windows and Linux default locations
have not been added or tested yet.

Check your Node.js version:

```bash
node --version
```

## Getting started

Install the project dependencies:

```bash
npm install
```

From the repository directory, start the interactive CLI:

```bash
npm start
```

You will be asked which application to scan:

```text
Which application would you like to scan?
  1. ChatGPT
  2. Claude
  3. Both
Select 1, 2, or 3:
```

You can also make a selection directly:

```bash
npm run scan -- --app chatgpt
npm run scan -- --app claude
npm run scan -- --app all
npm run scan -- --app all --details
```

Human-readable results are grouped by application:

```text
ChatGPT
  pdf
  presentations
  spreadsheets

Claude
  document-review
  research
```

The default output intentionally keeps the inventory easy to scan. Use `--details` for descriptions,
sources, metadata status, and locations. Use JSON output when another program needs the complete
records.

```bash
npm run scan -- --app chatgpt --details
```

For a production-style run, compile the TypeScript source and use the executable:

```bash
npm run build
node ./bin/skillmanager.js scan --app chatgpt
```

### JSON output

Use `--json` when another program needs to consume the results:

```bash
node ./bin/skillmanager.js scan --app all --json
```

JSON output contains two arrays:

```json
{
  "skills": [],
  "diagnostics": []
}
```

Each skill record includes its application, declared and folder names, description, source
classification, metadata status, location, and modification time. JSON preserves separate records
for same-named variants.

## Metadata status

The scanner assigns one transparent status to each local definition:

| Status       | Meaning                                                          |
| ------------ | ---------------------------------------------------------------- |
| `valid`      | The frontmatter contains string `name` and `description` fields. |
| `incomplete` | Frontmatter parsed, but a required field is missing or invalid.  |
| `missing`    | The file does not begin with YAML frontmatter.                   |
| `invalid`    | Frontmatter exists but cannot be parsed safely.                  |
| `unreadable` | The marker was found, but its contents could not be read.        |

The simple view marks any non-valid definition. The detailed view explains the specific issue.
Malformed metadata never removes a discovered skill from the inventory.

If several files have the same declared name and different contents, the CLI shows them as variants.
Byte-identical session snapshots are collapsed.

## Default scan locations

The initial macOS version checks these locations:

| Application    | Purpose                        | Location                                                                       |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| ChatGPT        | Direct skills                  | `~/.codex/skills`                                                              |
| ChatGPT        | Plugin-provided skills         | `~/.codex/plugins`                                                             |
| Claude         | Direct skills                  | `~/.claude/skills`                                                             |
| Claude         | Plugin-provided skills         | `~/.claude/plugins`                                                            |
| Claude Desktop | Session/plugin skill snapshots | `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin` |

A missing directory is normal. It usually means that the application has no local items installed in
that location.

These paths are intentionally centralized in `src/applications.ts` so that platform-specific paths
can be added without rewriting the scanner.

## How discovery works

The scanner follows this process:

1. Load the locations associated with the selected applications.
2. Check whether each location exists and is a readable directory.
3. Walk through its subdirectories.
4. Treat a directory containing `SKILL.md` as one installed skill.
5. Stop descending into that skill because nested folders are supporting files.
6. Parse the bounded YAML frontmatter for a declared name and description.
7. Fall back to the folder name when metadata is missing or invalid.
8. Hash `SKILL.md` in memory to collapse identical session snapshots.
9. Classify the local source and return results with scan diagnostics.

## Safety model

Discovered files must be treated as untrusted input. This version follows these rules:

- Never execute discovered scripts or commands.
- Never modify discovered files.
- Never parse `SKILL.md` as executable code.
- Parse at most 64 KB as declarative YAML frontmatter.
- Strip terminal control sequences from human-readable output.
- Use skill contents only to create a local fingerprint for exact deduplication.
- Never save or transmit the fingerprinted contents.
- Never follow symbolic links.
- Never scan the entire home directory.
- Skip `.git`, `node_modules`, build output, and similar directories.
- Stop recursively scanning below a fixed maximum depth.
- Continue when an optional location is missing or unreadable.
- Do not send scan results over the network.

## Project structure

```text
SkillManagerOS/
├── bin/
│   └── skillmanager.js       Small wrapper for compiled JavaScript
├── src/
│   ├── applications.ts       Supported apps and default locations
│   ├── cli.ts                Arguments, interactive menu, and output
│   ├── main.ts               Development command-line entry point
│   ├── metadata.ts           Bounded YAML frontmatter parsing
│   ├── scanner.ts            Read-only filesystem discovery
│   └── types.ts              Shared domain types
├── test/
│   ├── cli.test.ts           Command argument tests
│   ├── metadata.test.ts      Metadata parsing and edge-case tests
│   └── scanner.test.ts       Scanner behavior and safety tests
├── eslint.config.js          ESLint configuration
├── package-lock.json         Reproducible dependency versions
├── package.json
├── tsconfig.json             Strict development type checking
├── tsconfig.build.json       Production JavaScript build
└── README.md
```

Keeping these responsibilities separate makes the code easier to learn:

- `applications.ts` answers **where should we look?**
- `metadata.ts` answers **what safe metadata does the skill declare?**
- `scanner.ts` answers **what skill markers are present?**
- `cli.ts` answers **what did the user request and how should results appear?**
- `types.ts` defines the records shared by those modules.

## Development

Run the automated tests:

```bash
npm test
```

Run strict type checking, linting, and a formatting check:

```bash
npm run check
```

Create production JavaScript in the ignored `dist/` directory:

```bash
npm run build
```

Apply the standard formatting after editing:

```bash
npm run format
```

The tests create temporary fake skill directories. They do not inspect or modify your real ChatGPT
or Claude files.

## Adding another default location

Add a location to the appropriate application in `src/applications.ts`:

```ts
{
  label: "Example skills",
  path: path.join(os.homedir(), ".example", "skills"),
  source: "default",
}
```

The shared scanner will include it automatically.

## Planned milestones

1. **MVP 1A — Local skill discovery:** complete.
2. **MVP 1B — Parsing:** complete.
3. **MVP 1C — Inventory:** add richer filtering and a desktop interface.
4. **MVP 1D — Change detection:** identify added, removed, and modified items.
5. **Later pillars:** local MCP discovery, plugin inspection, auditing, and safe management.

## Contributing principles

- Prefer small modules with one responsibility.
- Use clear names before adding explanatory comments.
- Comment the reason behind a decision, not every line of code.
- Add tests for new discovery and safety behavior.
- Keep filesystem operations read-only during the discovery milestones.
- Do not add a dependency when a small built-in Node.js API is sufficient.

## License

This research project is licensed under the MIT License.

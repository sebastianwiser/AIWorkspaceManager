# SkillManagerOS

SkillManagerOS is an early, read-only command-line tool for discovering local AI skills installed
for ChatGPT and Claude.

This repository currently includes **MVP 1A: local skill discovery**, **MVP 1B: safe metadata
parsing**, and **MVP 1C: inventory**. The program finds folders containing `SKILL.md`, reads their
declarative YAML frontmatter, and presents the inventory through a desktop app or CLI. It does not
execute, install, modify, or remove any skill.

## Project goals

The long-term goal is to build a local-first manager for skills, plugins, and Model Context Protocol
(MCP) connections used by AI applications. The project starts with read-only local discovery so its
inventory behavior can be validated before configuration management is added.

The current version answers one question:

> Which local skills are installed for ChatGPT and Claude, what do they do, and where did they come
> from?

## Current features

- Scan ChatGPT skill and plugin directories.
- Scan Claude skill and plugin directories.
- Discover project-local skills from projects already registered with Codex or Claude.
- Recognize `.codex/skills`, `.claude/skills`, and shared `.agents/skills` project folders.
- Select one application or scan both.
- Find direct and plugin-provided skills using the `SKILL.md` marker.
- Read declared skill names and descriptions from YAML frontmatter.
- Classify personal, system, plugin, plugin-cache, and Claude Desktop sources.
- Identify missing, incomplete, invalid, or unreadable metadata.
- Group same-named definitions as variants without discarding either one.
- Search names, folder names, and descriptions.
- Filter by application, source, and metadata status.
- Filter between global skills and each actual ChatGPT or Claude project.
- Sort by name, application, source, or modification date.
- Browse inventory metadata and rendered, read-only `SKILL.md` contents in a desktop interface.
- Switch between a formatted GitHub-style Markdown preview and the original source text.
- Rescan local locations from the desktop interface.
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
- Ship signed or packaged desktop installers.

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

Launch the desktop interface:

```bash
npm run desktop
```

This builds the TypeScript and React code, then opens the local Electron application. The first
desktop version is a development build rather than a packaged `.app` installer.

### Command-line interface

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
npm run scan -- --app all --search document
npm run scan -- --app all --source personal,plugin
npm run scan -- --app all --status invalid,missing --sort source
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

## Inventory filters

Filters can be combined. Values separated by commas are treated as alternatives within that filter,
while different filters must all match.

```bash
npm run scan -- --app all --search document --source personal,plugin --status valid
```

Available source IDs are:

- `personal`
- `system`
- `plugin`
- `plugin-cache`
- `claude-desktop-plugin`
- `project`

Available metadata statuses are `valid`, `incomplete`, `missing`, `invalid`, and `unreadable`.

Sort inventory results with `--sort name`, `--sort application`, `--sort source`, or
`--sort modified`. Add `--order desc` for descending order:

```bash
npm run scan -- --app all --sort modified --order desc --details
```

The same filters and ordering also apply to `--json` output. These operations happen after the
read-only scan and never change local skill files.

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

The app also reads the local Codex and Claude project registries, including named Claude Desktop
projects with linked folders, then checks only those known project roots for conventional skill
folders:

| Availability | Folder pattern   | Shown for          |
| ------------ | ---------------- | ------------------ |
| Project      | `.codex/skills`  | ChatGPT            |
| Project      | `.claude/skills` | Claude             |
| Project      | `.agents/skills` | ChatGPT and Claude |

Nested skill folders inside a registered project are supported and remain grouped under the
registered project name. Generated dependency folders, build output, Git internals, and archived
copies are skipped. This keeps project discovery useful without scanning the entire home directory.

Claude Desktop currently makes some built-in and installed plugin skills available through local
session snapshots. SkillManagerOS keeps that location as a fallback, while preferring the real
project folder for project-scoped definitions. Identical snapshots are still collapsed.

A missing directory is normal. It usually means that the application has no local items installed in
that location.

These paths are intentionally centralized in `src/applications.ts` so that platform-specific paths
can be added without rewriting the scanner.

## How discovery works

The scanner follows this process:

1. Load project identities, names, and attached folder roots registered with Codex and Claude.
2. Find conventional skill folders inside those known project roots.
3. Check whether each location exists and is a readable directory.
4. Walk through its subdirectories.
5. Treat a directory containing `SKILL.md` as one installed skill.
6. Stop descending into that skill because nested folders are supporting files.
7. Parse the bounded YAML frontmatter for a declared name and description.
8. Fall back to the folder name when metadata is missing or invalid.
9. Hash `SKILL.md` in memory to collapse identical session snapshots within the same scope.
10. Record whether the definition is global or belongs to a specific project.
11. Classify the local source and return results with scan diagnostics.
12. Build an inventory view by applying the requested search, filters, and ordering.

## Safety model

Discovered files must be treated as untrusted input. This version follows these rules:

- Never execute discovered scripts or commands.
- Never modify discovered files.
- Never parse `SKILL.md` as executable code.
- Allow the desktop content viewer to read only files returned by the latest scan.
- Limit each desktop content preview to 512 KB to keep the interface responsive.
- Render Markdown without raw HTML or remote images, so viewed content remains inert and local.
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
- Keep filesystem access in Electron's main process.
- Expose only a narrow, read-only scan function to the desktop interface.
- Disable renderer Node.js access, new windows, and web navigation.

## Project structure

```text
SkillManagerOS/
├── bin/
│   └── skillmanager.js       Small wrapper for compiled JavaScript
├── src/
│   ├── applications.ts       Supported apps and default locations
│   ├── cli.ts                Arguments, interactive menu, and output
│   ├── desktop/
│   │   ├── main.ts           Secure Electron main process
│   │   ├── preload.cts       Narrow read-only desktop bridge
│   │   └── renderer/         React inventory interface and styles
│   ├── inventory.ts          Reusable searching, filtering, and sorting
│   ├── main.ts               Development command-line entry point
│   ├── metadata.ts           Bounded YAML frontmatter parsing
│   ├── projects.ts           Safe project registry and skill-folder discovery
│   ├── scanner.ts            Read-only filesystem discovery
│   └── types.ts              Shared domain types
├── test/
│   ├── cli.test.ts           Command argument tests
│   ├── inventory.test.ts     Inventory filtering and sorting tests
│   ├── metadata.test.ts      Metadata parsing and edge-case tests
│   ├── projects.test.ts      Project discovery and boundary tests
│   └── scanner.test.ts       Scanner behavior and safety tests
├── eslint.config.js          ESLint configuration
├── package-lock.json         Reproducible dependency versions
├── package.json
├── tsconfig.json             Strict development type checking
├── tsconfig.build.json       Production JavaScript build
├── vite.config.ts            Desktop renderer build
└── README.md
```

Keeping these responsibilities separate makes the code easier to learn:

- `applications.ts` answers **where should we look?**
- `inventory.ts` answers **which discovered skills should this view show?**
- `metadata.ts` answers **what safe metadata does the skill declare?**
- `projects.ts` answers **which known projects contain local skill folders?**
- `scanner.ts` answers **what skill markers are present?**
- `cli.ts` answers **what did the user request and how should results appear?**
- `types.ts` defines the records shared by those modules.
- `desktop/` presents the same inventory through a secure local window.

## Development

Run the automated tests:

```bash
npm test
```

Run strict type checking, linting, and a formatting check:

```bash
npm run check
```

Create the production CLI, Electron processes, and React interface in the ignored `dist/` directory:

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
3. **MVP 1C — Inventory:** complete with reusable filtering, CLI controls, and a desktop interface.
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

# SkillManagerOS

[![CI](https://github.com/sebastianwiser/AIWorkspaceManager/actions/workflows/ci.yml/badge.svg)](https://github.com/sebastianwiser/AIWorkspaceManager/actions/workflows/ci.yml)

SkillManagerOS is an early, local-first desktop and command-line tool for discovering AI skills,
plugin bundles, and MCP server configurations in local ChatGPT and Claude setups.

This repository currently includes **MVP 1A: local skill discovery**, **MVP 1B: safe metadata
parsing**, **MVP 1C: inventory**, **MVP 1D: change detection**, **MVP 2A: local MCP discovery**,
**MVP 2C: plugin inventory**, and **MVP 2D: relationships**. The program finds folders containing
`SKILL.md`, reads declarative skill and plugin metadata, and inventories local MCP configuration
without starting a server while redacting private configuration values. It does not execute,
install, modify, or remove any discovered item.

## Project goals

The long-term goal is to build a local-first manager for skills, plugins, and Model Context Protocol
(MCP) connections used by AI applications. The project starts with read-only local discovery so its
inventory behavior can be validated before configuration management is added.

The current version answers three questions:

> Which local skills are installed for ChatGPT and Claude, what do they do, and where did they come
> from?

> Which MCP servers are configured for those applications and projects, and how are they intended to
> connect?

> Which plugins are installed, where did they come from, and which skills, MCP servers, apps, and
> hooks do they include?

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
- Compare each desktop scan with the previous scan.
- Identify added, modified, moved or renamed, and removed skills.
- Filter and inspect changes in a dedicated desktop view.
- Reset the change-detection baseline after confirmation.
- Print a simple list grouped by application.
- Show richer metadata with `--details`.
- Produce JSON output for future integrations.
- Report missing or inaccessible scan locations.
- Avoid symbolic links and large dependency directories.
- Run completely offline after the one-time dependency installation.
- Discover global and known-project MCP configuration for Codex, Claude Code, and Claude Desktop.
- Parse stdio, HTTP, and SSE definitions without starting or contacting a server.
- Show MCP names, applications, scope, transports, safe commands and URLs, and configuration paths.
- Redact unknown configuration values by default, including URL paths, queries, fragments,
  credentials, and command arguments that cannot be shown safely.
- Identify invalid and same-scope duplicate MCP server definitions.
- Search and filter MCP servers by application and project.
- Inspect a formatted, sanitized configuration excerpt in the desktop interface.
- Group same-named skills and MCP configurations into explainable cross-app capability candidates.
- Distinguish strong local evidence (a shared file or endpoint) from a name-only match that needs
  review.
- Discover confirmed Claude installations, app-bundled plugins, and local plugin bundles while
  labeling Codex cache entries as cached rather than confirmed installations.
- Parse portable, Codex, and Claude plugin manifests using bounded, read-only file access.
- Search and filter plugins by application, project, and manifest status.
- Show plugin version, publisher, source, scope, provenance, and local manifest location.
- Connect each plugin to its discovered skills and packaged MCP servers, apps, and hooks.
- Explore an application → global/project → plugin → skill/MCP relationship map in the desktop app.
- Inspect cross-app capability links with explicit shared-file, shared-endpoint, or name-only
  evidence.

## What it does not do yet

- Test whether an MCP server is running or an endpoint responds.
- Discover cloud-managed connections.
- Audit skill security.
- Install, disable, update, or remove anything.
- Ship signed or packaged desktop installers.

## Requirements

- Node.js 22.13 or newer in the 22.x line, or Node.js 24 or newer.
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
npm ci
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
npm run scan -- --kind mcp --app all --details
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

JSON output contains four arrays:

```json
{
  "skills": [],
  "mcpServers": [],
  "plugins": [],
  "diagnostics": []
}
```

Each skill record includes its application, declared and folder names, description, source
classification, metadata status, location, and modification time. JSON preserves separate records
for same-named variants.

MCP records contain only sanitized commands, arguments, URLs, and configuration excerpts. Literal
environment and header values are never included; exact endpoint comparisons use random, scan-local
equality labels rather than exposing the private definitions.

Plugin records contain sanitized manifest provenance, installation evidence, and references to
included components. Codex cache entries are explicitly marked as unverified installations;
marketplace catalog listings are omitted.

## Cross-app identity

The desktop app keeps each discovered definition intact while also presenting a capability-level
view across ChatGPT and Claude. A shared skill file or identical MCP endpoint is shown as strong
evidence that both applications use the same capability. A matching name at different locations is
shown as a reviewable candidate, not silently merged. This model is the foundation for future
relationship and portability views.

Skills are displayed as one block per capability instead of one row per application record. Each
block shows its ChatGPT and Claude availability. When matching definitions live in more than one
local file, the detail panel provides a variant switch and shows which application, source, project,
and file belong to the selected variant. A read-only comparison view highlights added and removed
lines between variants while collapsing long unchanged sections.

The **Relationships** view shows the local application, location, and plugin path to each discovered
skill or configured MCP server. Plugin-packaged MCP declarations are labeled separately unless the
same application, scope, name, and configuration file are also found in the configured MCP
inventory. This map describes what the local scan observed; it does not verify that a server can
start or that two name-only matches are equivalent.

## MCP inventory

Use the **Skills | MCP Servers | Plugins | Relationships** switch in the desktop app, or
`--kind mcp` in the CLI. MCP servers can be searched and filtered by application and project. The
detail view shows the inferred transport, safe endpoint summary, declared environment-variable and
header names, configuration location, validation notes, and a sanitized source excerpt.

The read-only MCP scan checks these local configuration sources when present:

| Application    | Scope   | Location                                                                   |
| -------------- | ------- | -------------------------------------------------------------------------- |
| Codex          | Global  | `~/.codex/config.toml`                                                     |
| Codex          | Project | `<known project>/.codex/config.toml`                                       |
| Claude Code    | Global  | `~/.claude.json`                                                           |
| Claude Code    | Project | `<known project>/.mcp.json` and project entries in `~/.claude.json`        |
| Claude Desktop | Global  | `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS |

Missing configuration files are normal and remain silent. Malformed files, invalid server
definitions, and duplicate names in the same application and scope produce warnings. The scan never
starts a command, opens a connection, checks reachability, or modifies configuration.

## Plugin inventory

Use the **Plugins** view in the desktop app, or `--kind plugins` in the CLI. The inventory
recognizes portable root `plugin.json` manifests plus the `.codex-plugin/plugin.json` and
`.claude-plugin/plugin.json` compatibility formats. It reads cached Codex bundles, Claude install
records, Claude synced plugins, and plugin manifests loaded from Claude skills directories.

The detail view shows the declared version, publisher, source, scope, installation evidence,
manifest format, provenance, and the skills, packaged MCP servers, apps, and hooks found inside the
bundle. Discovery never loads plugin code or runs a hook, command, or MCP server. Claude marketplace
repositories are catalogs; their entries appear only when an install record or synced bundle proves
that the plugin is locally installed.

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

## Change detection

The desktop app creates its first comparison baseline automatically. Every later rescan compares the
current inventory with that baseline, reports what changed, and then safely advances the baseline to
the new inventory. Changes can be filtered using the same application, project, source, search, and
sorting controls as the main inventory.

SkillManagerOS distinguishes four change types:

| Change   | Meaning                                                        |
| -------- | -------------------------------------------------------------- |
| Added    | A new local `SKILL.md` appeared.                               |
| Modified | The contents of a previously known `SKILL.md` changed.         |
| Moved    | The same contents appeared at a different local path.          |
| Removed  | A previously known local `SKILL.md` is no longer discoverable. |

The baseline stores inventory metadata and SHA-256 content hashes in Electron's private application
data directory. It does not store the contents of `SKILL.md`. The **Reset baseline** action replaces
the comparison point with the current inventory; it never changes the discovered skill files.

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
9. Hash bounded `SKILL.md` files to collapse only identical Claude Desktop session snapshots within
   the same scope; keep separate plugin files distinct for ownership.
10. Record whether the definition is global or belongs to a specific project.
11. Classify the local source and return results with scan diagnostics.
12. Inspect bounded plugin manifests and connect their packaged components to the owning plugin.
13. Build an inventory view by applying the requested search, filters, and ordering.

## Safety model

Discovered files must be treated as untrusted input. This version follows these rules:

- Never execute discovered scripts or commands.
- Never start or contact a discovered MCP server.
- Never modify discovered files.
- Never parse `SKILL.md` as executable code.
- Allow the desktop content viewer to read only files returned by the latest scan.
- Limit each desktop content preview to 512 KB to keep the interface responsive.
- Render Markdown without raw HTML or remote images, so viewed content remains inert and local.
- Parse at most 64 KB as declarative YAML frontmatter.
- Strip terminal control sequences from human-readable output.
- Use skill contents only to create a local fingerprint for exact deduplication.
- Save only one-way content hashes in the local baseline, never the skill contents themselves.
- Preserve the previous baseline and pause change comparison if a scan is incomplete.
- Never follow symbolic links.
- Never scan the entire home directory.
- Skip `.git`, `node_modules`, build output, and similar directories.
- Stop recursively scanning below a fixed maximum depth.
- Continue when an optional location is missing or unreadable.
- Do not send scan results over the network.
- Redact unrecognized MCP values, URL paths and credentials, and unsafe command arguments before
  configuration leaves the trusted scan layer.
- Keep filesystem access in Electron's main process.
- Expose only narrow inventory, content-preview, and baseline-reset functions to the desktop
  interface.
- Disable renderer Node.js access, new windows, and web navigation.

## Architecture

```text
CLI ──────────────┐
                  ├── shared TypeScript discovery + inventory ── bounded local files
Electron main ────┘                 │
      │                       capabilities + relationships
      └── narrow preload API ── React desktop view
```

Both interfaces use the same scan pipeline in `src/inventory-scan.ts`. Source adapters in
`applications.ts`, `projects.ts`, `scanner.ts`, `mcp.ts`, and `plugins.ts` read only known
locations; `safe-file.ts` enforces bounded, no-follow reads. Pure modules in `inventory.ts`,
`capabilities.ts`, and `relationships.ts` turn those records into searchable views without claiming
that same-named items are identical. `changes.ts` stores a local, metadata-only comparison baseline.
The Electron main process owns filesystem access, while the React renderer receives only the narrow
preload API.

Tests in `test/` cover parsing, identity, redaction, filesystem boundaries, change detection, and
the relationship view. The
[audit and management decision](docs/decisions/0001-audit-and-management-architecture.md) defines
the safety boundaries for the next pillars.

## Development

Run the automated tests:

```bash
npm test
```

Run strict type checking, linting, and a formatting check:

```bash
npm run check
```

GitHub Actions runs the tests, checks, and production build on both macOS and Ubuntu for every push
and pull request. Desktop discovery is initially supported on macOS; the Ubuntu job guards the
shared TypeScript core and build portability.

Create the production CLI, Electron processes, and React interface in the ignored `dist/` directory:

```bash
npm run build
```

Apply the standard formatting after editing:

```bash
npm run format
```

The tests create temporary fake skill directories and MCP configurations. They do not inspect or
modify your real ChatGPT or Claude files.

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
4. **MVP 1D — Change detection:** complete with local baselines and added, modified, moved, and
   removed skill views.
5. **MVP 2A — Local MCP discovery:** complete with secret-safe parsing, filtering, diagnostics, and
   desktop/CLI inventory views.
6. **Cross-app identity foundation:** capability candidates now connect app-specific skill and MCP
   records with explicit match evidence.
7. **MVP 2C — Plugin inventory:** complete with installation-evidence labels, component
   relationships, filtering, and desktop/CLI inventory views.
8. **MVP 2D — Relationships:** read-only application/project/plugin/component map with cross-app
   evidence and explicit packaged-versus-configured MCP distinction.
9. **Later pillars:** explicit MCP status checks, auditing, portability, and safe management.

The [audit and management architecture](docs/decisions/0001-audit-and-management-architecture.md)
sets the safety boundaries and delivery gates for Pillars 3 and 4. Those features are not yet
implemented.

## Contributing principles

- Prefer small modules with one responsibility.
- Use clear names before adding explanatory comments.
- Comment the reason behind a decision, not every line of code.
- Add tests for new discovery and safety behavior.
- Keep filesystem operations read-only during the discovery milestones.
- Do not add a dependency when a small built-in Node.js API is sufficient.

## License

This research project is licensed under the MIT License.

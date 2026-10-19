# Usage guide

This guide describes the current desktop and CLI behavior. For risk boundaries, read the
[security model](SECURITY.md). Planned features are kept in the [roadmap](ROADMAP.md).

## Install and run

Use macOS with Node.js `^22.13.0` or `>=24.0.0`:

```bash
npm ci
npm run desktop
```

The desktop command builds the CLI core and React interface, then opens a development Electron
window. There is no signed `.app` installer yet. To use the CLI without opening the window:

```bash
npm start
npm run scan -- --app all
```

`npm start` asks which application to scan. `npm run scan -- --app all` skips the prompt. After
`npm run build`, the compiled entry point is `node ./bin/skillmanager.js scan --app all`.

## Desktop views

| View             | How to use it                                                                                                                                                                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skills           | Search and filter by application, project, source, and metadata status. Open a block to see local variants, their app/project connections, metadata, and a safe rendered or source-text `SKILL.md` preview. Compare two variants with the read-only line diff. |
| Skills → Changes | Compare the current scan with the previous desktop baseline. Filter added, modified, moved, and removed skills. Resetting the baseline changes the comparison point, not a skill file.                                                                         |
| MCP Servers      | Search by application and project. Select a server to inspect its transport, safe command or endpoint summary, configuration path, validation notes, and sanitized configuration excerpt.                                                                      |
| Plugins          | Filter local bundles by application, project, and manifest status. Inspect version, publisher, scope, installation evidence, provenance, and packaged components.                                                                                              |
| Relationships    | Browse the application → global/project → plugin → skill/MCP map. Inspect cross-app links and their evidence. Packaged MCP declarations are separate from configured servers unless their exact local identities match.                                        |
| Audit            | Review static findings by application, category, severity, or text. Open an affected item, examine partial-check coverage and potential access, and see changed inspected files since the prior scan.                                                          |
| Import           | Choose a local skill folder and target application, inspect the exact destination and script warning, then confirm the native dialog. Saved history lets you move an unchanged import into a recovery folder after restarting.                                 |

Use **Rescan** after changing local application files. A missing optional directory is normal;
inaccessible or malformed expected sources appear as diagnostics. The first successful desktop scan
establishes a comparison baseline. See [interpreting results](#interpreting-results) for why an
empty finding list does not imply a clean bill of health.

## CLI examples

```bash
npm run scan -- --app chatgpt
npm run scan -- --app claude --details
npm run scan -- --app all --search document
npm run scan -- --app all --source personal,plugin --status valid
npm run scan -- --app all --sort modified --order desc
npm run scan -- --kind mcp --app all --details
npm run scan -- --kind plugins --app all --details
npm run scan -- --kind audit --app all --details
npm run scan -- --app all --json
```

`--kind` accepts `skills` (default), `mcp`, `plugins`, or `audit`. `--app` accepts `chatgpt`,
`claude`, or `all`. The skill inventory also accepts:

| Option     | Values                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------- |
| `--source` | Comma-separated `personal`, `system`, `plugin`, `plugin-cache`, `claude-desktop-plugin`, `project` |
| `--status` | Comma-separated `valid`, `incomplete`, `missing`, `invalid`, `unreadable`                          |
| `--sort`   | `name`, `application`, `source`, `modified`                                                        |
| `--order`  | `asc` or `desc`                                                                                    |

`--search` filters the selected view, `--details` expands human-readable results, and `--help`
prints the complete current CLI syntax. Different filters combine; comma-separated values within one
filter are alternatives.

For non-audit `--json`, the CLI returns `skills`, `mcpServers`, `plugins`, and `diagnostics` arrays
even if `--kind` selects one human-readable view. For `--kind audit --json`, it returns a standalone
audit report with findings, coverage, and bounded file fingerprints. JSON contains local paths and
file hashes; review it before publishing or sharing it. Credential-like matches and raw MCP secret
values are not included in audit findings or sanitized MCP fields.

## Supported local sources

The initial macOS version checks these default skill locations when present:

| Application    | Purpose                        | Location                                                                       |
| -------------- | ------------------------------ | ------------------------------------------------------------------------------ |
| ChatGPT/Codex  | Direct skills                  | `~/.codex/skills`                                                              |
| ChatGPT/Codex  | Plugin-provided skills         | `~/.codex/plugins`                                                             |
| Claude         | Direct skills                  | `~/.claude/skills`                                                             |
| Claude         | Plugin-provided skills         | `~/.claude/plugins`                                                            |
| Claude Desktop | Session/plugin skill snapshots | `~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin` |

Known projects come from local Codex and Claude project registrations. Only registered project roots
are checked for `.codex/skills` (ChatGPT), `.claude/skills` (Claude), and shared `.agents/skills`
(both). The app does not search the entire home directory. Identical Claude Desktop session
snapshots may be collapsed; separate plugin files remain distinct so ownership is not hidden.

Local MCP configuration sources include:

| Application    | Scope         | Location                                                          |
| -------------- | ------------- | ----------------------------------------------------------------- |
| Codex          | Global        | `~/.codex/config.toml`                                            |
| Codex          | Known project | `<project>/.codex/config.toml`                                    |
| Claude Code    | Global        | `~/.claude.json`                                                  |
| Claude Code    | Known project | `<project>/.mcp.json` and project entries in `~/.claude.json`     |
| Claude Desktop | Global        | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Plugin discovery recognizes root `plugin.json`, `.codex-plugin/plugin.json`, and
`.claude-plugin/plugin.json` manifests. It distinguishes confirmed Claude installations, app-bundled
plugins, local bundles, synced plugins, and Codex cache entries. A cache entry is not proof that its
plugin is installed or enabled; marketplace catalogs are not treated as installs.

## Interpreting results

### Skill identity and variants

One skill block can represent ChatGPT and Claude records that refer to the same capability. A shared
local file is strong evidence; a normalized name at different paths is only a candidate. The
original definitions remain available as variants. A read-only diff highlights their added and
removed lines without claiming the variants behave identically.

Metadata status describes parsing, not trust:

| Status       | Meaning                                                        |
| ------------ | -------------------------------------------------------------- |
| `valid`      | YAML frontmatter has string `name` and `description` fields.   |
| `incomplete` | Frontmatter parsed but a required field is missing or invalid. |
| `missing`    | No leading YAML frontmatter was found.                         |
| `invalid`    | Frontmatter exists but could not be parsed safely.             |
| `unreadable` | The marker was found but its content could not be read.        |

An invalid or missing name falls back to the folder name so the item remains visible.

### Changes and audit coverage

Skill changes are `added`, `modified`, `moved`, or `removed`. The desktop stores inventory metadata
and bounded content hashes in its local application-data directory, not full skill contents. A scan
that cannot justify a removal preserves the prior baseline and does not report that removal as a
fact.

The Audit view uses heuristic, static checks for malformed definitions, duplicate or broken local
references, credential-like patterns, risky commands, broad access, permissions, plaintext MCP URLs,
hooks, and incomplete provenance. It also fingerprints bounded files in discovered skill and plugin
bundles. An unreadable, oversized, linked, or uninspected source is marked as partial or not
evaluated. Findings may be false positives; absence of findings is not proof of safety. Audit file
changes are desktop-only and compare against the previous local audit baseline.

### Import and recovery

Import accepts one local folder with a top-level `SKILL.md`, into a global ChatGPT or Claude skills
location only. The folder name becomes the destination name. The preview is time-limited; the app
rejects existing destinations and changed sources before copying. The native confirmation repeats
source, destination, file count, and script warning. No script is run.

The Import view shows saved history across app restarts. Each record is checked against the current
folder before **Move to recovery** is offered. Undo stops if files or directory identity changed;
otherwise the folder is moved to a hidden `.skillmanager-recovery-*` folder in the same skills root.
It is not deleted. The app ignores recovery folders during discovery. Missing or changed folders
remain visible but cannot be undone. An interrupted import or undo is marked **Needs review** and is
never silently retried; inspect the shown destination and recovery paths before acting manually. An
unreadable or invalid history file is preserved and blocks new imports until repaired. The local
history file is under the app's user-data directory at `skillmanager/import-history.json` and stores
paths, file hashes, and timestamps, not skill contents. History is capped at 100 records; a full
journal stops new imports rather than discarding old recovery evidence. Archives, downloads, project
installs, overwrites, updates, and CLI import are not supported. See the
[security model](SECURITY.md) for file limits and the full trust boundary.

## Troubleshooting

- **Nothing found:** confirm the application uses one of the supported locations. Missing optional
  directories are expected; use **Rescan** after creating a skill or config.
- **A known project is absent:** project discovery is based on local Codex/Claude registrations, not
  a whole-disk search. Check that the project is registered and uses a recognized skills path.
- **A finding seems wrong:** open the affected item and inspect the cited location privately. The
  audit intentionally reports patterns with uncertainty instead of deciding intent.
- **A baseline is unavailable:** a partial scan preserves previous comparison data. An invalid or
  unreadable audit-file baseline is preserved and reported; repair it manually only after making a
  copy and understanding what will be lost.
- **Import is rejected:** check the folder name, top-level `SKILL.md`, links/hidden paths, size
  limits, whether the target name already exists, and whether the source changed since preview.

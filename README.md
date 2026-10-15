# SkillManagerOS

[![CI](https://github.com/sebastianwiser/AIWorkspaceManager/actions/workflows/ci.yml/badge.svg)](https://github.com/sebastianwiser/AIWorkspaceManager/actions/workflows/ci.yml)

SkillManagerOS is a local-first desktop app and CLI for understanding the AI capabilities on your
machine. It discovers ChatGPT/Codex and Claude skills, MCP server configurations, and plugins; shows
how they relate across applications and projects; and flags issues worth reviewing. The first
management action lets you add one local skill folder with a preview, confirmation, and recoverable
undo.

It is an early macOS-focused project, not a packaged installer or a security certification. Scans do
not execute discovered code or contact MCP servers.

## Quick start

Requirements: macOS and Node.js `^22.13.0` or `>=24.0.0`.

```bash
npm ci
npm run desktop
```

`npm run desktop` builds and opens the Electron app. For the command-line interface:

```bash
npm run scan -- --app all
npm run scan -- --kind mcp --app all --details
npm run scan -- --kind plugins --app all --details
npm run scan -- --kind audit --app all --details
```

Run `npm start` for an interactive application choice, or `npm run scan -- --help` for every CLI
option. The CLI performs discovery and auditing only; importing a skill is available in the desktop
app. See the [usage guide](docs/USAGE.md) for filters, JSON output, supported locations, and
interpretation of results.

## What you can do today

| View              | What it shows                                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Skills**        | Global and known-project skills, metadata, source, and safe Markdown preview. Same capability appears as one block across apps, with selectable variants and a read-only diff.     |
| **MCP Servers**   | Local stdio, HTTP, and SSE definitions, scope, transport, sanitized configuration, and duplicate or invalid definitions. Servers are never started or contacted.                   |
| **Plugins**       | Local bundles, installation evidence, provenance, and included skills, MCP declarations, apps, and hooks. Cached does not mean installed.                                          |
| **Relationships** | Evidence-aware links among applications, projects, plugins, skills, and configured MCP servers. A matching name alone is not treated as proof of equivalence.                      |
| **Audit**         | Structural and static security findings, bounded bundle inspection, potential access, change fingerprints, and explicit incomplete-check coverage.                                 |
| **Import**        | Add one local skill folder to a global ChatGPT or Claude skills location after preview and confirmation. An unchanged import can be moved to recovery during the same app session. |

Desktop scans also compare skill inventory against a local baseline, showing added, modified, moved,
and removed definitions. Read-only discovery and the CLI remain separate from the confirmed Import
action.

## Safety and limits

- Discovered files, Markdown, plugin metadata, and MCP configuration are untrusted input. Scanning
  does not run scripts, hooks, commands, or servers.
- MCP values, credentials, and unsafe command arguments are redacted from inventory views. Audit
  findings contain controlled descriptions and locations, not matched secret text.
- Scans are bounded to supported locations and known projects, skip links and dependency/build
  folders, and report partial checks instead of calling an incomplete audit “clean.”
- Import is additive: no archives, downloads, overwrites, project installs, updates, or automatic
  setup scripts. The app verifies copied files and does not delete them on undo.
- A static finding is a prompt to inspect, not proof of compromise; no finding is not proof of
  safety. JSON output and local baselines include file paths and hashes and should be treated as
  local data.

Read the [security model](docs/SECURITY.md) before relying on audit findings or importing a skill.
MCP reachability tests, cloud-managed connections, broader plugin/MCP management, portable
workspaces, and signed installers are not available yet.

## Documentation

- [Usage guide](docs/USAGE.md): desktop workflows, CLI options, scan locations, and result meanings.
- [Security model](docs/SECURITY.md): trust boundaries, privacy, audit limits, and import recovery.
- [Architecture](docs/ARCHITECTURE.md): shared core, Electron boundary, modules, tests, and
  extension points.
- [Roadmap](docs/ROADMAP.md): shipped milestones, deferred work, and the long-term workspace goal.
- [Audit and management decision](docs/decisions/0001-audit-and-management-architecture.md): design
  rationale and delivery gates.

## Development

```bash
npm test
npm run check
npm run build
```

`check` runs strict TypeScript, ESLint, and Prettier checks. CI runs these commands on macOS and
Ubuntu; desktop default locations are currently tested for macOS. The security workflow adds CodeQL
and dependency review, while Dependabot proposes dependency updates. GitHub secret scanning and push
protection require separate repository settings.

Contributions should preserve the local-first safety model and include tests for parsing, file
boundaries, and failure cases. See [CONTRIBUTING.md](CONTRIBUTING.md) and the
[architecture guide](docs/ARCHITECTURE.md).

Licensed under the [MIT License](LICENSE).

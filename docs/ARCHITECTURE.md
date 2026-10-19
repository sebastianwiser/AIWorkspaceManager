# Architecture and contributor guide

SkillManagerOS keeps discovery and domain decisions in a shared TypeScript core. The CLI and
Electron desktop compose that core; neither should invent its own interpretation of a skill, plugin,
MCP server, relationship, or audit finding.

## Process boundaries

```text
CLI ────────────────┐
                    ├── supported sources → bounded reads → inventory → relationships/audit
Electron main ──────┘                                   │
      │                         local baselines and import executor
      └── typed, narrow preload API ── React renderer
```

- **Shared core:** Node.js modules discover supported local sources, parse them, build inventory and
  relationship views, and calculate deterministic audit findings. It does not depend on React or
  Electron UI state.
- **Electron main:** owns filesystem access, local baselines, trusted-window request validation,
  native dialogs, import planning/apply/undo, and scan orchestration.
- **Preload:** exposes the typed `DesktopApi` methods needed by the renderer. It is not a generic
  read/write bridge.
- **Renderer:** displays data and gathers user intent. It has context isolation, no Node.js
  integration, and no direct filesystem authority.
- **CLI:** offers read-only inventory and audit output, including machine-readable JSON. It does not
  expose the Import operation.

## Repository map

| Area                                                                      | Responsibility                                                                                 |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/applications.ts`, `src/projects.ts`                                  | Supported applications, default locations, registered projects, and project-local skill roots. |
| `src/scanner.ts`, `src/metadata.ts`, `src/safe-file.ts`                   | Bounded traversal, frontmatter parsing, and no-follow bounded file access.                     |
| `src/mcp.ts`, `src/plugins.ts`                                            | Local MCP configuration and plugin manifest adapters.                                          |
| `src/inventory-scan.ts`, `src/inventory.ts`                               | Shared scan composition, filtering, searching, and sorting.                                    |
| `src/capabilities.ts`, `src/relationships.ts`                             | Evidence-aware cross-app candidates and the application/project/plugin/component map.          |
| `src/changes.ts`                                                          | Skill inventory snapshots and baseline comparison.                                             |
| `src/audit/collect.ts`, `src/audit/index.ts`, `src/audit/integrity.ts`    | Sanitized bounded evidence, pure audit rules and coverage, file fingerprints and comparison.   |
| `src/management/import-skill.ts`                                          | Additive local skill-folder plan, staging, verification, and recoverable undo.                 |
| `src/management/history.ts`                                               | Versioned import journal, restart reconciliation, and saved undo state.                        |
| `src/desktop/main.ts`, `src/desktop/preload.cts`, `src/desktop/renderer/` | Trusted desktop process, narrow bridge, and React interface.                                   |
| `src/cli.ts`, `src/types.ts`, `test/`                                     | CLI contract, shared types, and module-aligned tests.                                          |

Generated output in `dist/` is ignored; edit `src/` and run the build instead.

## Data flow and identity

The scan first loads application locations and known projects, then discovers skills, MCP
configuration, and plugin bundles. Missing optional paths are normal; malformed or inaccessible
expected sources produce diagnostics. Inventory transformations run after discovery so CLI and
desktop agree on the underlying records.

Each discovered item retains its application, scope, source, and exact local identity. A capability
group is a presentation layer, not a replacement for those records. Shared files or exact endpoint
evidence support a strong cross-app link. Name-only matches remain reviewable candidates. Plugin
ownership is inferred from exact packaged files; a packaged MCP declaration is not a configured
server unless the application, scope, name, and configuration file match a discovered definition.

`src/audit/collect.ts` performs bounded I/O and turns observations into controlled signal codes,
paths, line numbers, and file fingerprints. `src/audit/index.ts` is pure and produces findings plus
per-application/category coverage. Matched credential values and commands do not cross into audit
findings. `src/audit/integrity.ts` compares the desktop's inspected-file snapshot; uncertain scans
do not claim file removals.

The desktop keeps two separate local comparisons: `src/changes.ts` tracks skill definitions, while
`src/audit/integrity.ts` tracks inspected bundle files. A new scan may advance a baseline only when
its relevant completeness conditions allow it. Resetting the skill baseline does not alter source
files. Baselines are machine-local observed state, not a portable workspace definition.

## Management boundary

The only write path is the local skill-folder Import action. The renderer supplies a supported
application and an opaque preview ID, not an arbitrary destination path. Electron main chooses the
known global skills root, collects a native folder selection, builds a time-limited plan, and
requires a second native confirmation. Apply rechecks hashes and directory identity, copies through
a private stage, and verifies the result. A versioned journal records intent before the copy,
completion after verification, and recovery intent before undo. Startup and UI reads reconcile each
record with the filesystem without retrying interrupted actions. Undo moves an unchanged import to
recovery, including after restart. Future archive, update, remove, plugin, or MCP operations need
separate planners and safety tests; they must not be smuggled into this action.

The [security model](SECURITY.md) documents what these checks do and do not protect against. The
[architecture decision](decisions/0001-audit-and-management-architecture.md) records the original
audit and management contracts.

## Engineering conventions

- Use strict TypeScript. Narrow `unknown` at untrusted boundaries; do not use `any` to bypass a
  design problem. Type-only imports use `import type`, and relative TypeScript imports include `.js`
  for NodeNext ESM output.
- Keep I/O at the edges and transformations deterministic where practical. Prefer a small change in
  the owning module over a general abstraction created for one call site.
- Keep diagnostic codes stable and messages useful without copying untrusted source text. Model
  expected partial failures as diagnostics or coverage rather than a false clean result.
- For any new desktop action, update `DesktopApi`, preload, main-process validation, renderer, and
  tests together. The renderer must not receive general filesystem or shell authority.
- Preserve accessible labels, keyboard operation, loading/empty/error/partial states, and visible
  focus in the UI.
- Do not broaden scan roots, follow links, execute discovered code, or expose MCP secret values to
  make an implementation easier.

## Verification

```bash
npm test
npm run check
npm run build
```

Tests use temporary fake skill and MCP locations; they should not modify a developer's real ChatGPT
or Claude files. Add success, malformed-input, bounds, and safety-regression cases for new behavior.
For UI changes, launch `npm run desktop` and inspect affected states when a graphical environment is
available. CI runs the same checks on macOS and Ubuntu. The latter protects shared core portability,
not complete Windows/Linux desktop support.

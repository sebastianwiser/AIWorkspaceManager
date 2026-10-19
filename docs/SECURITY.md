# Security model

SkillManagerOS reads files supplied by other applications and by users. Those files are untrusted,
even when they live in a familiar skill or plugin directory. This document describes the current
controls and their limits; it is not a claim that a discovered item is safe.

## Trust boundaries

```text
Untrusted local definitions
  → bounded discovery and sanitized evidence (Node.js / Electron main)
  → typed inventory, audit report, and narrow preload bridge
  → React renderer (display and user intent only)

Explicitly selected local skill folder
  → import preview and revalidation (Electron main)
  → native confirmation → additive copy → verification → recoverable undo
```

The CLI and desktop share discovery, parsing, inventory, relationship, and audit logic. The desktop
renderer has no Node.js integration or general filesystem API. Its preload exposes only scan,
bounded skill-content preview, baseline reset, and action-specific import methods. The main process
checks the sending window and local main-frame URL for every request. The window denies new windows
and navigation.

## Read-only discovery

- Scan roots are supported application locations and registered project roots, not the entire home
  directory. Traversal has depth and exclusion rules; `.git`, `node_modules`, build output, and
  similar directories are skipped.
- Discovered scripts, plugin hooks, and MCP commands are never executed during scanning or audit.
  MCP servers are not started, contacted, or health-tested.
- Symbolic links are not followed by the scanner or bounded file reader. Files that cannot be safely
  inspected produce diagnostics or partial audit coverage rather than a clean verdict.
- Frontmatter parsing is bounded to 64 KB. Desktop skill-content previews are capped at 512 KB and
  render Markdown without raw HTML or remote images.
- MCP environment-variable and header **names** may be displayed to explain configuration, but their
  literal values are not exposed. URLs are sanitized, including credentials, paths, queries, and
  fragments. Unrecognized command arguments are hidden by default.

Discovery does not modify the items it finds. The separate Import view is the only supported write
path today.

## Static audit: useful signals, limited assurance

The audit checks structure, selected local references and executable paths, duplicate definitions,
file modes, plugin provenance, and static patterns that may indicate inline credentials, risky
commands, or broad access. It inspects bounded files within discovered skill and plugin bundles and
records their paths, sizes, and SHA-256 fingerprints. The bounded bundle walk is limited by entry
count, nesting depth, and total bytes; skipped or unreadable areas cause partial coverage.

Matched credential values and command text are discarded before findings reach the CLI or renderer.
Findings carry controlled categories and locations, not the matching line's contents. The checks can
miss malicious behavior and can flag examples or documentation as possible risks. They do not
analyze runtime permissions, execute code, establish provenance authenticity, perform antivirus
scanning, or certify a component.

The desktop file-change baseline helps reveal newly added, modified, or removed inspected files. An
incomplete scan does not assert removals. If the saved audit baseline is invalid or unreadable, the
app preserves it and reports that change tracking is unavailable rather than silently replacing it.
File hashes are not encrypted and can reveal equality or information about low-entropy inputs; do
not treat them as a substitute for secret handling.

## Local data and output

Desktop baselines live under Electron's local application-data directory. They contain inventory
metadata, paths, sizes, timestamps or hashes as applicable—not copied skill contents or matched
credential text. CLI JSON and desktop reports may include private local paths, configuration
**names**, and raw file hashes. Do not post them publicly without review. No scan results are sent
over the network by SkillManagerOS. Dependency installation and GitHub CI are separate developer
workflows that do use their respective networks.

## The one supported write action

Import is intentionally narrower than general package installation:

1. The user chooses a local folder in the native file picker and a global ChatGPT or Claude skills
   target. The folder needs a simple name and a top-level `SKILL.md`.
2. Planning rejects links and special files inside the selected folder, hidden or dependency paths,
   excessive depth, too many files, oversized files, and an existing destination. The current limits
   are 128 files, depth 6, 2 MB per file, and 8 MB total.
3. The preview shows the exact source and destination, file count, total size, and whether scripts
   are present. It expires after 10 minutes. A native confirmation is required to apply it.
4. Apply revalidates source file hashes and destination state, stages a private copy, verifies the
   stage, creates the destination exclusively, copies files without overwriting, and verifies the
   result. No imported script is run.
5. Before copying, a versioned local journal records the import intent. After verification, it
   records destination identity and file hashes. On startup and in the Import view, records are
   reconciled with current files; only unchanged completed imports can be undone across restarts.
   The journal is bounded, written through a private temporary file and rename, and rejects linked,
   malformed, or out-of-scope records rather than resetting them.
6. If a partial destination was created and an error occurs, the app tries to move it into a hidden
   recovery folder. Undo records its intended recovery path before moving an unchanged folder.
   Interrupted actions remain marked for manual review and are never automatically retried or
   deleted. Undo refuses to discard later edits.

Import is not a sandbox for the skill after another AI application uses it. A skill may contain
instructions or scripts that the target application later interprets or runs. Review the source
before importing. Archives, downloads, remote packages, overwrites, project installs, and plugin or
MCP modifications are outside this action.

Filesystem state can change concurrently. Identity and hash checks reduce time-of-check/time-of-use
risks, but this is not a hardened defense against a hostile process with write access to the same
directories. Importing from a folder controlled by an adversary, or into a directory an adversary
can mutate, is not recommended.

## Development and repository controls

Automated tests cover bounded reads, symlinks, redaction, incomplete scans, import drift,
overwrites, restart recovery, malformed history, and interruption. CI runs tests, type checks, lint,
formatting, and builds on macOS and Ubuntu. The Security workflow runs CodeQL and pull-request
dependency review; Dependabot proposes weekly npm and GitHub Action updates. These files do not
enable GitHub repository-level secret scanning or push protection; a repository administrator must
configure those separately.

If you find a vulnerability, do not include tokens, private configuration, or personal paths in a
public issue. Use GitHub's private vulnerability reporting if the repository has it enabled.

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
bounded skill-content preview, finding-ID-based instruction-line preview, baseline reset, and
action-specific import methods. The main process checks the sending window and local main-frame URL
for every request. The window denies new windows and navigation.

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

The AI-instruction review applies only to local Markdown and text files in discovered skill and
plugin bundles. It looks for combinations of an authority claim with an override instruction, an
action with a request to conceal it from the user, or private data with an outward transfer and
external destination. It returns controlled signal codes and approximate line locations, not matched
text or destination values. It reports the first location of each pattern type per file to limit
noise, not every matching phrase. A match is a **possible** risk: examples and safety guidance can
look similar, while subtle, encoded, or context-dependent attacks can be missed. This is not a
prompt-injection detector with guaranteed coverage and does not establish that data was accessed or
sent. Structured plugin prompts, project instruction files, live MCP descriptions/responses, and
external webpages or messages are not covered by this local rule set.

Matched credential values and command text are discarded before findings reach the CLI or renderer.
Findings carry controlled categories and locations, not the matching line's contents. The checks can
miss malicious behavior and can flag examples or documentation as possible risks. They do not
analyze runtime permissions, execute code, establish provenance authenticity, perform antivirus
scanning, or certify a component.

The desktop may reveal a cited AI-instruction line only after **Inspect line** is selected. The
request names an existing finding ID, not a path or arbitrary line. Main-process code checks that
the source is an audited skill/plugin Markdown or text file, reads it without following a final
symbolic link, bounds the read and excerpt, and verifies its SHA-256 fingerprint against the current
audit. Changed or unavailable files require a rescan. This explicit local preview can reveal
sensitive text to the person at the screen; it is never included in the scan report or CLI JSON.

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
3. The preview shows the exact source and destination, file count, total size, whether scripts are
   present, and controlled AI-instruction warnings for local Markdown/text files. It expires after
   10 minutes. A flagged preview requires an additional native review prompt before the normal
   import confirmation. The app does not silently block a user-approved, heuristically flagged
   skill; it can only gate its own import, not another AI application's later actions.
4. Apply revalidates source file hashes and destination state, stages a private copy, verifies the
   stage, creates the destination exclusively, copies files without overwriting, and verifies the
   result. No imported script is run.
5. Before copying, a versioned local journal records the import intent and a unique possible
   recovery path. After verification, it records destination identity and file hashes. On startup
   and in the Import view, records are reconciled with current files; only unchanged completed
   imports can be undone across restarts. The journal is bounded, written through a private
   temporary file and rename, and rejects linked, malformed, or out-of-scope records rather than
   resetting them.
6. If a partial destination was created and an error occurs, the app tries to move it into the
   recorded hidden recovery folder. Undo records its intended recovery path before moving an
   unchanged folder. Interrupted actions remain marked for manual review and are never automatically
   retried or deleted. Undo refuses to discard later edits.

The desktop holds Electron's single-instance lock so two app processes cannot independently write
the same import history. This is an application-level coordination measure, not a defense against
another process deliberately editing local files. Version-one journals are read without silently
discarding entries and upgraded when the next action is recorded.

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

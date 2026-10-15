# Audit and management architecture

Status: accepted for implementation planning, 2026-10-14. Pillars 3 and 4 are **not** shipped by
this decision.

## Context

The read-only inventory now discovers skills, MCP configuration, plugin bundles, project scope, and
their local relationships. An audit must be able to explain a finding without executing discovered
content. A management action will eventually change files owned by other applications, so an
inventory row or renderer click cannot be treated as permission to write.

## Decision

Use the existing scanner and `createRelationshipMap` as the local observed state. Keep three
separate stages with explicit data contracts:

```text
Supported local sources
  → bounded read-only scan + diagnostics
  → relationship projection (observed ownership and cross-app evidence)
  → pure audit rules → findings with evidence and uncertainty
  → pure management planner → preview with preconditions and recovery plan
  → trusted executor (Pillar 4 only, after separate approval)
  → rescan + verification + local activity record
```

The relationship projection is a **view of the current machine**, not a portable manifest and not
proof that a name-only match is equivalent. It retains the original application-specific records. An
MCP entry packaged in a plugin is not a configured connection unless application, scope, name, and
configuration file match an actual discovered MCP record. The scan never contacts a server.

### Pillar 3: audit contracts

Add `src/audit/` as the next implementation slice. Rules consume immutable scan/relationship
snapshots and return findings; they cannot read arbitrary files, run commands, or use network APIs.
If a rule needs more evidence, a separate bounded collector in the trusted scan layer must return
sanitized, typed observations first. The CLI and desktop must call the same rule engine.

A finding should have a stable rule ID, affected item identities, severity (`info`, `warning`, or
`critical`), confidence (`observed` or `possible`), a plain-language explanation, sanitized evidence
with source locations, and a suggested remedy. Do not emit secret values, raw MCP configuration, or
unbounded file contents. A failed/incomplete scan creates an explicit `unknown`/`not evaluated`
result for affected rules; absence of a finding is never proof of safety.

Initial rule families, in implementation order:

1. Structural: invalid metadata/manifests/configuration, broken references, missing executable or
   resource paths _without executing them_, and same-scope duplicates.
2. Exposure: apparent credentials in files or configuration, broad filesystem/network access, and
   sensitive environment variable or header **names**. Private values remain in the trusted scan
   process and are never persisted in findings.
3. Command risk: static parsing of MCP commands, plugin hooks, and installation instructions. It
   reports evidence and uncertainty; it does not run code or label an item safe merely because no
   known pattern was found.
4. Provenance/integrity: distinguish installed, cached, bundled, and unverified items; record
   source/version/hash when available. Policy and reputation checks are later explicit features.

Deduplicate equivalent findings by rule + exact affected record IDs, not display names. The UI
should let users move from a finding to its item, source, scope, and applicable uncertainty. Tests
need malformed and adversarial inputs, secret non-disclosure, symlink boundaries, incomplete scans,
and deterministic findings across CLI and desktop.

### Pillar 4: management contracts

Add `src/management/` only when the first narrowly scoped action is selected. Separate a pure
planner from the executor. A proposed plan contains: operation type and target identities; exact
allowed paths; expected current file fingerprints; intended diff/effects; conflicts and dependent
components; required approvals; backup location and retention; rollback steps; and post-apply
verification. Plans are ephemeral, machine-local, and must not be interpreted as portable recipes.

The trusted Electron main process or CLI process may execute a plan only after all of these gates:

1. The action is supported for the item's application, source, installation state, and ownership.
   Cached bundles are not assumed installed. Name-only cross-app candidates cannot authorize a
   multi-app action.
2. The user sees a complete human-readable preview and explicitly confirms the exact targets.
   Destructive or non-reversible effects require a stronger confirmation.
3. The executor re-reads and revalidates every target, verifies fingerprints/preconditions, rejects
   symlink/path substitutions and out-of-scope paths, and fails closed on drift.
4. A recoverable backup is made before mutation. Prefer atomic writes or moves within the same
   filesystem. If a multi-file operation partially fails, stop, report exactly what changed, and
   offer the documented rollback path.
5. Rescan and compare the observed result to the plan; record a sanitized local activity entry.
   Never declare success solely because a file write returned without error.

The renderer receives only plan previews and narrow action-specific bridge methods. It never
receives general filesystem-write authority. No background installation, update, or removal is
allowed. Remote downloads, shell execution, and network checks require separate feature designs and
visible user intent. Secrets are user-supplied at apply time, not copied into plans, backups,
exports, logs, or activity records by default.

## Delivery sequence and gates

1. **3A read-only structural audit:** shared finding schema, pure rules, per-scan completeness,
   CLI/desktop presentation, tests. No new filesystem or network reach.
2. **3B static security audit:** narrowly collected evidence for secrets, permissions, risky
   commands, and provenance. Rule-by-rule false-positive review and redaction tests.
3. **4A planning only:** choose one reversible operation (prefer enable/disable of a supported
   item), produce exact diffs and preconditions, and test plans without applying them.
4. **4B first executor:** trusted, single-action apply with confirmation, backup, drift rejection,
   rescan, and rollback tests. Ship only after fault-injection tests for partial failure.
5. **4C additional operations:** install/update/remove are separate action adapters with their own
   source validation, compatibility checks, and recovery tests. Portable workspace import/export
   remains a distinct later design.

MVP 2B live MCP status is still deferred. Its explicit, bounded start/contact behavior needs a
separate consent and timeout design; audit rules must not quietly introduce it.

## Rejected shortcuts

- Treating normalized names as ownership or equivalence.
- Using plugin bundle declarations as proof of configured/running MCP servers.
- Letting audit rules perform ad hoc reads or network checks.
- Letting the renderer pass arbitrary paths or commands to a generic write IPC.
- Implementing writes before a tested preview, backup, drift check, and verification flow exists.

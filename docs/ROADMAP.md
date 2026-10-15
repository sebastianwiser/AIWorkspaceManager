# Product direction and roadmap

## North star

SkillManagerOS aims to make a useful AI setup understandable, safe to maintain, and eventually
portable. The long-term unit is a **workspace**: a versioned combination of skills, plugins, MCP
connections, application/project instructions, dependencies, and configuration for a role or
workflow. A teammate should be able to inspect such a workspace, see what is shareable versus
machine-local, review risks and exact changes, then choose whether to adopt it.

That is the destination, not the current feature set. Today the project focuses on trustworthy local
discovery and one narrow, reversible write action. The [README](../README.md) is the quick source of
truth for what a user can run now.

## Product principles

1. **Local by default:** inventory and file contents stay on the machine unless a future feature
   explicitly describes and authorizes a network action.
2. **Explain conclusions:** identity, origin, installation evidence, scope, warnings, and
   uncertainty should remain visible. Similar names do not establish equivalence.
3. **Share recipes, not secrets:** a portable definition may name required credentials or accounts
   but must not contain their values by default.
4. **Read before write:** only well-understood targets get management actions, with preview,
   confirmation, drift checks, and recovery.
5. **One model, multiple interfaces:** desktop and CLI use the same discovery and audit behavior.
6. **Preserve ownership:** a workspace must not make bundled or third-party code look internally
   authored or automatically trusted.

## Shipped milestones

| Milestone            | Current scope                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MVP 1A–1D            | Local and known-project skill discovery, safe metadata parsing, search/filtering, cross-app variants and diff, desktop inventory, and skill change detection. |
| MVP 2A               | Read-only local MCP configuration discovery, sanitized display, validation, and filtering.                                                                    |
| MVP 2C               | Plugin inventory with manifest provenance, installation-evidence labels, and packaged components.                                                             |
| MVP 2D               | Read-only application/project/plugin/skill/MCP relationships with evidence-aware cross-app links.                                                             |
| Pillar 3A–3B         | Shared structural and static security audit, controlled findings, and partial/not-evaluated coverage.                                                         |
| Security gate        | Desktop request validation, bounded bundle inspection, local file-change fingerprints, tests, and GitHub security workflow.                                   |
| Pillar 4 first slice | Additive local skill-folder import with preview, native confirmation, staged verification, and same-session recovery-based undo.                              |

MVP 2B (live MCP status) was deferred because it would start or contact a server. Audit remains
static and does not quietly introduce this behavior.

## Next delivery slices

These are dependency-ordered candidates, not promised release dates. Each needs its own design and
tests before being called shipped.

1. **Harden the first import in real use.** Improve diagnostics and recovery guidance, exercise more
   fault-injection and concurrency cases, and validate behavior across supported macOS setups. Keep
   folder import additive while it is being proven.
2. **Extend source and action support deliberately.** Archive import, project-local targets,
   updates, disable/remove, and plugin/MCP management each need separate source validation,
   previews, compatibility checks, and recovery plans. Remote downloads and command execution need
   explicit consent and their own threat model.
3. **Add opt-in MCP health checks (MVP 2B).** A bounded, user-triggered status check must make
   process starts or network contact visible and controlled by timeouts. It must not be part of a
   read-only inventory scan.
4. **Model a portable workspace.** Define a versioned manifest that separates shareable intent from
   personal paths, tokens, and machine-specific state. Show dependencies, provenance, compatibility,
   conflicts, and a human-readable bill of materials before any apply action.
5. **Share and adopt safely.** Export a sanitized definition, map it onto a receiving machine,
   preview exact changes, and apply only after confirmation with rollback and an activity record.
   Team review and policy can build on that model later.

## Explicitly out of scope today

- Cloud-managed connection discovery or automatic network checks.
- A marketplace, hosted registry, team policy engine, or cloud sync.
- Full malware detection or a guarantee that static audit findings are exhaustive.
- Silent repair, background installation, or automatic execution of setup scripts.
- Exporting credentials, tokens, private project contents, or personal paths by default.
- Signed desktop installers and tested Windows/Linux default location providers.

The [usage guide](USAGE.md) covers the shipped behavior; the [security model](SECURITY.md) explains
its limits; and the [architecture guide](ARCHITECTURE.md) shows how to extend it without weakening
the current boundaries.

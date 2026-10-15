# Contributing

Thanks for helping improve SkillManagerOS. The project is early and safety-sensitive: it reads
configuration and code supplied by other applications, and its one write action targets a real
skills directory. Please keep changes narrow, documented, and testable.

## Before changing code

1. Read the [roadmap](docs/ROADMAP.md) for shipped versus planned scope.
2. Read the [architecture guide](docs/ARCHITECTURE.md) and [security model](docs/SECURITY.md).
3. Check the [usage guide](docs/USAGE.md) for the current user-facing contract.
4. Inspect the owning source module and its tests. Do not infer implementation from a feature name.

## Development workflow

```bash
npm ci
npm test
npm run check
npm run build
```

Tests use temporary fixtures; do not write to a contributor's real ChatGPT, Codex, or Claude
locations. Add focused tests for success, malformed input, size or path boundaries, and relevant
failure/recovery cases. For desktop UI changes, inspect the affected states with `npm run desktop`
on macOS when a graphical environment is available.

Keep discovery read-only. Never execute discovered scripts, commands, hooks, or MCP servers as part
of a scan or audit. Treat paths, metadata, Markdown, and configuration as untrusted input; preserve
bounded reads and redaction. New management operations need an independently reviewed preview,
confirmation, drift check, and recovery plan. Do not broaden the existing folder-only import into an
archive, download, overwrite, or general filesystem action without a separate design.

## Pull-request checklist

- Explain the user-visible behavior and any tradeoffs or unsupported cases.
- Include tests and report `npm test`, `npm run check`, and `npm run build` results.
- Update the README or relevant docs when behavior, scope, CLI flags, paths, or trust boundaries
  change. Keep planned behavior clearly separate from shipped behavior.
- Exclude generated `dist/`, local baselines, tokens, private configuration, and real user data.
- Keep dependencies lean and explain why a new one is necessary.

For architecture-level decisions, add a short note under
[docs/decisions](docs/decisions/0001-audit-and-management-architecture.md). If reporting a security
issue, follow the private-reporting guidance in the [security model](docs/SECURITY.md).

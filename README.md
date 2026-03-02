# trading-cli

External CLI client for Trade Nexus v2.

## Scope

- Consumes Platform API only.
- Enforces no direct provider API usage.
- Uses generated SDK for validation run workflows and bot identity/registration flows.
- Uses Path A contract-first reconciliation for validation/shared flows:
  - keep CLI operations that are present in the authoritative OpenAPI contract
  - regenerate SDK + operationId manifest from the authoritative contract source
- Keeps command output automation-friendly.
- Supports bot self-registration:
  - invite-code trial path
  - partner key/secret bootstrap path
- Supports bot key rotate/revoke lifecycle commands.

## Quick start

```bash
bun install
bun run build
bun test
```

Consumer-driven mock contract suite (Prism/OpenAPI-backed):

```bash
bun run test:consumer:mock
```

Sync vendored SDK from canonical OpenAPI and verify drift:

```bash
bun run sdk:generate
bun run sdk:drift
```

Authoritative spec resolution rule (used by both local scripts and CI):
- Resolve contract content from git object `<spec-repo>@origin/main:<spec-relative-path>`.
- `--spec <path>` is used only to identify repository + relative path.
- Working-tree edits at that path are ignored for generation/drift checks.

Default spec path anchor:
`/Users/txena/sandbox/16.enjoy/trading/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml`

Override path anchor explicitly when needed (same revision rule still applies):

```bash
bun run sdk:drift --spec /absolute/path/to/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml
```

Override revision explicitly when needed:

```bash
bun run sdk:drift --spec /absolute/path/to/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml --revision origin/main
```

Note: SDK sync updates generated API/model files from the authoritative contract source, removes stale generated files, and preserves local barrel exports (`index.ts`, `apis/index.ts`, `models/index.ts`) used by current CLI integration.

## Review Run Commands

```bash
trading-cli review-run trigger --help
trading-cli review-run retrieve --help
trading-cli review-run render --help
trading-cli validation run trigger --help
```

## Bot Registration Commands

```bash
trading-cli register invite --help
trading-cli register partner --help
trading-cli key rotate --help
trading-cli key revoke --help
```

## Governance docs

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `AGENTS.md`
- `COMMAND_REFERENCE.md`
- `CONFIGURATION.md`
- `RELEASE_PROCESS.md`

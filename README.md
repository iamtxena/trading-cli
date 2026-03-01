# trading-cli

External CLI client for Trade Nexus v2.

## Scope

- Consumes Platform API only.
- Enforces no direct provider API usage.
- Uses generated SDK for validation run workflows and bot identity/registration flows.
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

Authoritative contract source used by default:
`/Users/txena/sandbox/16.enjoy/trading/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml`

Override source explicitly when needed (for CI or alternate local checkout):

```bash
bun run sdk:drift --spec /absolute/path/to/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml
```

Note: SDK sync updates generated API/model files from the authoritative contract source and preserves local barrel exports (`index.ts`, `apis/index.ts`, `models/index.ts`) used by current CLI integration.

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

# trading-cli

External CLI client for Trade Nexus v2.

## Scope

- Consumes Platform API only.
- Enforces no direct provider API usage.
- Uses generated SDK from the authoritative Platform API OpenAPI contract.
- Keeps command output automation-friendly.
- Contract-backed command groups:
  - core (`research`, `strategy`, `backtest`, `deploy`, `portfolio`, `order`)
  - dataset (`dataset ...`)
  - conversation (`conversation ...`)

## Contract reconciliation status

- Explicit path selected: **B (de-scope CLI commands not covered by authoritative contract)**.
- De-scoped command groups:
  - `review-run` / `validation run`
  - `register` / `key` / `bot`
  - `shared-validation` / `invite`
- Operation parity is enforced by `tests/contract/cli-operation-parity.test.ts`.

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

Note: SDK sync now performs delete-aware reconciliation, so stale generated APIs/models are removed during regeneration.

## Command groups

```bash
trading-cli research scan --help
trading-cli strategy --help
trading-cli backtest --help
trading-cli deploy --help
trading-cli portfolio --help
trading-cli order --help
trading-cli dataset --help
trading-cli conversation --help
```

## Governance docs

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `AGENTS.md`
- `COMMAND_REFERENCE.md`
- `CONFIGURATION.md`
- `RELEASE_PROCESS.md`

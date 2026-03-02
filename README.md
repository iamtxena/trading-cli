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
- Supports human CLI device auth (`auth login`, `auth whoami`, `auth logout`) with secure token storage.

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
trading-cli review-run list --help
trading-cli review-run render --help
trading-cli review-run review --help
trading-cli review-run review-comment --help
trading-cli review-run review-decision --help
trading-cli review-run baseline --help
trading-cli review-run replay --help
trading-cli validation run trigger --help
trading-cli validation run list --help
```

## Bot Registration Commands

```bash
trading-cli bot list --help
trading-cli register invite --help
trading-cli register partner --help
trading-cli key rotate --help
trading-cli key revoke --help
```

## Human Auth Commands

```bash
trading-cli auth login --help
trading-cli auth whoami --help
trading-cli auth logout --help
```

## Core/Data Commands

```bash
trading-cli health get --help
trading-cli knowledge search --help
trading-cli knowledge patterns --help
trading-cli knowledge regime --help
trading-cli backtest export --help
trading-cli dataset quality-report --help
```

Examples:

```bash
trading-cli health get

trading-cli knowledge search --query "momentum breakout" --assets btc,eth --limit 10

trading-cli knowledge patterns --type momentum --asset btc --limit 20

trading-cli knowledge regime --asset btc

trading-cli backtest export create --dataset-ids dataset-btc-1h-2025 --asset-classes crypto

trading-cli backtest export get --export-id export-001

trading-cli dataset quality-report --dataset-id dataset-btc-1h-2025
```

## Workflow playbooks

### 1. Strategy lifecycle (scan -> create -> backtest -> deploy paper/live)

```bash
# 1) Scan market context and ideas
trading-cli research scan \
  --asset-classes crypto,stocks \
  --capital 50000 \
  --version v2 \
  --output table

# 2) Create strategy
trading-cli strategy create \
  --name "BTC Breakout v1" \
  --description "1h breakout with trend confirmation"

# 3) Backtest
STRATEGY_ID="strat-001" # replace with your strategy id
trading-cli backtest create \
  --strategy-id "$STRATEGY_ID" \
  --start-date 2025-01-01 \
  --end-date 2025-03-01 \
  --dataset-ids dataset-btc-1h-2025 \
  --initial-cash 10000

BACKTEST_ID="backtest-001" # replace with your backtest id
trading-cli backtest get --backtest-id "$BACKTEST_ID" --output table

# 4) Deploy paper first, then live
trading-cli deploy create --strategy-id "$STRATEGY_ID" --mode paper --capital 10000
trading-cli deploy create --strategy-id "$STRATEGY_ID" --mode live --capital 10000
```

### 2. Validation lifecycle (trigger -> review -> verdict -> render)

```bash
# 1) Trigger validation run
trading-cli review-run trigger \
  --strategy-id strat-001 \
  --requested-indicators ema,zigzag \
  --dataset-ids dataset-btc-1h-2025 \
  --backtest-report-ref blob://validation/candidate/backtest.json

RUN_ID="valrun-20260220-0001" # replace with returned run id

# 2) Review summary + raw artifact state
trading-cli review-run retrieve --run-id "$RUN_ID" --raw

# 3) Record review verdict (for reviewers with shared review permission)
trading-cli shared-validation review-comment \
  --run-id "$RUN_ID" \
  --body "Risk checks complete. Ready for verdict."

trading-cli shared-validation review-decision \
  --run-id "$RUN_ID" \
  --action approve \
  --decision conditional_pass \
  --reason "Meets guardrails with minor follow-up."

# 4) Render final review artifact and check status
trading-cli review-run render --run-id "$RUN_ID" --format pdf
trading-cli review-run retrieve --run-id "$RUN_ID" --render-format pdf
```

### 3. Shared review lifecycle (invite -> shared-with-me -> comment/decision)

```bash
# Owner invites reviewer
RUN_ID="run-001"
trading-cli invite create \
  --run-id "$RUN_ID" \
  --email reviewer@example.com \
  --permission review \
  --message "Please review today."

# Reviewer accepts invite
INVITE_ID="invite-001"
trading-cli invite accept \
  --invite-id "$INVITE_ID" \
  --accepted-email reviewer@example.com

# Reviewer lists runs shared with them
trading-cli shared-validation shared-with-me \
  --permission review \
  --status completed \
  --output table

# Reviewer leaves comment and decision
trading-cli shared-validation review-comment \
  --run-id "$RUN_ID" \
  --body "LGTM after evidence review."

trading-cli shared-validation review-decision \
  --run-id "$RUN_ID" \
  --action approve \
  --decision pass \
  --reason "All required checks passed."
```

## Governance docs

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `AGENTS.md`
- `COMMAND_REFERENCE.md`
- `AUTHENTICATION.md`
- `CONFIGURATION.md`
- `RELEASE_PROCESS.md`

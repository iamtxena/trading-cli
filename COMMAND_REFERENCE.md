# Command Reference

Complete end-user guide for `trading-cli`.

## Quick Start

```bash
bun install
bun run build
```

Set runtime environment (required for non-registration commands):

```bash
export PLATFORM_API_BASE_URL="https://api-nexus.lona.agency"
export PLATFORM_API_BEARER_TOKEN="<token>"
# Optional fallback auth:
# export PLATFORM_API_KEY="<api-key>"
```

Notes:
- `PLATFORM_API_BASE_URL` must point to `api-nexus.lona.agency` (or local loopback hosts like `http://localhost:3000`).
- Provider hosts are blocked by CLI boundary checks.
- `register invite` and `register partner` can run without an auth token.

## Global Conventions

- `--request-id <id>`: optional on most commands. If omitted, CLI generates one.
- `--idempotency-key <key>`: optional on mutation commands that support dedupe. If omitted, CLI generates one.
- `--output json|table`: supported by core, dataset, shared-validation, invite, and conversation commands. Default is `json`.
- `--input <file.json>`: where supported, provides full request payload from JSON file.
- CSV flags accept comma-separated values without spaces (example: `ema,zigzag,rsi`).

## Command Groups

### research

#### `research scan`
Discover regimes and strategy ideas.

Usage:
```bash
trading-cli research scan --asset-classes <csv> --capital <number> [--constraints-json <json>] [--version v1|v2] [--request-id <id>] [--output json|table]
trading-cli research scan --input <market-scan.json> [--version v1|v2] [--request-id <id>] [--output json|table]
```

Options:
- `--input <file>`: full `MarketScanRequest` payload.
- `--asset-classes <csv>`: required when `--input` is not used.
- `--capital <number>`: required when `--input` is not used.
- `--constraints-json <json-object>`: optional constraints object.
- `--version <v1|v2>`: defaults to `v2`.

Example:
```bash
trading-cli research scan \
  --asset-classes crypto,stocks \
  --capital 50000 \
  --constraints-json '{"maxDrawdownPct":8}' \
  --version v2 \
  --output table
```

### strategy

#### `strategy create`
```bash
trading-cli strategy create --description "Momentum breakout" [--name <name>] [--provider <provider>] [--request-id <id>] [--output json|table]
trading-cli strategy create --input <create-strategy.json> [--request-id <id>] [--output json|table]
```

Required when no `--input`:
- `--description <text>`

#### `strategy get`
```bash
trading-cli strategy get --strategy-id <id> [--request-id <id>] [--output json|table]
```

#### `strategy list`
```bash
trading-cli strategy list [--status draft|testing|tested|deployable|archived|failed] [--cursor <token>] [--request-id <id>] [--output json|table]
```

#### `strategy update`
```bash
trading-cli strategy update --strategy-id <id> [--name <name>] [--description <text>] [--status draft|testing|tested|deployable|archived|failed] [--tags <csv>] [--request-id <id>] [--output json|table]
trading-cli strategy update --strategy-id <id> --input <update-strategy.json> [--request-id <id>] [--output json|table]
```

At least one of `--name`, `--description`, `--status`, `--tags`, or `--input` is required.

Example:
```bash
trading-cli strategy create \
  --name "BTC Breakout v1" \
  --description "1h breakout with volatility filter" \
  --provider lona
```

### backtest

#### `backtest create`
```bash
trading-cli backtest create --strategy-id <id> --start-date <iso-date> --end-date <iso-date> [--dataset-ids <csv>] [--data-ids <csv>] [--initial-cash <number>] [--request-id <id>] [--output json|table]
trading-cli backtest create --strategy-id <id> --input <create-backtest.json> [--request-id <id>] [--output json|table]
```

#### `backtest get`
```bash
trading-cli backtest get --backtest-id <id> [--request-id <id>] [--output json|table]
```

Example:
```bash
trading-cli backtest create \
  --strategy-id strat-001 \
  --start-date 2025-01-01 \
  --end-date 2025-03-01 \
  --dataset-ids dataset-btc-1h-2025 \
  --initial-cash 10000
```

### deploy

#### `deploy create`
```bash
trading-cli deploy create --strategy-id <id> --mode paper|live --capital <number> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
trading-cli deploy create --input <create-deployment.json> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
```

#### `deploy get`
```bash
trading-cli deploy get --deployment-id <id> [--request-id <id>] [--output json|table]
```

#### `deploy list`
```bash
trading-cli deploy list [--status queued|running|paused|stopping|stopped|failed] [--cursor <token>] [--request-id <id>] [--output json|table]
```

#### `deploy stop`
```bash
trading-cli deploy stop --deployment-id <id> [--reason <text>] [--request-id <id>] [--output json|table]
```

Example:
```bash
trading-cli deploy create \
  --strategy-id strat-001 \
  --mode paper \
  --capital 15000 \
  --idempotency-key idem-core-deploy-001
```

### portfolio

#### `portfolio list`
```bash
trading-cli portfolio list [--request-id <id>] [--output json|table]
```

#### `portfolio get`
```bash
trading-cli portfolio get --portfolio-id <id> [--request-id <id>] [--output json|table]
```

### order

#### `order create`
`order create` currently requires `--input`.

```bash
trading-cli order create --input <create-order.json> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
```

#### `order get`
```bash
trading-cli order get --order-id <id> [--request-id <id>] [--output json|table]
```

#### `order list`
```bash
trading-cli order list [--status pending|filled|cancelled|failed] [--cursor <token>] [--request-id <id>] [--output json|table]
```

#### `order cancel`
```bash
trading-cli order cancel --order-id <id> [--request-id <id>] [--output json|table]
```

Example (`order create` payload):
```bash
cat > /tmp/create-order.json <<'JSON'
{
  "symbol": "BTCUSDT",
  "side": "buy",
  "type": "market",
  "quantity": 0.1
}
JSON

trading-cli order create --input /tmp/create-order.json
```

### dataset

Lifecycle group for upload, validation, transform, publish, and status.

#### `dataset upload init`
```bash
trading-cli dataset upload init --filename <file> --content-type <mime> --size-bytes <bytes> [--request-id <id>] [--output json|table]
trading-cli dataset upload init --input <init-upload.json> [--request-id <id>] [--output json|table]
```

#### `dataset upload complete`
```bash
trading-cli dataset upload complete --dataset-id <id> [--upload-token <token>] [--request-id <id>] [--output json|table]
trading-cli dataset upload complete --dataset-id <id> --input <complete-upload.json> [--request-id <id>] [--output json|table]
```

#### `dataset validate`
```bash
trading-cli dataset validate --dataset-id <id> [--column-mapping-json '{"timestamp":"ts"}'] [--request-id <id>] [--output json|table]
trading-cli dataset validate --dataset-id <id> --input <validate.json> [--request-id <id>] [--output json|table]
```

#### `dataset transform`
```bash
trading-cli dataset transform --dataset-id <id> --frequency <value> [--request-id <id>] [--output json|table]
trading-cli dataset transform --dataset-id <id> --input <transform.json> [--request-id <id>] [--output json|table]
```

#### `dataset publish`
```bash
trading-cli dataset publish --dataset-id <id> [--mode explicit|just_in_time] [--request-id <id>] [--output json|table]
trading-cli dataset publish --dataset-id <id> --input <publish.json> [--request-id <id>] [--output json|table]
```

#### `dataset get`
```bash
trading-cli dataset get --dataset-id <id> [--request-id <id>] [--output json|table]
```

#### `dataset status`
```bash
trading-cli dataset status --dataset-id <id> [--request-id <id>] [--output json|table]
```

#### `dataset list`
```bash
trading-cli dataset list [--cursor <token>] [--request-id <id>] [--output json|table]
```

Aliases:
- `trading-cli dataset init ...` is alias for `dataset upload init`.
- `trading-cli dataset complete ...` is alias for `dataset upload complete`.

Example:
```bash
trading-cli dataset upload init \
  --filename btc-1h.csv \
  --content-type text/csv \
  --size-bytes 1024

trading-cli dataset upload complete --dataset-id dataset-001 --upload-token upload-token-001
trading-cli dataset validate --dataset-id dataset-001 --column-mapping-json '{"timestamp":"ts"}'
trading-cli dataset transform --dataset-id dataset-001 --frequency 1h
trading-cli dataset publish --dataset-id dataset-001 --mode explicit
trading-cli dataset status --dataset-id dataset-001
```

### validation / review-run

`review-run` is the canonical validation run surface.

Alias:
- `trading-cli validation run <...>` routes to the same handlers.
- `review-run get` is alias for `review-run retrieve`.

#### `review-run trigger`
```bash
trading-cli review-run trigger --strategy-id <id> --requested-indicators <csv> --dataset-ids <csv> --backtest-report-ref <ref> [--provider-ref-id <id>] [--prompt <text>] [--profile FAST|STANDARD|EXPERT] [--render html,pdf] [--request-id <id>] [--idempotency-key <key>]
trading-cli review-run trigger --input <create-validation-run.json> [--render html,pdf] [--request-id <id>] [--idempotency-key <key>]
```

When not using `--input`, required flags are:
- `--strategy-id`
- `--requested-indicators`
- `--dataset-ids`
- `--backtest-report-ref`

#### `review-run retrieve`
```bash
trading-cli review-run retrieve --run-id <id> [--render-format html|pdf] [--raw] [--request-id <id>]
trading-cli review-run retrieve [--status queued|running|completed|failed] [--final-decision pending|pass|conditional_pass|fail] [--cursor <token>] [--limit 1..100] [--request-id <id>]
```

#### `review-run render`
```bash
trading-cli review-run render --run-id <id> --format html|pdf [--request-id <id>] [--idempotency-key <key>]
```

Example:
```bash
trading-cli review-run trigger \
  --strategy-id strat-001 \
  --requested-indicators ema,zigzag \
  --dataset-ids dataset-btc-1h-2025 \
  --backtest-report-ref blob://validation/candidate/backtest.json \
  --render html

trading-cli review-run retrieve --run-id valrun-20260220-0001 --render-format html
trading-cli review-run render --run-id valrun-20260220-0001 --format pdf
```

### bot / register / key

Bot bootstrap and key lifecycle.

Aliases:
- `trading-cli bot register ...` maps to `trading-cli register ...`.
- `trading-cli bot key ...` maps to `trading-cli key ...`.
- `register invite-code` is accepted as alias of `register invite`.

#### `register invite`
```bash
trading-cli register invite --invite-code <code> --bot-name <name> [--metadata-json <json>] [--metadata-file <file>] [--request-id <id>] [--idempotency-key <key>]
trading-cli register invite --input <register-invite.json> [--request-id <id>] [--idempotency-key <key>]
```

#### `register partner`
```bash
trading-cli register partner --partner-key <key> --partner-secret <secret> --owner-email <email> --bot-name <name> [--metadata-json <json>] [--metadata-file <file>] [--request-id <id>] [--idempotency-key <key>]
trading-cli register partner --input <register-partner.json> [--request-id <id>] [--idempotency-key <key>]
```

#### `key rotate`
```bash
trading-cli key rotate --bot-id <id> [--reason <text>] [--request-id <id>] [--idempotency-key <key>]
```

#### `key revoke`
```bash
trading-cli key revoke --bot-id <id> --key-id <id> [--reason <text>] [--request-id <id>] [--idempotency-key <key>]
```

Example:
```bash
trading-cli register invite --invite-code INVITE-TEAM-D-001 --bot-name wave-invite-bot
trading-cli key rotate --bot-id bot-001 --reason "routine rotation"
trading-cli key revoke --bot-id bot-001 --key-id key-001 --reason "compromised"
```

### shared-validation

Review surface for runs shared with you.

Aliases:
- `shared-validation list` -> `shared-validation shared-with-me`
- `shared-validation comment` -> `shared-validation review-comment`
- `shared-validation decision` -> `shared-validation review-decision`

#### `shared-validation shared-with-me`
```bash
trading-cli shared-validation shared-with-me [--status queued|running|completed|failed] [--final-decision pass|conditional_pass|fail] [--permission view|review] [--cursor <token>] [--limit 1..100] [--request-id <id>] [--output json|table]
```

#### `shared-validation run`
```bash
trading-cli shared-validation run --run-id <id> [--request-id <id>] [--output json|table]
```

#### `shared-validation artifact`
```bash
trading-cli shared-validation artifact --run-id <id> [--request-id <id>] [--output json|table]
```

#### `shared-validation review-comment`
```bash
trading-cli shared-validation review-comment --run-id <id> --body <text> [--evidence-refs <csv>] [--request-id <id>] [--idempotency-key <key>] [--output json|table]
trading-cli shared-validation review-comment --run-id <id> --input <review-comment.json> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
```

#### `shared-validation review-decision`
```bash
trading-cli shared-validation review-decision --run-id <id> --action approve|reject --decision pass|conditional_pass|fail --reason <text> [--evidence-refs <csv>] [--request-id <id>] [--idempotency-key <key>] [--output json|table]
trading-cli shared-validation review-decision --run-id <id> --input <review-decision.json> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
```

Example:
```bash
trading-cli shared-validation shared-with-me --permission review --status completed --output table
trading-cli shared-validation review-comment --run-id run-001 --body "Looks good"
trading-cli shared-validation review-decision --run-id run-001 --action approve --decision pass --reason "All checks pass"
```

### invite

Manage review sharing invites.

#### `invite create`
```bash
trading-cli invite create --run-id <id> --email <email> [--permission view|review] [--message <text>] [--expires-at <iso-timestamp>] [--request-id <id>] [--idempotency-key <key>] [--output json|table]
trading-cli invite create --run-id <id> --input <invite-create.json> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
```

#### `invite list`
```bash
trading-cli invite list --run-id <id> [--cursor <token>] [--limit 1..100] [--request-id <id>] [--output json|table]
```

#### `invite accept`
```bash
trading-cli invite accept --invite-id <id> --accepted-email <email> [--login-session-id <id>] [--request-id <id>] [--idempotency-key <key>] [--output json|table]
trading-cli invite accept --invite-id <id> --input <invite-accept.json> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
```

#### `invite revoke`
```bash
trading-cli invite revoke --invite-id <id> [--request-id <id>] [--idempotency-key <key>] [--output json|table]
```

Example:
```bash
trading-cli invite create --run-id run-001 --email reviewer@example.com --permission review
trading-cli invite list --run-id run-001 --limit 20
trading-cli invite accept --invite-id invite-001 --accepted-email reviewer@example.com
trading-cli invite revoke --invite-id invite-001
```

### conversation

Conversation sessions and turns.

Alias:
- `trading-cli conversations ...` routes to `conversation ...`.

#### `conversation session create`
```bash
trading-cli conversation session create --channel cli|web|openclaw [--topic <text>] [--metadata-json '{"key":"value"}'] [--request-id <id>] [--output json|table]
trading-cli conversation session create --input <session-create.json> [--request-id <id>] [--output json|table]
```

#### `conversation session get`
```bash
trading-cli conversation session get --session-id <id> [--request-id <id>] [--output json|table]
```

#### `conversation turn create`
```bash
trading-cli conversation turn create --session-id <id> --role user|assistant|system --message <text> [--metadata-json '{"key":"value"}'] [--request-id <id>] [--output json|table]
trading-cli conversation turn create --session-id <id> --input <turn-create.json> [--request-id <id>] [--output json|table]
```

Example:
```bash
trading-cli conversation session create --channel cli --topic "phase2"
trading-cli conversation session get --session-id session-001
trading-cli conversation turn create --session-id session-001 --role user --message "hello"
```

## After CLI-A: knowledge / data-export

The generated SDK already contains `KnowledgeApi` and `DataApi` operations, but this CLI build does not expose command groups for them yet.

Current behavior:
```bash
trading-cli knowledge
trading-cli data-export
# Both currently fail with: Unknown command ...
```

Interim guidance:
- Use `research scan --version v2` for embedded `knowledgeEvidence` in scan output.
- Use existing `backtest get` / `review-run retrieve --raw` artifacts until `data-export` commands are added.

## Output and Errors

- Success responses are machine-readable JSON (or table text when `--output table` is supported).
- Failures emit structured JSON error envelopes to stderr.
- Registration and key rotation responses include raw keys one time only; store immediately.

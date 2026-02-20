# Command Reference

## Review Run Commands

1. `trading-cli review-run trigger`
   - Starts a validation review run through `POST /v2/validation-runs` using the generated SDK.
   - Returns stable identifiers and review-web URLs:
     - `runId`
     - `reviewWeb.path`
     - `reviewWeb.url`
   - Optional render trigger: `--render html,pdf`.

2. `trading-cli review-run retrieve`
   - Retrieves review run data from the review API lane via generated SDK.
   - Modes:
     - `--run-id <id>`: run summary + optional render status.
     - no `--run-id`: list review runs with filters.

## Examples

```bash
trading-cli review-run trigger \
  --strategy-id strat-001 \
  --requested-indicators ema,zigzag \
  --dataset-ids dataset-btc-1h-2025 \
  --backtest-report-ref blob://validation/candidate/backtest.json \
  --render html

trading-cli review-run retrieve --run-id valrun-20260220-0001 --render-format html

trading-cli review-run retrieve --status completed --final-decision conditional_pass --limit 25
```

## Output Policy

- JSON output is canonical for automation and cross-tool integration.
- Errors are emitted as structured JSON objects with HTTP/request metadata when available.

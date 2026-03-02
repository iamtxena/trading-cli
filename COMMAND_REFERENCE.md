# Command Reference

## Validation Run Commands

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

3. `trading-cli review-run render`
   - Triggers optional HTML/PDF derived output from canonical validation JSON.
   - Route: `POST /v2/validation-runs/{runId}/render`.

4. `trading-cli validation run <trigger|retrieve|render>`
   - Alias surface for the same review-run workflow.
   - Kept for compatibility with validation-oriented command naming.

## Bot Registration + Key Lifecycle

1. `trading-cli register invite`
   - Self-registers bot through invite-code trial flow.
   - Route: `POST /v2/validation-bots/registrations/invite-code`.
   - Required flags (unless `--input` is used): `--invite-code`, `--bot-name`.

2. `trading-cli register partner`
   - Self-registers bot through partner key/secret bootstrap flow.
   - Route: `POST /v2/validation-bots/registrations/partner-bootstrap`.
   - Required flags (unless `--input` is used): `--partner-key`, `--partner-secret`, `--owner-email`, `--bot-name`.

3. `trading-cli key rotate`
   - Rotates bot API key and returns raw key once.
   - Route: `POST /v2/validation-bots/{botId}/keys/rotate`.

4. `trading-cli key revoke`
   - Revokes bot API key metadata (raw key is never returned).
   - Route: `POST /v2/validation-bots/{botId}/keys/{keyId}/revoke`.

5. `trading-cli bot <register|key> ...`
   - Alias surface for `register` and `key` commands.

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

trading-cli review-run render --run-id valrun-20260220-0001 --format pdf

trading-cli register invite --invite-code INVITE-123 --bot-name team-d-trial

trading-cli register partner \
  --partner-key partner-key-001 \
  --partner-secret partner-secret-001 \
  --owner-email team-d@example.com \
  --bot-name team-d-prod

trading-cli key rotate --bot-id bot-001 --reason "routine rotation"

trading-cli key revoke --bot-id bot-001 --key-id key-001 --reason "compromised"
```

## Output Policy

- JSON output is canonical for automation and cross-tool integration.
- Errors are emitted as structured JSON objects with HTTP/request metadata when available.
- Issued raw API keys are shown once only on registration/rotation responses. Store securely immediately.

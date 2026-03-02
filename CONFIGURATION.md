# Configuration

## Environment variables

1. `PLATFORM_API_BASE_URL` (required in non-local environments)
   - Must be an absolute `http(s)` URL.
   - Must target Trade Nexus Platform API.
   - Provider hosts (Lona/live-engine/exchange APIs) are rejected by boundary checks.

2. `PLATFORM_API_BEARER_TOKEN` (preferred auth)
   - Bearer token forwarded by generated SDK as `Authorization: Bearer <token>`.

3. `PLATFORM_API_TOKEN` (fallback auth alias)
   - Alternate bearer token variable if `PLATFORM_API_BEARER_TOKEN` is not set.

4. `PLATFORM_API_KEY` (optional auth)
   - API key forwarded by generated SDK as `X-API-Key`.
   - Used by authenticated operations such as review runs and bot key rotate/revoke.

5. `REVIEW_WEB_BASE_URL` (optional)
   - Base URL used to build stable review-open links in CLI output.
   - Default: `https://trade-nexus.lona.agency`.

## Defaults

- Local Platform API default: `http://localhost:3000`
- Review web default: `https://trade-nexus.lona.agency`

## Command Inputs and Secret Handling

1. Registration commands support direct flags or JSON payloads:
   - `--input <file.json>` for full request payloads.
   - `--metadata-json <json>` or `--metadata-file <file.json>` for metadata objects.

2. `register partner` requires `--partner-secret` in payload/flags.
   - Partner secret is sent to Platform API only.
   - CLI never echoes partner secret in output.

3. API keys returned by `register ...` and `key rotate` are emitted once in JSON response.
   - Store immediately; raw key is not retrievable afterwards.

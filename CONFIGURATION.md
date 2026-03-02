# Configuration

## Environment variables

1. `PLATFORM_API_BASE_URL` (required in non-local environments)
   - Must be an absolute `http(s)` URL.
   - Must target Trade Nexus Platform API.
   - Provider hosts (Lona/live-engine/exchange APIs) are rejected by boundary checks.

2. `PLATFORM_API_BEARER_TOKEN` (preferred explicit auth override)
   - Bearer token forwarded by generated SDK as `Authorization: Bearer <token>`.

3. `PLATFORM_API_TOKEN` (fallback auth alias)
   - Alternate bearer token variable if `PLATFORM_API_BEARER_TOKEN` is not set.

4. `PLATFORM_API_KEY` (optional auth)
   - API key forwarded by generated SDK as `X-API-Key`.
   - Used by authenticated operations such as review runs and bot key rotate/revoke.

5. `TRADING_CLI_ENABLE_AUTH_STORE` (optional)
   - Enable/disable local credential store resolution for CLI auth tokens.
   - Defaults to enabled, except `NODE_ENV=test` where it defaults to disabled.
   - Explicit values: `1|true|yes|on` or `0|false|no|off`.

6. `TRADING_CLI_AUTH_SECURE_STORE` (optional)
   - Enable/disable OS secure-store usage (`security` keychain on macOS, `secret-tool` on Linux).
   - Defaults to enabled.
   - If disabled or unavailable, CLI falls back to deterministic local file storage.

7. `TRADING_CLI_AUTH_FALLBACK_PATH` (optional)
   - Override deterministic fallback credential file path.
   - Default paths:
     - macOS: `~/Library/Application Support/trading-cli/auth.json`
     - Linux: `${XDG_CONFIG_HOME:-~/.config}/trading-cli/auth.json`
     - Windows: `%APPDATA%/trading-cli/auth.json`

8. `REVIEW_WEB_BASE_URL` (optional)
   - Base URL used to build stable review-open links in CLI output.
   - Default: `https://trade-nexus.lona.agency`.

## Defaults

- Local Platform API default: `http://localhost:3000`
- Review web default: `https://trade-nexus.lona.agency`
- Access-token resolution order: `PLATFORM_API_BEARER_TOKEN` -> `PLATFORM_API_TOKEN` -> stored CLI credential.

## Command Inputs and Secret Handling

1. Registration commands support direct flags or JSON payloads:
   - `--input <file.json>` for full request payloads.
   - `--metadata-json <json>` or `--metadata-file <file.json>` for metadata objects.

2. `register partner` requires `--partner-secret` in payload/flags.
   - Partner secret is sent to Platform API only.
   - CLI never echoes partner secret in output.

3. API keys returned by `register ...` and `key rotate` are emitted once in JSON response.
   - Store immediately; raw key is not retrievable afterwards.

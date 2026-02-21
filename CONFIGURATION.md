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

5. `REVIEW_WEB_BASE_URL` (optional)
   - Base URL used to build stable review-open links in CLI output.
   - Default: `https://trade-nexus.lona.agency`.

## Defaults

- Local Platform API default: `http://localhost:3000`
- Review web default: `https://trade-nexus.lona.agency`

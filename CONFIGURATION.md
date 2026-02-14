# Configuration

## Environment variables

1. `PLATFORM_API_BASE_URL` (required in non-local environments)
   - Must be an absolute `http(s)` URL.
   - Must target Trade Nexus Platform API.
   - Provider hosts (Lona/live-engine/exchange APIs) are rejected by boundary checks.

## Defaults

- Local default: `http://localhost:3000`

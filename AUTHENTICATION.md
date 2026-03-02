# Authenticate CLI

Quickstart and troubleshooting guide for `trading-cli` human and bot authentication.

## Quickstart (Human Device Flow)

1. Install and build:

```bash
bun install
bun run build
```

2. Set the Platform API host:

```bash
export PLATFORM_API_BASE_URL="https://api-nexus.lona.agency"
```

3. Start device auth login:

```bash
trading-cli auth login
```

4. Complete browser approval using the verification URL and user code shown in terminal.

5. Verify active identity/session:

```bash
trading-cli auth whoami
```

6. Revoke current CLI session and clear local credential material:

```bash
trading-cli auth logout
```

Notes:
- `auth login` stores the issued CLI access token in OS secure storage when available.
- Deterministic file fallback is used only when secure storage is unavailable/disabled.
- CLI never prints access tokens in normal output.

## Auth Resolution Order

For bearer auth, CLI resolves credentials in this order:
1. `PLATFORM_API_BEARER_TOKEN`
2. `PLATFORM_API_TOKEN` (backward-compatible alias)
3. Stored CLI credential from `auth login`

This keeps explicit env overrides working for CI/manual runs.

## Bot vs Human Auth

| Scenario | Recommended credential | CLI source | Identity behavior |
| --- | --- | --- | --- |
| Human operator interactive session | CLI device token | `trading-cli auth login` | Request runs as user identity/session |
| Human operator explicit override | Bearer token | `PLATFORM_API_BEARER_TOKEN` or `PLATFORM_API_TOKEN` | Env token takes precedence |
| Automation bot calling runtime/validation flows | Runtime bot key | `PLATFORM_API_KEY` | Request runs as bot actor while retaining owner scope |

## Troubleshooting

### Device Login Timeout

Symptom:
- `auth login` exits with timeout.

Fix:
1. Re-run login with a longer timeout:

```bash
trading-cli auth login --timeout-seconds 1200
```

2. Ensure you complete browser approval before the displayed expiration window.

### Invalid or Expired CLI Device Code

Symptom:
- `auth login` reports expired/consumed/invalid device code.

Fix:
1. Start a fresh login:

```bash
trading-cli auth login
```

2. Use the newest displayed user code.

### Unauthorized on `auth whoami`

Symptom:
- CLI returns `httpStatus: 401` with auth-related codes (`AUTH_UNAUTHORIZED`, `CLI_ACCESS_TOKEN_INVALID`, `CLI_ACCESS_TOKEN_EXPIRED`, `CLI_ACCESS_TOKEN_REVOKED`).

Fix:
1. Re-authenticate:

```bash
trading-cli auth login
```

2. If you intentionally use env override, verify the env token:

```bash
env | rg '^PLATFORM_API_(BEARER_TOKEN|TOKEN)='
```

### Revoked Runtime Bot Key

Symptom:
- CLI returns `httpStatus: 401` with `code: "BOT_API_KEY_REVOKED"`.

Fix:
1. Rotate key:

```bash
trading-cli key rotate --bot-id <bot-id> --reason "replace revoked key"
```

2. Update automation secret storage with the newly issued key.

## Security Guardrails

- Never commit tokens or keys to source control.
- Use `trading-cli auth logout` after shared-terminal sessions.
- Revoke compromised bot keys immediately with `trading-cli key revoke`.

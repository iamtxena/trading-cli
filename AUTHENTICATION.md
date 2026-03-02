# Authenticate CLI

Quickstart and troubleshooting guide for `trading-cli` authentication.

## Quickstart

1. Install and build:

```bash
bun install
bun run build
```

2. Set the Platform API host:

```bash
export PLATFORM_API_BASE_URL="https://api-nexus.lona.agency"
```

3. Login (human auth with bearer token):

```bash
export PLATFORM_API_BEARER_TOKEN="<jwt-access-token>"
trading-cli health get
```

4. Who am I (verify authenticated owner scope):

```bash
trading-cli bot list
```

5. Logout:

```bash
unset PLATFORM_API_BEARER_TOKEN PLATFORM_API_TOKEN PLATFORM_API_KEY
```

Notes:
- `PLATFORM_API_BEARER_TOKEN` is preferred.
- `PLATFORM_API_TOKEN` is accepted as a backward-compatible bearer alias.
- `PLATFORM_API_KEY` is for runtime bot auth keys (`tnx.bot.<botId>.<keyId>.<secret>`).

## Bot vs Human Auth

| Scenario | Recommended credential | CLI env var | Identity behavior |
| --- | --- | --- | --- |
| Human operator running manual commands | JWT bearer token | `PLATFORM_API_BEARER_TOKEN` | Request runs as user identity (`actor_type=user`). |
| Automation bot calling validation/shared flows | Runtime bot key | `PLATFORM_API_KEY` | Request runs as bot actor while retaining owner scope (`actor_type=bot`, owner user preserved). |
| Mixed headers present (JWT + bot key) | JWT bearer token | `PLATFORM_API_BEARER_TOKEN` | Verified user identity remains canonical on mixed requests. |

## Troubleshooting

### Expired Token

Symptom:
- CLI returns `httpStatus: 401` with `code: "AUTH_UNAUTHORIZED"`.

Fix:
1. Issue a fresh JWT token from your identity provider.
2. Re-export `PLATFORM_API_BEARER_TOKEN`.
3. Re-run a low-risk probe:

```bash
trading-cli health get
```

### Revoked Token (Runtime Bot Key)

Symptom:
- CLI returns `httpStatus: 401` with `code: "BOT_API_KEY_REVOKED"`.

Fix:
1. Rotate key for the affected bot:

```bash
trading-cli key rotate --bot-id <bot-id> --reason "replace revoked key"
```

2. Update automation secret storage with the newly issued key.
3. Retry with the new `PLATFORM_API_KEY`.

### Unauthorized (Missing/Invalid Credentials)

Symptom:
- CLI returns `httpStatus: 401` with `code: "AUTH_UNAUTHORIZED"` or `code: "BOT_API_KEY_INVALID"`.

Fix:
1. Confirm one credential is set:

```bash
env | rg '^PLATFORM_API_(BEARER_TOKEN|TOKEN|KEY)='
```

2. Ensure `PLATFORM_API_BASE_URL` is `https://api-nexus.lona.agency` or loopback for local dev.
3. Re-run an authenticated command:

```bash
trading-cli bot list
```

## Security Guardrails

- Never commit tokens or keys to source control.
- Avoid shell history leaks (`HISTCONTROL=ignorespace` and prefix secrets with a space where supported).
- Revoke compromised bot keys immediately with `trading-cli key revoke`.

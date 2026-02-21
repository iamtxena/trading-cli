# trading-cli

External CLI client for Trade Nexus v2.

## Scope

- Consumes Platform API only.
- Enforces no direct provider API usage.
- Uses generated SDK for validation run workflows and bot identity/registration flows.
- Keeps command output automation-friendly.
- Supports bot self-registration:
  - invite-code trial path
  - partner key/secret bootstrap path
- Supports bot key rotate/revoke lifecycle commands.

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

## Review Run Commands

```bash
trading-cli review-run trigger --help
trading-cli review-run retrieve --help
trading-cli review-run render --help
trading-cli validation run trigger --help
```

## Bot Registration Commands

```bash
trading-cli register invite --help
trading-cli register partner --help
trading-cli key rotate --help
trading-cli key revoke --help
```

## Governance docs

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `AGENTS.md`
- `COMMAND_REFERENCE.md`
- `CONFIGURATION.md`
- `RELEASE_PROCESS.md`

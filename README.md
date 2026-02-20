# trading-cli

External CLI client for Trade Nexus v2.

## Scope

- Consumes Platform API only.
- Enforces no direct provider API usage.
- Uses generated SDK for review-run trigger/retrieval.
- Keeps command output automation-friendly.

## Quick start

```bash
bun install
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
```

## Governance docs

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `AGENTS.md`
- `COMMAND_REFERENCE.md`
- `CONFIGURATION.md`
- `RELEASE_PROCESS.md`

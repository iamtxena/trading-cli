# AGENTS.md

## Repository Purpose

`trading-cli` is the external Trade Nexus CLI surface.

## Boundary Rules

1. CLI calls Platform API only.
2. CLI must not call provider APIs directly (Lona, live-engine, exchange endpoints).
3. Public endpoint scope is defined by Trade Nexus OpenAPI in `trade-nexus`.

## Development Rules

1. Keep commands scriptable and JSON-friendly.
2. Enforce boundary checks in tests.
3. Keep changes small and documented in PRs.

# Changelog

All notable changes to `trading-cli` will be documented in this file.

## v0.1.3

- Add production CLI auth command group: `auth login`, `auth whoami`, `auth logout`.
- Add secure credential storage + fallback behavior for local auth sessions.
- Harden credential-store failure handling and secure-store toggle consistency.
- Improve auth-required messaging to include `auth login` guidance.

## v0.1.2

- Add CLI parity commands for health, dataset quality, knowledge search/list/regime, backtest export create/get.
- Add CLI parity commands for validation shared/advanced flows (bots list, runs list, review submit/comment/decision, baseline, replay regression).
- Complete command reference/playbooks and resolve parity review follow-ups (#41, #42).
- Lazy-initialize backtest export client path to remove remaining review thread concern.

## v0.1.1

- Migrate release workflow to npm Trusted Publishing via OIDC (no token required).
- Add provenance attestations to published packages.

## v0.1.0

- Initial external CLI release baseline.
- Includes review-run and validation run commands via generated Platform API SDK.
- Includes bot registration and key lifecycle commands.

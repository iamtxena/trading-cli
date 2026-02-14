# Contributing to trading-cli

Thanks for contributing.

## Setup

1. Install Bun.
2. Install dependencies:

```bash
bun install
```

3. Run tests:

```bash
bun test
```

## Pull Request Requirements

1. Open from a branch created off `main`.
2. Include tests for behavior changes.
3. Keep the PR linked to exactly one issue when using issue-driven delivery.
4. Ensure required CI checks pass.

## Architecture and Contract Proposals

Use issue templates in `.github/ISSUE_TEMPLATE/`:

- `contract_change.yml` for API contract proposals
- `feature_request.yml` for product-level requests
- `bug_report.yml` for defects

For breaking contract proposals, include an explicit architecture approval comment URL in the issue before merge.

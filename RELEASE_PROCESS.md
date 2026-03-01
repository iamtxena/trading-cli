# Release Process

## Branching and merge

1. Open PRs to `main`.
2. Required status checks: `checks`, `mock-consumer-contract`, and `publish-validation`.
3. At least one approving review is required by branch protection.

## Release baseline

1. Update `CHANGELOG.md` with a heading matching `package.json` version (for example `## v0.2.0`).
2. Confirm CI is green, including publish validation.
3. Tag release after merge using semantic versioning (`v<package-version>`).

## GitHub release workflow

- Workflow file: `.github/workflows/release.yml`
- Triggers:
1. Manual dispatch (`publish=false` by default) runs a dry-run release.
2. `push` on tags matching `v*` runs release checks and publishes.
- Release checks:
1. Version is semver-compatible.
2. `CHANGELOG.md` has an entry for the current package version.
3. Tag/version alignment (`v<package-version>`) on tag-triggered runs.
4. Build and `npm pack --dry-run --ignore-scripts`.

## npm publish secrets (names only)

- `NPM_TOKEN` (npm automation token used as `NODE_AUTH_TOKEN` in release workflow)

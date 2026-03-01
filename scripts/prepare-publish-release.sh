#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PACKAGE_JSON_PATH="${REPO_ROOT}/package.json"
CHANGELOG_PATH="${REPO_ROOT}/CHANGELOG.md"

DRIFT_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --spec" >&2
        exit 1
      fi
      DRIFT_ARGS+=("--spec" "$2")
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/prepare-publish-release.sh [--spec <path>]

Options:
  --spec <path>  Authoritative OpenAPI contract path for SDK drift validation.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

PACKAGE_VERSION="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.version);" "${PACKAGE_JSON_PATH}")"
PACKAGE_PRIVATE="$(node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(p.private === false ? 'false' : 'true');" "${PACKAGE_JSON_PATH}")"

if [[ ! "${PACKAGE_VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "package.json version is not semver-compatible: ${PACKAGE_VERSION}" >&2
  exit 1
fi

if [[ "${PACKAGE_PRIVATE}" != "false" ]]; then
  echo "package.json must set private=false before publishing." >&2
  exit 1
fi

node -e '
const fs = require("fs");
const pkg = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (!pkg.exports || typeof pkg.exports !== "object") {
  console.error("package.json exports field is required.");
  process.exit(1);
}
if (pkg.exports["."] !== "./dist/cli.js") {
  console.error("package.json exports['.'] must point to ./dist/cli.js.");
  process.exit(1);
}
' "${PACKAGE_JSON_PATH}"

if [[ ! -f "${CHANGELOG_PATH}" ]]; then
  echo "Missing CHANGELOG.md. Add a release entry for version ${PACKAGE_VERSION}." >&2
  exit 1
fi

ESCAPED_VERSION="${PACKAGE_VERSION//./\\.}"
if ! grep -Eq "^##[[:space:]]+\[?v?${ESCAPED_VERSION}\]?" "${CHANGELOG_PATH}"; then
  echo "CHANGELOG.md is missing a heading for version ${PACKAGE_VERSION}." >&2
  exit 1
fi

if [[ "${GITHUB_REF_TYPE:-}" == "tag" && -n "${GITHUB_REF_NAME:-}" ]]; then
  EXPECTED_TAG="v${PACKAGE_VERSION}"
  if [[ "${GITHUB_REF_NAME}" != "${EXPECTED_TAG}" ]]; then
    echo "Tag mismatch: expected ${EXPECTED_TAG}, got ${GITHUB_REF_NAME}" >&2
    exit 1
  fi
fi

if [[ -x "${SCRIPT_DIR}/verify-sdk-drift.sh" ]]; then
  if (( ${#DRIFT_ARGS[@]} > 0 )); then
    "${SCRIPT_DIR}/verify-sdk-drift.sh" "${DRIFT_ARGS[@]}"
  else
    "${SCRIPT_DIR}/verify-sdk-drift.sh"
  fi
fi

pushd "${REPO_ROOT}" >/dev/null
npm pack --dry-run
popd >/dev/null

echo "Publish release checks passed for version ${PACKAGE_VERSION}."

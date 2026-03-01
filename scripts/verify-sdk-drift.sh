#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SDK_DIR="${REPO_ROOT}/src/generated/trade-nexus-sdk"

GEN_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --spec" >&2
        exit 1
      fi
      GEN_ARGS+=("--spec" "$2")
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/verify-sdk-drift.sh [--spec <path>]

Options:
  --spec <path>  OpenAPI contract file to validate drift against.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -d "${SDK_DIR}" ]]; then
  echo "Vendored SDK directory ${SDK_DIR} does not exist. Run generate-sdk.sh first." >&2
  exit 1
fi

if (( ${#GEN_ARGS[@]} > 0 )); then
  "${SCRIPT_DIR}/generate-sdk.sh" "${GEN_ARGS[@]}" >/dev/null
else
  "${SCRIPT_DIR}/generate-sdk.sh" >/dev/null
fi

if ! git -C "${REPO_ROOT}" diff --quiet -- "${SDK_DIR}"; then
  echo "SDK drift detected in ${SDK_DIR}. Run \`bun run sdk:generate\` and commit generated files." >&2
  git -C "${REPO_ROOT}" --no-pager diff -- "${SDK_DIR}"
  exit 1
fi

UNTRACKED_FILES="$(git -C "${REPO_ROOT}" ls-files --others --exclude-standard -- "${SDK_DIR}")"
if [[ -n "${UNTRACKED_FILES}" ]]; then
  echo "SDK drift detected: untracked generated files present in ${SDK_DIR}." >&2
  printf '%s\n' "${UNTRACKED_FILES}" >&2
  exit 1
fi

echo "No SDK drift detected."

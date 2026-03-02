#!/usr/bin/env bash

set -euo pipefail

DEFAULT_AUTHORITATIVE_SPEC_PATH="/Users/txena/sandbox/16.enjoy/trading/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml"
DEFAULT_SPEC_REVISION="${PLATFORM_API_SPEC_REVISION:-origin/main}"

SPEC_INPUT_PATH="${PLATFORM_API_SPEC_PATH:-${DEFAULT_AUTHORITATIVE_SPEC_PATH}}"
SPEC_REVISION="${DEFAULT_SPEC_REVISION}"
OUTPUT_PATH=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --spec)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --spec" >&2
        exit 1
      fi
      SPEC_INPUT_PATH="$2"
      shift 2
      ;;
    --revision)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --revision" >&2
        exit 1
      fi
      SPEC_REVISION="$2"
      shift 2
      ;;
    --out)
      if [[ $# -lt 2 ]]; then
        echo "Missing value for --out" >&2
        exit 1
      fi
      OUTPUT_PATH="$2"
      shift 2
      ;;
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/resolve-authoritative-spec.sh [--spec <path>] [--revision <git-ref>] --out <path>

Resolution rule:
  - Resolve authoritative spec content from git object <spec-repo>@<git-ref>:<relative-path>.
  - --spec points to a file path only to identify repository + relative path.
  - Working-tree modifications at --spec are ignored.

Options:
  --spec <path>      Spec file path used to derive repository and relative path.
                     Default:
                     /Users/txena/sandbox/16.enjoy/trading/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml
  --revision <ref>   Git revision used for authoritative resolution.
                     Default: origin/main (or PLATFORM_API_SPEC_REVISION env var).
  --out <path>       Output file path for resolved spec content.
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ -z "${OUTPUT_PATH}" ]]; then
  echo "Missing required argument: --out <path>" >&2
  exit 1
fi

SPEC_DIR="$(cd "$(dirname "${SPEC_INPUT_PATH}")" && pwd -P)"
SPEC_FILE_NAME="$(basename "${SPEC_INPUT_PATH}")"
SPEC_ABS_PATH="${SPEC_DIR}/${SPEC_FILE_NAME}"

if [[ ! -f "${SPEC_ABS_PATH}" ]]; then
  echo "Spec path does not exist on disk: ${SPEC_ABS_PATH}" >&2
  exit 1
fi

if ! SPEC_REPO_ROOT="$(git -C "${SPEC_DIR}" rev-parse --show-toplevel 2>/dev/null)"; then
  echo "Spec path is not inside a git repository: ${SPEC_ABS_PATH}" >&2
  exit 1
fi

if [[ "${SPEC_ABS_PATH}" != "${SPEC_REPO_ROOT}/"* ]]; then
  echo "Spec path must be inside repository root ${SPEC_REPO_ROOT}: ${SPEC_ABS_PATH}" >&2
  exit 1
fi

SPEC_REL_PATH="${SPEC_ABS_PATH#${SPEC_REPO_ROOT}/}"

if ! git -C "${SPEC_REPO_ROOT}" rev-parse --verify --quiet "${SPEC_REVISION}^{commit}" >/dev/null; then
  echo "Revision '${SPEC_REVISION}' was not found in ${SPEC_REPO_ROOT}." >&2
  echo "Run: git -C ${SPEC_REPO_ROOT} fetch origin main" >&2
  exit 1
fi

if ! git -C "${SPEC_REPO_ROOT}" cat-file -e "${SPEC_REVISION}:${SPEC_REL_PATH}" 2>/dev/null; then
  echo "Spec blob '${SPEC_REL_PATH}' not found at revision '${SPEC_REVISION}' in ${SPEC_REPO_ROOT}." >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_PATH}")"
git -C "${SPEC_REPO_ROOT}" show "${SPEC_REVISION}:${SPEC_REL_PATH}" > "${OUTPUT_PATH}"

echo "Resolved authoritative spec from ${SPEC_REPO_ROOT}@${SPEC_REVISION}:${SPEC_REL_PATH}" >&2

#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/openapi-generator-sdk.yaml"
SDK_OUT_DIR="${REPO_ROOT}/src/generated/trade-nexus-sdk"
GENERATOR_WRAPPER_VERSION="2.21.5"
DEFAULT_AUTHORITATIVE_SPEC_PATH="/Users/txena/sandbox/16.enjoy/trading/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml"
OPENJDK_HOME="${OPENJDK_HOME:-/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home}"

SPEC_INPUT_PATH="${PLATFORM_API_SPEC_PATH:-${DEFAULT_AUTHORITATIVE_SPEC_PATH}}"

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
    -h|--help)
      cat <<'USAGE'
Usage: bash scripts/generate-sdk.sh [--spec <path>]

Options:
  --spec <path>  OpenAPI contract file to use for SDK generation.
                 Defaults to the authoritative local contract path:
                 /Users/txena/sandbox/16.enjoy/trading/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml
USAGE
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "OpenAPI generator config not found: ${CONFIG_PATH}" >&2
  exit 1
fi

if [[ ! -f "${SPEC_INPUT_PATH}" ]]; then
  echo "Authoritative OpenAPI spec not found at: ${SPEC_INPUT_PATH}" >&2
  echo "Pass --spec <path> to point at a checked-out trade-nexus contract file." >&2
  exit 1
fi

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/trading-cli-sdk.XXXXXX")"
SPEC_PATH="${TMP_ROOT}/platform-api.openapi.yaml"
GEN_OUTPUT_DIR="${TMP_ROOT}/sdk"

cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

cp "${SPEC_INPUT_PATH}" "${SPEC_PATH}"

if ! java -version >/dev/null 2>&1 && [[ -x "${OPENJDK_HOME}/bin/java" ]]; then
  export JAVA_HOME="${OPENJDK_HOME}"
  export PATH="${JAVA_HOME}/bin:${PATH}"
fi

export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/tmp/trading-cli-npm-cache}"
export NPM_CONFIG_UPDATE_NOTIFIER="false"

npx --yes "@openapitools/openapi-generator-cli@${GENERATOR_WRAPPER_VERSION}" generate \
  -i "${SPEC_PATH}" \
  -o "${GEN_OUTPUT_DIR}" \
  -c "${CONFIG_PATH}"

mkdir -p "${SDK_OUT_DIR}"
rsync -a \
  --exclude ".openapi-generator" \
  --exclude ".openapi-generator-ignore" \
  --exclude "index.ts" \
  --exclude "apis/index.ts" \
  --exclude "models/index.ts" \
  "${GEN_OUTPUT_DIR}/" "${SDK_OUT_DIR}/"

echo "Generated vendored SDK at ${SDK_OUT_DIR} using spec ${SPEC_INPUT_PATH}"

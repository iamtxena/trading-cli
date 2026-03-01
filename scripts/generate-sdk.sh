#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
CONFIG_PATH="${SCRIPT_DIR}/openapi-generator-sdk.yaml"
SDK_OUT_DIR="${REPO_ROOT}/src/generated/trade-nexus-sdk"
GENERATOR_WRAPPER_VERSION="2.21.5"
OPENJDK_HOME="/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home"
SPEC_URL="${PLATFORM_API_SPEC_URL:-https://raw.githubusercontent.com/iamtxena/trade-nexus/main/docs/architecture/specs/platform-api.openapi.yaml}"
LOCAL_SPEC_PATH="${LOCAL_PLATFORM_API_SPEC_PATH:-}"

TMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/trading-cli-sdk.XXXXXX")"
SPEC_PATH="${TMP_ROOT}/platform-api.openapi.yaml"
GEN_OUTPUT_DIR="${TMP_ROOT}/sdk"

cleanup() {
  rm -rf "${TMP_ROOT}"
}
trap cleanup EXIT

if [[ ! -f "${CONFIG_PATH}" ]]; then
  echo "OpenAPI generator config not found: ${CONFIG_PATH}" >&2
  exit 1
fi

if [[ -n "${LOCAL_SPEC_PATH}" ]]; then
  if [[ ! -f "${LOCAL_SPEC_PATH}" ]]; then
    echo "LOCAL_PLATFORM_API_SPEC_PATH does not exist: ${LOCAL_SPEC_PATH}" >&2
    exit 1
  fi
  cp "${LOCAL_SPEC_PATH}" "${SPEC_PATH}"
else
  curl --fail --silent --show-error --location "${SPEC_URL}" -o "${SPEC_PATH}"
fi

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
rsync -a --delete \
  --exclude ".openapi-generator" \
  --exclude ".openapi-generator-ignore" \
  "${GEN_OUTPUT_DIR}/" "${SDK_OUT_DIR}/"

echo "Generated vendored SDK at ${SDK_OUT_DIR}"

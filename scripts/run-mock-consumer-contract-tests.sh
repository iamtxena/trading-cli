#!/usr/bin/env bash

set -euo pipefail

PRISM_HOST="${PRISM_HOST:-127.0.0.1}"
PRISM_PORT="${PRISM_PORT:-4010}"
MOCK_BASE_URL="http://${PRISM_HOST}:${PRISM_PORT}"
SPEC_URL="${PLATFORM_API_SPEC_URL:-https://raw.githubusercontent.com/iamtxena/trade-nexus/main/docs/architecture/specs/platform-api.openapi.yaml}"
LOCAL_SPEC_PATH="${LOCAL_PLATFORM_API_SPEC_PATH:-../trade-nexus/docs/architecture/specs/platform-api.openapi.yaml}"
SPEC_PATH="$(mktemp /tmp/trading-cli-platform-api-spec.XXXXXX.yaml)"
PRISM_LOG_PATH="/tmp/trading-cli-prism.log"
PRISM_PID=""

cleanup() {
  rm -f "${SPEC_PATH}" >/dev/null 2>&1 || true
  if [[ -n "${PRISM_PID}" ]] && kill -0 "${PRISM_PID}" >/dev/null 2>&1; then
    kill "${PRISM_PID}" >/dev/null 2>&1 || true
    wait "${PRISM_PID}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

if [[ -f "${LOCAL_SPEC_PATH}" ]]; then
  cp "${LOCAL_SPEC_PATH}" "${SPEC_PATH}"
else
  curl -fsSL "${SPEC_URL}" -o "${SPEC_PATH}"
fi

npx --yes "@stoplight/prism-cli@5.14.2" mock \
  --host "${PRISM_HOST}" \
  --port "${PRISM_PORT}" \
  "${SPEC_PATH}" >"${PRISM_LOG_PATH}" 2>&1 &
PRISM_PID=$!

for _ in {1..60}; do
  if curl -fsS -o /dev/null "${MOCK_BASE_URL}/v1/health"; then
    break
  fi
  sleep 1
done

if ! curl -fsS -o /dev/null "${MOCK_BASE_URL}/v1/health"; then
  echo "Prism mock server did not become ready on ${MOCK_BASE_URL}." >&2
  if [[ -f "${PRISM_LOG_PATH}" ]]; then
    echo "--- prism log start ---" >&2
    cat "${PRISM_LOG_PATH}" >&2 || true
    echo "--- prism log end ---" >&2
  fi
  exit 1
fi

RUN_MOCK_CONSUMER_TESTS=1 MOCK_API_BASE_URL="${MOCK_BASE_URL}" bun test tests/contract/mock-consumer-contract.test.ts

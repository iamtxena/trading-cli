import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { CLI_OPERATION_PARITY, CONTRACT_RECONCILIATION_PATH } from "../../src/cli-operation-parity";

const AUTHORITATIVE_SPEC_URL =
  process.env.PLATFORM_API_SPEC_URL ??
  "https://raw.githubusercontent.com/iamtxena/trade-nexus/main/docs/architecture/specs/platform-api.openapi.yaml";
const DEFAULT_LOCAL_SPEC_PATH =
  "/Users/txena/sandbox/16.enjoy/trading/trade-nexus/docs/architecture/specs/platform-api.openapi.yaml";

const COMMAND_SOURCE_FILES = [
  resolve(process.cwd(), "src/core-command.ts"),
  resolve(process.cwd(), "src/dataset-command.ts"),
  resolve(process.cwd(), "src/conversation-command.ts"),
] as const;

function collectCliSdkOperationIds(): Set<string> {
  const operationIds = new Set<string>();
  const methodPattern = /await\s+api\.([A-Za-z0-9_]+)\s*\(/g;

  for (const filePath of COMMAND_SOURCE_FILES) {
    const source = readFileSync(filePath, "utf-8");
    for (const match of source.matchAll(methodPattern)) {
      operationIds.add(match[1] ?? "");
    }
  }

  operationIds.delete("");
  return operationIds;
}

function extractSpecOperationIds(specText: string): Set<string> {
  const operationIds = new Set<string>();
  const pattern = /^\s*operationId:\s*([A-Za-z0-9_]+)\s*$/gm;

  for (const match of specText.matchAll(pattern)) {
    operationIds.add(match[1] ?? "");
  }

  operationIds.delete("");
  return operationIds;
}

async function loadAuthoritativeSpecText(): Promise<string> {
  const candidateLocalPaths = [
    process.env.LOCAL_PLATFORM_API_SPEC_PATH,
    resolve(process.cwd(), "trade-nexus/docs/architecture/specs/platform-api.openapi.yaml"),
    DEFAULT_LOCAL_SPEC_PATH,
  ].filter((path): path is string => typeof path === "string" && path.length > 0);

  for (const candidatePath of candidateLocalPaths) {
    if (existsSync(candidatePath)) {
      return readFileSync(candidatePath, "utf-8");
    }
  }

  const response = await fetch(AUTHORITATIVE_SPEC_URL);
  if (!response.ok) {
    throw new Error(`Unable to load authoritative spec from ${AUTHORITATIVE_SPEC_URL}: HTTP ${response.status}`);
  }
  return await response.text();
}

describe("CLI/OpenAPI operation parity", () => {
  test("documents path B de-scope strategy", () => {
    expect(CONTRACT_RECONCILIATION_PATH).toBe("B");
  });

  test("maps every SDK operation used by CLI command code", () => {
    const operationsUsedByCli = Array.from(collectCliSdkOperationIds()).sort();
    const mappedOperationIds = Array.from(
      new Set(CLI_OPERATION_PARITY.flatMap((entry) => entry.operationIds)),
    ).sort();

    expect(mappedOperationIds).toEqual(operationsUsedByCli);
  });

  test("ensures mapped CLI operations exist in authoritative OpenAPI", async () => {
    const specText = await loadAuthoritativeSpecText();
    const specOperationIds = extractSpecOperationIds(specText);

    for (const mapping of CLI_OPERATION_PARITY) {
      expect(mapping.command.length).toBeGreaterThan(0);
      expect(mapping.operationIds.length).toBeGreaterThan(0);
      for (const operationId of mapping.operationIds) {
        expect(specOperationIds.has(operationId)).toBe(true);
      }
    }
  });
});

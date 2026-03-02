import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLI_COMMAND_FILES = [
  "src/core-command.ts",
  "src/dataset-command.ts",
  "src/review-run-command.ts",
  "src/shared-command.ts",
  "src/validation-bot-command.ts",
] as const;

const OPERATION_IDS_MANIFEST_PATH = resolve(
  process.cwd(),
  "src/generated/trade-nexus-sdk/operation-ids.json",
);

function collectCliInvokedOperationIds(): string[] {
  const operationIds = new Set<string>();
  const sdkCallPattern = /\bapi\.([A-Za-z0-9_]+)\s*\(/g;

  for (const relativePath of CLI_COMMAND_FILES) {
    const source = readFileSync(resolve(process.cwd(), relativePath), "utf-8");
    for (const match of source.matchAll(sdkCallPattern)) {
      operationIds.add(match[1]);
    }
  }

  return Array.from(operationIds).sort();
}

function loadAuthoritativeOperationIds(): Set<string> {
  const manifestRaw = readFileSync(OPERATION_IDS_MANIFEST_PATH, "utf-8");
  const manifest = JSON.parse(manifestRaw) as { operationIds?: unknown };
  if (!Array.isArray(manifest.operationIds)) {
    throw new Error(
      "Invalid operation ids manifest. Re-run `bun run sdk:generate` to refresh generated SDK metadata.",
    );
  }
  return new Set(
    manifest.operationIds.filter((value): value is string => typeof value === "string"),
  );
}

describe("CLI operationId parity with authoritative contract", () => {
  test("maps every SDK-backed CLI operation to an authoritative operationId", () => {
    const cliOperationIds = collectCliInvokedOperationIds();
    expect(cliOperationIds.length).toBeGreaterThan(0);

    const authoritativeOperationIds = loadAuthoritativeOperationIds();
    expect(authoritativeOperationIds.size).toBeGreaterThan(0);

    const missingOperationIds = cliOperationIds.filter(
      (operationId) => !authoritativeOperationIds.has(operationId),
    );

    expect(missingOperationIds).toEqual([]);
  });
});

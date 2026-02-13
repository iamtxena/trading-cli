import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlatformApiBaseUrl } from "../../src/cli";

const SRC_ROOT = resolve(process.cwd(), "src");

function collectTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = resolve(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      return collectTypeScriptFiles(fullPath);
    }

    return fullPath.endsWith(".ts") ? [fullPath] : [];
  });
}

describe("Platform API boundary", () => {
  test("accepts platform API hosts", () => {
    expect(() => assertPlatformApiBaseUrl("https://api.trade-nexus.io")).not.toThrow();
    expect(() => assertPlatformApiBaseUrl("http://localhost:3000")).not.toThrow();
  });

  test("rejects direct provider hosts", () => {
    expect(() => assertPlatformApiBaseUrl("https://gateway.lona.agency")).toThrow();
    expect(() => assertPlatformApiBaseUrl("https://live-engine.internal")).toThrow();
    expect(() => assertPlatformApiBaseUrl("https://api.binance.com")).toThrow();
  });

  test("declares provider-host guardrails in CLI source", () => {
    const cliSource = readFileSync(resolve(process.cwd(), "src/cli.ts"), "utf-8");
    expect(cliSource).toContain("BLOCKED_PROVIDER_HOST_HINTS");
    expect(cliSource).toContain("Boundary violation");
  });

  test("contains no direct provider URL literals in source", () => {
    const providerUrlLiterals = [
      "https://api.binance.com",
      "https://api.alpaca.markets",
      "https://api.kraken.com",
      "https://api.coinbase.com"
    ] as const;

    for (const filePath of collectTypeScriptFiles(SRC_ROOT)) {
      const text = readFileSync(filePath, "utf-8");
      for (const blockedUrl of providerUrlLiterals) {
        expect(text).not.toContain(blockedUrl);
      }
    }
  });

  test("contains no direct provider imports in source", () => {
    const providerImportPattern =
      /(?:import\s+.+?from\s+|import\s*\()\s*["'][^"']*(ccxt|lona|live-engine|binance|alpaca|kraken|coinbase)[^"']*["']/i;

    for (const filePath of collectTypeScriptFiles(SRC_ROOT)) {
      const text = readFileSync(filePath, "utf-8");
      expect(providerImportPattern.test(text)).toBe(false);
    }
  });
});

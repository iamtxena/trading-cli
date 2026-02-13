import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPlatformApiBaseUrl } from "../../src/cli";

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
});

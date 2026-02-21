import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { collectTypeScriptFiles } from "../src/typescript-file-collector";

const SRC_ROOT = resolve(process.cwd(), "src");

const DIRECT_PROVIDER_IMPORT_PATTERN =
  /(?:import\s+.+?from\s+|import\s*\()\s*["'][^"']*(ccxt|lona|live-engine|binance|alpaca|kraken|coinbase)[^"']*["']/i;
const URL_LITERAL_PATTERN = /https?:\/\/[^"'`\s]+/gi;

const ALLOWED_PLATFORM_HOSTS = new Set([
  "api-nexus.lona.agency",
  "trade-nexus.lona.agency",
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

const BLOCKED_PROVIDER_HOST_HINTS = ["lona", "live-engine", "binance", "alpaca", "kraken", "coinbase"];

const failures: string[] = [];

for (const filePath of collectTypeScriptFiles(SRC_ROOT)) {
  const content = readFileSync(filePath, "utf-8");

  if (DIRECT_PROVIDER_IMPORT_PATTERN.test(content)) {
    failures.push(`Direct provider import found in ${filePath}`);
  }

  const urlLiterals = content.match(URL_LITERAL_PATTERN) ?? [];
  for (const literal of urlLiterals) {
    let hostname: string;
    try {
      hostname = new URL(literal).hostname.toLowerCase();
    } catch {
      continue;
    }

    if (ALLOWED_PLATFORM_HOSTS.has(hostname)) {
      continue;
    }

    const pointsToProvider = BLOCKED_PROVIDER_HOST_HINTS.some((hint) => hostname.includes(hint));
    if (pointsToProvider) {
      failures.push(`Direct provider URL found in ${filePath}: ${literal}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log("Boundary lint passed.");

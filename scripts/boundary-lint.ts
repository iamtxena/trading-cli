import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { collectTypeScriptFiles } from "../src/typescript-file-collector";

const SRC_ROOT = resolve(process.cwd(), "src");

const DIRECT_PROVIDER_IMPORT_PATTERN =
  /(?:import\s+.+?from\s+|import\s*\()\s*["'][^"']*(ccxt|lona|live-engine|binance|alpaca|kraken|coinbase)[^"']*["']/i;
const DIRECT_PROVIDER_URL_PATTERN =
  /https?:\/\/[^"'`\s]*(binance|alpaca|kraken|coinbase|lona|live-engine)[^"'`\s]*/i;

const failures: string[] = [];

for (const filePath of collectTypeScriptFiles(SRC_ROOT)) {
  const content = readFileSync(filePath, "utf-8");

  if (DIRECT_PROVIDER_IMPORT_PATTERN.test(content)) {
    failures.push(`Direct provider import found in ${filePath}`);
  }

  if (DIRECT_PROVIDER_URL_PATTERN.test(content)) {
    failures.push(`Direct provider URL found in ${filePath}`);
  }
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(failure);
  }
  process.exit(1);
}

console.log("Boundary lint passed.");

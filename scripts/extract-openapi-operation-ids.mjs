#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

function usage() {
  console.error(
    "Usage: node scripts/extract-openapi-operation-ids.mjs --spec <path> --out <path>",
  );
}

function parseArgs(argv) {
  let specPath;
  let outputPath;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec") {
      specPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--out") {
      outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    console.error(`Unknown argument: ${arg}`);
    usage();
    process.exit(1);
  }

  if (!specPath || !outputPath) {
    usage();
    process.exit(1);
  }

  return {
    specPath: resolve(specPath),
    outputPath: resolve(outputPath),
  };
}

function extractOperationIds(specText) {
  const operationIdPattern = /^\s*operationId:\s*["']?([A-Za-z0-9_]+)["']?\s*$/gm;
  const operationIds = new Set();

  for (const match of specText.matchAll(operationIdPattern)) {
    operationIds.add(match[1]);
  }

  return Array.from(operationIds).sort();
}

const { specPath, outputPath } = parseArgs(process.argv.slice(2));
const specText = readFileSync(specPath, "utf8");
const operationIds = extractOperationIds(specText);

if (operationIds.length === 0) {
  console.error(`No operationId entries found in ${specPath}.`);
  process.exit(1);
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify({ operationIds }, null, 2)}\n`);

console.log(`Wrote ${operationIds.length} operationIds to ${outputPath}`);

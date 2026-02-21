#!/usr/bin/env node

import { formatReviewRunError, runReviewRunCommand } from "./review-run-command";
import { runValidationBotCommand } from "./validation-bot-command";

const BLOCKED_PROVIDER_HOST_HINTS = [
  "lona",
  "live-engine",
  "binance",
  "alpaca",
  "kraken",
  "coinbase",
] as const;

const PLATFORM_API_HOST = "api-nexus.lona.agency";

const ALLOWED_LOCAL_LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function emitError(payload: unknown): void {
  console.error(JSON.stringify(payload, null, 2));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export function assertPlatformApiBaseUrl(url: string): void {
  const normalized = url.trim();

  if (!normalized) {
    throw new Error("PLATFORM_API_BASE_URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("PLATFORM_API_BASE_URL must be an absolute http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PLATFORM_API_BASE_URL must be an absolute http(s) URL.");
  }

  const hostname = parsed.hostname.toLowerCase();

  const isPlatformHost = hostname === PLATFORM_API_HOST || ALLOWED_LOCAL_LOOPBACK_HOSTS.has(hostname);

  const pointsToProvider = BLOCKED_PROVIDER_HOST_HINTS.some((hint) =>
    hostname.includes(hint),
  );

  if (pointsToProvider && !isPlatformHost) {
    throw new Error(
      "Boundary violation: CLI must target Platform API only (no direct provider hosts).",
    );
  }

  if (!isPlatformHost) {
    throw new Error(
      "PLATFORM_API_BASE_URL host must be api-nexus.lona.agency or a local loopback host.",
    );
  }
}

export async function run(argv: string[], fetchImpl: typeof fetch = fetch): Promise<number> {
  const baseUrl = process.env.PLATFORM_API_BASE_URL ?? "http://localhost:3000";

  try {
    assertPlatformApiBaseUrl(baseUrl);
  } catch (error) {
    emitError({
      status: "error",
      message: toErrorMessage(error),
    });
    return 1;
  }

  const args = argv.slice(2);
  if (args.length === 0) {
    emitJson({
      status: "ok",
      message: "trading-cli ready",
      target: baseUrl,
      commands: [
        "review-run trigger",
        "review-run retrieve",
        "review-run render",
        "validation run trigger",
        "validation run retrieve",
        "validation run render",
        "register invite",
        "register partner",
        "key rotate",
        "key revoke",
      ],
    });
    return 0;
  }

  try {
    const context = {
      baseUrl,
      env: process.env,
      fetchImpl,
      emit: emitJson,
    };

    if (args[0] === "review-run") {
      await runReviewRunCommand(args.slice(1), context);
      return 0;
    }

    if (args[0] === "validation" && args[1] === "run") {
      await runReviewRunCommand(args.slice(2), context);
      return 0;
    }

    if (args[0] === "register" || args[0] === "key") {
      await runValidationBotCommand(args, context);
      return 0;
    }

    if (args[0] === "bot") {
      await runValidationBotCommand(args.slice(1), context);
      return 0;
    }

    emitError({
      status: "error",
      message: `Unknown command '${args[0]}'. Use 'review-run', 'validation run', 'register', 'key', or 'bot'.`,
      command: args,
      target: baseUrl,
    });
    return 1;
  } catch (error) {
    try {
      emitError(await formatReviewRunError(error));
    } catch {
      emitError({
        status: "error",
        message: toErrorMessage(error),
      });
    }
    return 1;
  }
}

if (import.meta.main) {
  run(process.argv)
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error) => {
      emitError({
        status: "error",
        message: toErrorMessage(error),
      });
      process.exit(1);
    });
}

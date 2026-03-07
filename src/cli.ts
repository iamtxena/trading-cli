#!/usr/bin/env node

import { formatReviewRunError, runReviewRunCommand } from "./review-run-command";
import { runValidationBotCommand } from "./validation-bot-command";
import { runCoreCommand } from "./core-command";
import { runDatasetCommand } from "./dataset-command";
import { runSharedCommand } from "./shared-command";
import { runAuthCommand } from "./auth-command";
import { hasHelpFlag, isHelpFlag } from "./command-utils";

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

function isRootHelpInvocation(args: string[]): boolean {
  return args.length === 0 || args[0] === "--help" || args[0] === "-h";
}

function isAuthHelpInvocation(args: string[]): boolean {
  if (args[0] !== "auth") {
    return false;
  }

  const authArgs = args.slice(1);
  if (isHelpFlag(authArgs[0])) {
    return true;
  }

  const subcommand = authArgs[0];
  if (subcommand !== "login" && subcommand !== "whoami" && subcommand !== "logout") {
    return false;
  }

  return hasHelpFlag(authArgs.slice(1));
}

function isStrategyHelpInvocation(args: string[]): boolean {
  if (args[0] !== "strategy") {
    return false;
  }

  const subcommand = args[1];
  if (isHelpFlag(subcommand)) {
    return true;
  }

  return (
    (subcommand === "create" ||
      subcommand === "get" ||
      subcommand === "list" ||
      subcommand === "update") &&
    hasHelpFlag(args.slice(2))
  );
}

function isValidationBotHelpInvocation(args: string[]): boolean {
  const root = args[0];

  if (root === "register") {
    // Keep validation-bot help parsing local so dispatcher errors do not depend on API URL state.
    return isHelpFlag(args[1]) || hasHelpFlag(args.slice(2));
  }

  if (root === "key") {
    return isHelpFlag(args[1]) || hasHelpFlag(args.slice(2));
  }

  if (root !== "bot") {
    return false;
  }

  const mode = args[1];
  if (isHelpFlag(mode)) {
    return true;
  }

  if (mode === "list") {
    return hasHelpFlag(args.slice(2));
  }

  if (mode === "register" || mode === "key") {
    return hasHelpFlag(args.slice(2));
  }

  return false;
}

function emitRootUsage(baseUrl: string): void {
  emitJson({
    status: "ok",
    message: "trading-cli ready",
    target: baseUrl,
    usage: ["trading-cli <command> [subcommand] [flags]", "trading-cli --help"],
    commands: [
      "review-run trigger",
      "review-run retrieve",
      "review-run list",
      "review-run render",
      "review-run review",
      "review-run review-comment",
      "review-run review-decision",
      "review-run baseline",
      "review-run replay",
      "validation run <trigger|retrieve|list|render|review|review-comment|review-decision|baseline|replay>",
      "register invite",
      "register partner",
      "key rotate",
      "key revoke",
      "bot list",
      "auth login",
      "auth whoami",
      "auth logout",
      "health get",
      "research scan",
      "knowledge search|patterns|regime",
      "strategy create|get|list|update",
      "backtest create|get|export create|export get",
      "deploy create|get|list|stop",
      "portfolio list|get",
      "order create|get|list|cancel",
      "dataset upload init|complete",
      "dataset validate|transform|publish|get|status|list|quality-report",
      "shared-validation shared-with-me|run|artifact|review-comment|review-decision",
      "invite create|list|accept|revoke",
      "conversation session create|get",
      "conversation turn create",
    ],
  });
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
  const args = argv.slice(2);

  if (isRootHelpInvocation(args)) {
    emitRootUsage(baseUrl);
    return 0;
  }

  if (
    !isAuthHelpInvocation(args) &&
    !isStrategyHelpInvocation(args) &&
    !isValidationBotHelpInvocation(args)
  ) {
    try {
      assertPlatformApiBaseUrl(baseUrl);
    } catch (error) {
      emitError({
        status: "error",
        message: toErrorMessage(error),
      });
      return 1;
    }
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

    if (args[0] === "auth") {
      await runAuthCommand(args.slice(1), context);
      return 0;
    }

    if (
      args[0] === "health" ||
      args[0] === "research" ||
      args[0] === "knowledge" ||
      args[0] === "strategy" ||
      args[0] === "backtest" ||
      args[0] === "deploy" ||
      args[0] === "portfolio" ||
      args[0] === "order"
    ) {
      await runCoreCommand(args, context);
      return 0;
    }

    if (args[0] === "dataset") {
      await runDatasetCommand(args.slice(1), context);
      return 0;
    }

    if (
      args[0] === "shared-validation" ||
      args[0] === "invite" ||
      args[0] === "conversation" ||
      args[0] === "conversations"
    ) {
      await runSharedCommand(args, context);
      return 0;
    }

    emitError({
      status: "error",
      message:
        `Unknown command '${args[0]}'. Use 'review-run', 'validation run', ` +
        "'register', 'key', 'bot', 'auth', 'health', 'research', 'knowledge', 'strategy', 'backtest', " +
        "'deploy', 'portfolio', 'order', 'dataset', 'shared-validation', " +
        "'invite', or 'conversation'.",
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

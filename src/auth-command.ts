import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import { type CommandContext, deriveRequestId, hasHelpFlag, nonEmpty } from "./command-utils";
import {
  clearStoredCliCredential,
  loadStoredCliCredential,
  saveStoredCliCredential,
} from "./credential-store";
import { ResponseError, ValidationCliScope } from "./generated/trade-nexus-sdk";
import { createValidationApiClient } from "./validation-api-client";

type ParsedValues = ReturnType<typeof parseArgs>["values"];

const AUTH_REQUEST_ID_PREFIX = "req-cli-auth";
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const DEFAULT_LOGIN_TIMEOUT_SECONDS = 900;
const ALLOWED_SCOPES = new Set<string>(Object.values(ValidationCliScope));

type PlatformApiErrorPayload = {
  httpStatus: number;
  requestId?: string;
  code?: string;
  message?: string;
  details?: unknown;
};

function parseScopes(values: ParsedValues): ValidationCliScope[] | undefined {
  const rawScopes = nonEmpty(values.scopes);
  if (!rawScopes) {
    return undefined;
  }

  const scopes = rawScopes
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => scope.length > 0);

  if (scopes.length === 0) {
    throw new Error("--scopes must include at least one scope.");
  }

  for (const scope of scopes) {
    if (!ALLOWED_SCOPES.has(scope)) {
      throw new Error(
        `Unsupported scope '${scope}'. Allowed values: validation:read, validation:write.`,
      );
    }
  }

  return [...new Set(scopes.map((scope) => scope as ValidationCliScope))];
}

function parsePositiveInteger(raw: unknown, label: string): number | undefined {
  const normalized = nonEmpty(raw);
  if (!normalized) {
    return undefined;
  }
  const parsed = Number.parseInt(normalized, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function toOptionalIso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

async function parsePlatformError(error: ResponseError): Promise<PlatformApiErrorPayload> {
  const payload: PlatformApiErrorPayload = {
    httpStatus: error.response.status,
  };

  try {
    const response = (await error.response.json()) as {
      requestId?: unknown;
      error?: {
        code?: unknown;
        message?: unknown;
        details?: unknown;
      };
    };

    payload.requestId = nonEmpty(response.requestId);
    payload.code = nonEmpty(response.error?.code);
    payload.message = nonEmpty(response.error?.message);
    payload.details = response.error?.details;
  } catch {
    // Non-JSON error body; retain HTTP status only.
  }

  return payload;
}

function formatErrorMessage(message: string, requestId?: string): string {
  return requestId ? `${message} (requestId: ${requestId})` : message;
}

function parsePendingPollInterval(details: unknown): number | undefined {
  if (!details || typeof details !== "object") {
    return undefined;
  }
  const raw = (details as Record<string, unknown>).interval;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return undefined;
}

function emitAuthUsage(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "auth",
    usage: [
      "trading-cli auth login [--scopes validation:read,validation:write] [--timeout-seconds <seconds>] [--poll-interval-seconds <seconds>]",
      "trading-cli auth whoami",
      "trading-cli auth logout",
    ],
  });
}

function emitAuthLoginUsage(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "auth login",
    usage: [
      "trading-cli auth login [--scopes validation:read,validation:write] [--timeout-seconds <seconds>] [--poll-interval-seconds <seconds>] [--request-id <id>]",
    ],
  });
}

function emitAuthWhoamiUsage(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "auth whoami",
    usage: ["trading-cli auth whoami [--request-id <id>]"],
  });
}

function emitAuthLogoutUsage(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "auth logout",
    usage: ["trading-cli auth logout [--request-id <id>]"],
  });
}

async function runAuthLoginCommand(args: string[], context: CommandContext): Promise<void> {
  if (hasHelpFlag(args)) {
    emitAuthLoginUsage(context);
    return;
  }

  const parsed = parseArgs({
    args,
    options: {
      scopes: { type: "string" },
      "timeout-seconds": { type: "string" },
      "poll-interval-seconds": { type: "string" },
      "request-id": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const scopes = parseScopes(parsed.values);
  const timeoutSeconds = parsePositiveInteger(parsed.values["timeout-seconds"], "--timeout-seconds");
  const intervalOverride = parsePositiveInteger(
    parsed.values["poll-interval-seconds"],
    "--poll-interval-seconds",
  );
  const requestId = deriveRequestId(AUTH_REQUEST_ID_PREFIX, nonEmpty(parsed.values["request-id"]));

  const api = createValidationApiClient(context, { requireAuth: false });
  const start = await api.startValidationCliDeviceAuthV2({
    xRequestId: `${requestId}-start`,
    createValidationCliDeviceStartRequest: scopes ? { scopes } : undefined,
  });

  const resolvedTimeoutSeconds =
    timeoutSeconds ?? Math.max(1, start.expiresIn ?? DEFAULT_LOGIN_TIMEOUT_SECONDS);
  let intervalSeconds = intervalOverride ?? Math.max(1, start.interval ?? DEFAULT_POLL_INTERVAL_SECONDS);
  const deadlineEpochMs = Date.now() + resolvedTimeoutSeconds * 1000;

  console.error(`Open ${start.verificationUriComplete}`);
  console.error(`Or open ${start.verificationUri} and enter code ${start.userCode}`);
  console.error(
    `Waiting for approval (poll interval ${intervalSeconds}s, timeout ${resolvedTimeoutSeconds}s).`,
  );

  let tokenIssued = undefined as Awaited<ReturnType<typeof api.pollValidationCliDeviceTokenV2>> | undefined;

  while (Date.now() < deadlineEpochMs) {
    try {
      tokenIssued = await api.pollValidationCliDeviceTokenV2({
        xRequestId: `${requestId}-poll`,
        createValidationCliDeviceTokenPollRequest: {
          deviceCode: start.deviceCode,
        },
      });
      break;
    } catch (error) {
      if (error instanceof ResponseError) {
        const platformError = await parsePlatformError(error);

        if (
          platformError.httpStatus === 409 &&
          platformError.code === "CLI_DEVICE_AUTHORIZATION_PENDING"
        ) {
          intervalSeconds = parsePendingPollInterval(platformError.details) ?? intervalSeconds;
          const remainingMs = deadlineEpochMs - Date.now();
          if (remainingMs <= 0) {
            break;
          }
          await sleep(Math.min(intervalSeconds * 1000, remainingMs));
          continue;
        }

        if (platformError.code === "CLI_DEVICE_CODE_EXPIRED") {
          throw new Error(
            formatErrorMessage(
              "Device authorization expired before approval. Run `trading-cli auth login` again.",
              platformError.requestId,
            ),
          );
        }

        if (platformError.code === "CLI_DEVICE_CODE_CONSUMED") {
          throw new Error(
            formatErrorMessage(
              "Device authorization code has already been consumed. Run `trading-cli auth login` again.",
              platformError.requestId,
            ),
          );
        }

        throw new Error(
          formatErrorMessage(
            platformError.message ??
              `Device authorization failed with HTTP ${platformError.httpStatus}.`,
            platformError.requestId,
          ),
        );
      }

      throw error;
    }
  }

  if (!tokenIssued) {
    throw new Error(`Device authorization timed out after ${resolvedTimeoutSeconds} seconds.`);
  }

  let storageBackend: ReturnType<typeof saveStoredCliCredential>;
  try {
    storageBackend = saveStoredCliCredential(
      context.baseUrl,
      {
        accessToken: tokenIssued.accessToken,
        sessionId: tokenIssued.sessionId,
        tenantId: tokenIssued.tenantId,
        userId: tokenIssued.userId,
        createdByUserId: tokenIssued.createdByUserId,
        scopes: tokenIssued.scopes,
        createdAt: tokenIssued.createdAt.toISOString(),
        expiresAt: tokenIssued.expiresAt.toISOString(),
      },
      context.env,
    );
  } catch (error) {
    const details = error instanceof Error ? ` Details: ${error.message}` : "";
    throw new Error(
      formatErrorMessage(
        "login succeeded but credential storage failed. Re-run `trading-cli auth login` after fixing local credential storage configuration or permissions." +
          details,
        tokenIssued.requestId,
      ),
    );
  }

  context.emit({
    status: "ok",
    command: "auth login",
    requestId: tokenIssued.requestId,
    sessionId: tokenIssued.sessionId,
    tenantId: tokenIssued.tenantId,
    userId: tokenIssued.userId,
    createdByUserId: tokenIssued.createdByUserId,
    scopes: tokenIssued.scopes,
    createdAt: tokenIssued.createdAt.toISOString(),
    expiresAt: tokenIssued.expiresAt.toISOString(),
    expiresIn: tokenIssued.expiresIn,
    storage: {
      backend: storageBackend,
    },
  });
}

async function runAuthWhoamiCommand(args: string[], context: CommandContext): Promise<void> {
  if (hasHelpFlag(args)) {
    emitAuthWhoamiUsage(context);
    return;
  }

  const parsed = parseArgs({
    args,
    options: {
      "request-id": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const requestId = deriveRequestId(AUTH_REQUEST_ID_PREFIX, nonEmpty(parsed.values["request-id"]));
  const api = createValidationApiClient(context);
  const response = await api.whoamiValidationCliAuthV2({
    xRequestId: requestId,
  });

  context.emit({
    status: "ok",
    command: "auth whoami",
    requestId: response.requestId,
    sessionId: response.session.id,
    tenantId: response.session.tenantId,
    userId: response.session.userId,
    createdByUserId: response.session.createdByUserId,
    scopes: response.session.scopes,
    createdAt: response.session.createdAt.toISOString(),
    expiresAt: response.session.expiresAt.toISOString(),
    revokedAt: toOptionalIso(response.session.revokedAt),
    lastUsedAt: toOptionalIso(response.session.lastUsedAt),
  });
}

async function runAuthLogoutCommand(args: string[], context: CommandContext): Promise<void> {
  if (hasHelpFlag(args)) {
    emitAuthLogoutUsage(context);
    return;
  }

  const parsed = parseArgs({
    args,
    options: {
      "request-id": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const requestId = deriveRequestId(AUTH_REQUEST_ID_PREFIX, nonEmpty(parsed.values["request-id"]));
  const envAccessToken =
    nonEmpty(context.env.PLATFORM_API_BEARER_TOKEN) ?? nonEmpty(context.env.PLATFORM_API_TOKEN);
  const storedCredential = loadStoredCliCredential(context.baseUrl, context.env);

  if (!envAccessToken && !storedCredential) {
    clearStoredCliCredential(context.baseUrl, context.env);
    context.emit({
      status: "ok",
      command: "auth logout",
      message: "No active CLI credential found. Local credential material is already clear.",
    });
    return;
  }

  const api = createValidationApiClient(context);
  try {
    const whoami = await api.whoamiValidationCliAuthV2({
      xRequestId: `${requestId}-whoami`,
    });

    const revoked = await api.revokeValidationCliSessionV2({
      sessionId: whoami.session.id,
      xRequestId: `${requestId}-revoke`,
    });

    context.emit({
      status: "ok",
      command: "auth logout",
      requestId: revoked.requestId,
      sessionId: revoked.session.id,
      tenantId: revoked.session.tenantId,
      userId: revoked.session.userId,
      revokedAt: toOptionalIso(revoked.session.revokedAt),
      localCredentialsCleared: true,
    });
  } finally {
    clearStoredCliCredential(context.baseUrl, context.env);
  }
}

export async function runAuthCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    emitAuthUsage(context);
    return;
  }

  if (subcommand === "login") {
    await runAuthLoginCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "whoami") {
    await runAuthWhoamiCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "logout") {
    await runAuthLogoutCommand(args.slice(1), context);
    return;
  }

  throw new Error(`Unknown auth command '${subcommand}'. Use 'login', 'whoami', or 'logout'.`);
}

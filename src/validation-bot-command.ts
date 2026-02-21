import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  Configuration,
  ValidationApi,
  type Bot,
  type BotKeyMetadata,
  type BotRegistration,
  type CreateBotInviteRegistrationRequest,
  type CreateBotPartnerBootstrapRequest,
} from "./generated/trade-nexus-sdk";

type CommandContext = {
  baseUrl: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  emit: (payload: unknown) => void;
};

type ParsedValues = ReturnType<typeof parseArgs>["values"];

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function deriveRequestId(seed?: string): string {
  if (seed) {
    return seed;
  }
  return `req-validation-bot-${Date.now()}`;
}

function deriveIdempotencyKey(seed?: string): string {
  if (seed) {
    return seed;
  }
  return `idem-validation-bot-${randomUUID()}`;
}

function parseJsonFile<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    throw new Error(
      `Unable to parse ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function parseMetadataObject(raw: string, label: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Unable to parse ${label} as JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseOptionalMetadata(values: ParsedValues): Record<string, unknown> | undefined {
  const metadataJson = nonEmpty(values["metadata-json"]);
  const metadataFile = nonEmpty(values["metadata-file"]);

  if (metadataJson && metadataFile) {
    throw new Error("Specify only one of --metadata-json or --metadata-file.");
  }

  if (metadataJson) {
    return parseMetadataObject(metadataJson, "--metadata-json");
  }

  if (metadataFile) {
    return parseJsonFile<Record<string, unknown>>(metadataFile, "--metadata-file");
  }

  return undefined;
}

function resolveAuth(env: NodeJS.ProcessEnv): { accessToken?: string; apiKey?: string } {
  const accessToken = nonEmpty(env.PLATFORM_API_BEARER_TOKEN) ?? nonEmpty(env.PLATFORM_API_TOKEN);
  const apiKey = nonEmpty(env.PLATFORM_API_KEY);
  return { accessToken, apiKey };
}

function createValidationApiClient(context: CommandContext, requireAuth: boolean): ValidationApi {
  const auth = resolveAuth(context.env);
  if (requireAuth && !auth.accessToken && !auth.apiKey) {
    throw new Error(
      "Authentication required: set PLATFORM_API_BEARER_TOKEN (preferred) or PLATFORM_API_KEY.",
    );
  }

  const configuration = new Configuration({
    basePath: trimTrailingSlash(context.baseUrl),
    fetchApi: context.fetchImpl,
    accessToken: auth.accessToken,
    apiKey: auth.apiKey,
  });
  return new ValidationApi(configuration);
}

function parseInviteRegistrationPayload(values: ParsedValues): CreateBotInviteRegistrationRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateBotInviteRegistrationRequest>(inputPath, "register invite payload");
  }

  const inviteCode = nonEmpty(values["invite-code"]);
  const botName = nonEmpty(values["bot-name"]);

  if (!inviteCode) {
    throw new Error("--invite-code is required when --input is not provided.");
  }
  if (!botName) {
    throw new Error("--bot-name is required when --input is not provided.");
  }

  return {
    inviteCode,
    botName,
    metadata: parseOptionalMetadata(values),
  };
}

function parsePartnerBootstrapPayload(values: ParsedValues): CreateBotPartnerBootstrapRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateBotPartnerBootstrapRequest>(inputPath, "register partner payload");
  }

  const partnerKey = nonEmpty(values["partner-key"]);
  const partnerSecret = nonEmpty(values["partner-secret"]);
  const ownerEmail = nonEmpty(values["owner-email"]);
  const botName = nonEmpty(values["bot-name"]);

  if (!partnerKey) {
    throw new Error("--partner-key is required when --input is not provided.");
  }
  if (!partnerSecret) {
    throw new Error("--partner-secret is required when --input is not provided.");
  }
  if (!ownerEmail) {
    throw new Error("--owner-email is required when --input is not provided.");
  }
  if (!botName) {
    throw new Error("--bot-name is required when --input is not provided.");
  }

  return {
    partnerKey,
    partnerSecret,
    ownerEmail,
    botName,
    metadata: parseOptionalMetadata(values),
  };
}

function summarizeBot(bot: Bot) {
  return {
    ...bot,
    trialExpiresAt: bot.trialExpiresAt?.toISOString() ?? null,
    createdAt: bot.createdAt.toISOString(),
    updatedAt: bot.updatedAt.toISOString(),
  };
}

function summarizeRegistration(registration: BotRegistration) {
  return {
    ...registration,
    createdAt: registration.createdAt.toISOString(),
  };
}

function summarizeKey(key: BotKeyMetadata) {
  return {
    ...key,
    createdAt: key.createdAt.toISOString(),
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  };
}

async function runRegisterInviteCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      "invite-code": { type: "string" },
      "bot-name": { type: "string" },
      "metadata-json": { type: "string" },
      "metadata-file": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const payload = parseInviteRegistrationPayload(parsed.values);
  const requestId = deriveRequestId(nonEmpty(parsed.values["request-id"]));
  const idempotencyKey = deriveIdempotencyKey(nonEmpty(parsed.values["idempotency-key"]));
  const api = createValidationApiClient(context, false);

  const response = await api.registerValidationBotInviteCodeV2({
    xRequestId: requestId,
    idempotencyKey,
    createBotInviteRegistrationRequest: payload,
  });

  context.emit({
    status: "ok",
    command: "register invite",
    requestId: response.requestId,
    idempotencyKey,
    bot: summarizeBot(response.bot),
    registration: summarizeRegistration(response.registration),
    issuedKey: {
      key: summarizeKey(response.issuedKey.key),
      rawKey: response.issuedKey.rawKey,
      warning: "Store this key now. It will not be shown again.",
    },
  });
}

async function runRegisterPartnerCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      "partner-key": { type: "string" },
      "partner-secret": { type: "string" },
      "owner-email": { type: "string" },
      "bot-name": { type: "string" },
      "metadata-json": { type: "string" },
      "metadata-file": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const payload = parsePartnerBootstrapPayload(parsed.values);
  const requestId = deriveRequestId(nonEmpty(parsed.values["request-id"]));
  const idempotencyKey = deriveIdempotencyKey(nonEmpty(parsed.values["idempotency-key"]));
  const api = createValidationApiClient(context, false);

  const response = await api.registerValidationBotPartnerBootstrapV2({
    xRequestId: requestId,
    idempotencyKey,
    createBotPartnerBootstrapRequest: payload,
  });

  context.emit({
    status: "ok",
    command: "register partner",
    requestId: response.requestId,
    idempotencyKey,
    bot: summarizeBot(response.bot),
    registration: summarizeRegistration(response.registration),
    issuedKey: {
      key: summarizeKey(response.issuedKey.key),
      rawKey: response.issuedKey.rawKey,
      warning: "Store this key now. It will not be shown again.",
    },
  });
}

async function runRotateKeyCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "bot-id": { type: "string" },
      reason: { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const botId = nonEmpty(parsed.values["bot-id"]);
  if (!botId) {
    throw new Error("--bot-id is required.");
  }

  const requestId = deriveRequestId(nonEmpty(parsed.values["request-id"]));
  const idempotencyKey = deriveIdempotencyKey(nonEmpty(parsed.values["idempotency-key"]));
  const reason = nonEmpty(parsed.values.reason);
  const api = createValidationApiClient(context, true);

  const response = await api.rotateValidationBotKeyV2({
    botId,
    xRequestId: requestId,
    idempotencyKey,
    createBotKeyRotationRequest: reason ? { reason } : undefined,
  });

  context.emit({
    status: "ok",
    command: "key rotate",
    requestId: response.requestId,
    idempotencyKey,
    botId: response.botId,
    issuedKey: {
      key: summarizeKey(response.issuedKey.key),
      rawKey: response.issuedKey.rawKey,
      warning: "Store this key now. It will not be shown again.",
    },
  });
}

async function runRevokeKeyCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "bot-id": { type: "string" },
      "key-id": { type: "string" },
      reason: { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const botId = nonEmpty(parsed.values["bot-id"]);
  const keyId = nonEmpty(parsed.values["key-id"]);

  if (!botId) {
    throw new Error("--bot-id is required.");
  }
  if (!keyId) {
    throw new Error("--key-id is required.");
  }

  const requestId = deriveRequestId(nonEmpty(parsed.values["request-id"]));
  const idempotencyKey = deriveIdempotencyKey(nonEmpty(parsed.values["idempotency-key"]));
  const reason = nonEmpty(parsed.values.reason);
  const api = createValidationApiClient(context, true);

  const response = await api.revokeValidationBotKeyV2({
    botId,
    keyId,
    xRequestId: requestId,
    idempotencyKey,
    createBotKeyRevocationRequest: reason ? { reason } : undefined,
  });

  context.emit({
    status: "ok",
    command: "key revoke",
    requestId: response.requestId,
    idempotencyKey,
    botId: response.botId,
    key: summarizeKey(response.key),
  });
}

function emitUsage(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "bot",
    usage: [
      "trading-cli register invite --invite-code <code> --bot-name <name>",
      "trading-cli register partner --partner-key <key> --partner-secret <secret> --owner-email <email> --bot-name <name>",
      "trading-cli key rotate --bot-id <botId> [--reason <text>]",
      "trading-cli key revoke --bot-id <botId> --key-id <keyId> [--reason <text>]",
      "trading-cli bot register invite --invite-code <code> --bot-name <name>",
      "trading-cli bot register partner --partner-key <key> --partner-secret <secret> --owner-email <email> --bot-name <name>",
      "trading-cli bot key rotate --bot-id <botId> [--reason <text>]",
      "trading-cli bot key revoke --bot-id <botId> --key-id <keyId> [--reason <text>]",
    ],
  });
}

export async function runValidationBotCommand(args: string[], context: CommandContext): Promise<void> {
  const root = args[0];
  if (!root || root === "--help" || root === "-h") {
    emitUsage(context);
    return;
  }

  if (root === "register") {
    const mode = args[1];
    if (mode === "invite" || mode === "invite-code") {
      await runRegisterInviteCommand(args.slice(2), context);
      return;
    }
    if (mode === "partner") {
      await runRegisterPartnerCommand(args.slice(2), context);
      return;
    }
    throw new Error(`Unknown register mode '${String(mode)}'. Use 'invite' or 'partner'.`);
  }

  if (root === "key") {
    const action = args[1];
    if (action === "rotate") {
      await runRotateKeyCommand(args.slice(2), context);
      return;
    }
    if (action === "revoke") {
      await runRevokeKeyCommand(args.slice(2), context);
      return;
    }
    throw new Error(`Unknown key action '${String(action)}'. Use 'rotate' or 'revoke'.`);
  }

  throw new Error(`Unknown bot command '${root}'. Use 'register' or 'key'.`);
}

import { parseArgs } from "node:util";

import {
  type CommandContext,
  deriveIdempotencyKey,
  deriveRequestId,
  nonEmpty,
  parseJsonFile,
  toSerializable,
} from "./command-utils";
import { createValidationApiClient } from "./validation-api-client";
import {
  type Bot,
  type BotKeyMetadata,
  type BotRegistration,
  type BotSummary,
  type CreateBotInviteRegistrationRequest,
  type CreateBotPartnerBootstrapRequest,
} from "./generated/trade-nexus-sdk";

type ParsedValues = ReturnType<typeof parseArgs>["values"];
const VALIDATION_BOT_REQUEST_ID_PREFIX = "req-validation-bot";
const VALIDATION_BOT_IDEMPOTENCY_KEY_PREFIX = "idem-validation-bot";

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function hasLimitFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--limit" || arg.startsWith("--limit="));
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

function summarizeBotSummary(bot: BotSummary) {
  return toSerializable(bot) as Record<string, unknown>;
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
  const requestId = deriveRequestId(
    VALIDATION_BOT_REQUEST_ID_PREFIX,
    nonEmpty(parsed.values["request-id"]),
  );
  const idempotencyKey = deriveIdempotencyKey(
    VALIDATION_BOT_IDEMPOTENCY_KEY_PREFIX,
    nonEmpty(parsed.values["idempotency-key"]),
  );
  const api = createValidationApiClient(context, { requireAuth: false });

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
  const requestId = deriveRequestId(
    VALIDATION_BOT_REQUEST_ID_PREFIX,
    nonEmpty(parsed.values["request-id"]),
  );
  const idempotencyKey = deriveIdempotencyKey(
    VALIDATION_BOT_IDEMPOTENCY_KEY_PREFIX,
    nonEmpty(parsed.values["idempotency-key"]),
  );
  const api = createValidationApiClient(context, { requireAuth: false });

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

  const requestId = deriveRequestId(
    VALIDATION_BOT_REQUEST_ID_PREFIX,
    nonEmpty(parsed.values["request-id"]),
  );
  const idempotencyKey = deriveIdempotencyKey(
    VALIDATION_BOT_IDEMPOTENCY_KEY_PREFIX,
    nonEmpty(parsed.values["idempotency-key"]),
  );
  const reason = nonEmpty(parsed.values.reason);
  const api = createValidationApiClient(context);

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

  const requestId = deriveRequestId(
    VALIDATION_BOT_REQUEST_ID_PREFIX,
    nonEmpty(parsed.values["request-id"]),
  );
  const idempotencyKey = deriveIdempotencyKey(
    VALIDATION_BOT_IDEMPOTENCY_KEY_PREFIX,
    nonEmpty(parsed.values["idempotency-key"]),
  );
  const reason = nonEmpty(parsed.values.reason);
  const api = createValidationApiClient(context);

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

async function runListBotsCommand(args: string[], context: CommandContext): Promise<void> {
  if (hasHelpFlag(args)) {
    context.emit({
      status: "ok",
      command: "bot list",
      usage: ["trading-cli bot list [--request-id <id>]"],
    });
    return;
  }

  if (hasLimitFlag(args)) {
    throw new Error("--limit is not supported for bot list.");
  }

  const parsed = parseArgs({
    args,
    options: {
      "request-id": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const requestId = deriveRequestId(
    VALIDATION_BOT_REQUEST_ID_PREFIX,
    nonEmpty(parsed.values["request-id"]),
  );
  const api = createValidationApiClient(context);
  const response = await api.listValidationBotsV2({
    xRequestId: requestId,
  });

  context.emit({
    status: "ok",
    command: "bot list",
    requestId: response.requestId,
    bots: response.bots.map((bot) => summarizeBotSummary(bot)),
    count: response.bots.length,
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
      "trading-cli bot list",
      "trading-cli bot register invite --invite-code <code> --bot-name <name>",
      "trading-cli bot register partner --partner-key <key> --partner-secret <secret> --owner-email <email> --bot-name <name>",
      "trading-cli bot key rotate --bot-id <botId> [--reason <text>]",
      "trading-cli bot key revoke --bot-id <botId> --key-id <keyId> [--reason <text>]",
    ],
  });
}

function emitRegisterUsage(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "register",
    usage: [
      "trading-cli register invite --invite-code <code> --bot-name <name>",
      "trading-cli register partner --partner-key <key> --partner-secret <secret> --owner-email <email> --bot-name <name>",
      "trading-cli bot register invite --invite-code <code> --bot-name <name>",
      "trading-cli bot register partner --partner-key <key> --partner-secret <secret> --owner-email <email> --bot-name <name>",
    ],
  });
}

function emitKeyUsage(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "key",
    usage: [
      "trading-cli key rotate --bot-id <botId> [--reason <text>]",
      "trading-cli key revoke --bot-id <botId> --key-id <keyId> [--reason <text>]",
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
    if (mode === "--help" || mode === "-h") {
      emitRegisterUsage(context);
      return;
    }
    if (!mode) {
      throw new Error("Unknown register mode. Use 'invite' or 'partner'.");
    }
    if (mode === "invite" || mode === "invite-code") {
      await runRegisterInviteCommand(args.slice(2), context);
      return;
    }
    if (mode === "partner") {
      await runRegisterPartnerCommand(args.slice(2), context);
      return;
    }
    throw new Error(`Unknown register mode '${mode}'. Use 'invite' or 'partner'.`);
  }

  if (root === "key") {
    const action = args[1];
    if (action === "--help" || action === "-h") {
      emitKeyUsage(context);
      return;
    }
    if (!action) {
      throw new Error("Unknown key action. Use 'rotate' or 'revoke'.");
    }
    if (action === "rotate") {
      await runRotateKeyCommand(args.slice(2), context);
      return;
    }
    if (action === "revoke") {
      await runRevokeKeyCommand(args.slice(2), context);
      return;
    }
    throw new Error(`Unknown key action '${action}'. Use 'rotate' or 'revoke'.`);
  }

  if (root === "list") {
    await runListBotsCommand(args.slice(1), context);
    return;
  }

  throw new Error(`Unknown bot command '${root}'. Use 'register', 'key', or 'list'.`);
}

import { parseArgs } from "node:util";

import {
  type CommandContext,
  deriveRequestId,
  formatTable,
  nonEmpty,
  parseJsonFile,
  parseOutputMode,
  toSerializable,
  type OutputMode,
  type TableRow,
} from "./command-utils";
import {
  ConversationChannel,
  ConversationRole,
  type CreateConversationSessionRequest,
  type CreateConversationTurnRequest,
} from "./generated/trade-nexus-sdk";
import { createConversationsApiClient } from "./platform-api-sdk";

type ParsedValues = ReturnType<typeof parseArgs>["values"];

type TableOutput = {
  title?: string;
  notes?: string[];
  rows: TableRow[];
  columns: string[];
  emptyMessage?: string;
};

const CONVERSATION_REQUEST_ID_PREFIX = "req-conversation";
const CHANNELS = new Set<string>(Object.values(ConversationChannel));
const ROLES = new Set<string>(Object.values(ConversationRole));

function parseRequestId(values: ParsedValues): string {
  return deriveRequestId(CONVERSATION_REQUEST_ID_PREFIX, nonEmpty(values["request-id"]));
}

function parseEnum<T extends string>(value: unknown, label: string, set: Set<string>): T | undefined {
  const raw = nonEmpty(value)?.toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (!set.has(raw)) {
    throw new Error(`${label} must be one of: ${Array.from(set).join(", ")}.`);
  }
  return raw as T;
}

function parseMetadataJson(raw: unknown, label: string): Record<string, unknown> | undefined {
  const value = nonEmpty(raw);
  if (!value) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Unable to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return parsed as Record<string, unknown>;
}

function emitOutput(
  context: CommandContext,
  output: OutputMode,
  payload: unknown,
  table?: TableOutput,
): void {
  const serial = toSerializable(payload);
  if (output === "json") {
    context.emit(serial);
    return;
  }

  if (!table) {
    console.log(JSON.stringify(serial, null, 2));
    return;
  }

  const lines: string[] = [];
  if (table.title) {
    lines.push(table.title);
  }
  if (table.notes && table.notes.length > 0) {
    lines.push(...table.notes);
  }
  if (table.rows.length === 0) {
    lines.push(table.emptyMessage ?? "(no rows)");
  } else {
    lines.push(formatTable(table.rows, table.columns));
  }
  console.log(lines.join("\n"));
}

function buildConversationSessionRow(session: Record<string, unknown>): TableRow {
  return {
    id: session.id as string,
    channel: session.channel as string,
    status: session.status as string,
    topic: session.topic as string | null | undefined,
    lastTurnAt: session.lastTurnAt as string | null | undefined,
    updatedAt: session.updatedAt as string,
  };
}

function buildConversationTurnRow(turn: Record<string, unknown>): TableRow {
  const suggestions = (turn.suggestions as unknown[]) ?? [];
  return {
    id: turn.id as string,
    sessionId: turn.sessionId as string,
    role: turn.role as string,
    message: turn.message as string,
    suggestions: suggestions.length,
    createdAt: turn.createdAt as string,
  };
}

function parseCreateSessionPayload(values: ParsedValues): CreateConversationSessionRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateConversationSessionRequest>(inputPath, "conversation session payload");
  }

  const channel = parseEnum<ConversationChannel>(values.channel, "--channel", CHANNELS);
  if (!channel) {
    throw new Error("--channel is required when --input is not provided.");
  }

  const topic = nonEmpty(values.topic);
  const metadata = parseMetadataJson(values["metadata-json"], "--metadata-json");
  return {
    channel,
    ...(topic ? { topic } : {}),
    ...(metadata ? { metadata } : {}),
  };
}

function parseCreateTurnPayload(values: ParsedValues): CreateConversationTurnRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateConversationTurnRequest>(inputPath, "conversation turn payload");
  }

  const role = parseEnum<ConversationRole>(values.role, "--role", ROLES);
  if (!role) {
    throw new Error("--role is required when --input is not provided.");
  }

  const message = nonEmpty(values.message);
  if (!message) {
    throw new Error("--message is required when --input is not provided.");
  }

  const metadata = parseMetadataJson(values["metadata-json"], "--metadata-json");
  return {
    role,
    message,
    ...(metadata ? { metadata } : {}),
  };
}

async function runConversationSessionCreate(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      channel: { type: "string" },
      topic: { type: "string" },
      "metadata-json": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const output = parseOutputMode(parsed.values.output);
  const api = createConversationsApiClient(context);
  const response = await api.createConversationSessionV2({
    createConversationSessionRequest: parseCreateSessionPayload(parsed.values),
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const session = serial.session as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "conversation session create",
      ...serial,
    },
    {
      title: "conversation session create",
      notes: [`requestId: ${response.requestId}`],
      rows: [buildConversationSessionRow(session)],
      columns: ["id", "channel", "status", "topic", "lastTurnAt", "updatedAt"],
    },
  );
}

async function runConversationSessionGet(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "session-id": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const sessionId = nonEmpty(parsed.values["session-id"]);
  if (!sessionId) {
    throw new Error("--session-id is required.");
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createConversationsApiClient(context);
  const response = await api.getConversationSessionV2({
    sessionId,
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const session = serial.session as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "conversation session get",
      ...serial,
    },
    {
      title: "conversation session get",
      notes: [`requestId: ${response.requestId}`],
      rows: [buildConversationSessionRow(session)],
      columns: ["id", "channel", "status", "topic", "lastTurnAt", "updatedAt"],
    },
  );
}

async function runConversationTurnCreate(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "session-id": { type: "string" },
      input: { type: "string" },
      role: { type: "string" },
      message: { type: "string" },
      "metadata-json": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const sessionId = nonEmpty(parsed.values["session-id"]);
  if (!sessionId) {
    throw new Error("--session-id is required.");
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createConversationsApiClient(context);
  const response = await api.createConversationTurnV2({
    sessionId,
    createConversationTurnRequest: parseCreateTurnPayload(parsed.values),
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const turn = serial.turn as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "conversation turn create",
      ...serial,
    },
    {
      title: "conversation turn create",
      notes: [`requestId: ${response.requestId}`],
      rows: [buildConversationTurnRow(turn)],
      columns: ["id", "sessionId", "role", "message", "suggestions", "createdAt"],
    },
  );
}

function emitConversationHelp(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "conversation",
    usage: [
      "trading-cli conversation session create --channel cli|web|openclaw [--topic <text>] [--metadata-json '{...}'] [--output json|table]",
      "trading-cli conversation session get --session-id <id> [--output json|table]",
      "trading-cli conversation turn create --session-id <id> --role user|assistant|system --message <text> [--metadata-json '{...}'] [--output json|table]",
    ],
  });
}

export async function runConversationCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    emitConversationHelp(context);
    return;
  }

  if (subcommand === "session") {
    const action = args[1];
    if (!action || action === "--help" || action === "-h") {
      emitConversationHelp(context);
      return;
    }
    if (action === "create") {
      await runConversationSessionCreate(args.slice(2), context);
      return;
    }
    if (action === "get") {
      await runConversationSessionGet(args.slice(2), context);
      return;
    }
    throw new Error(`Unknown conversation session subcommand '${action}'. Use 'create' or 'get'.`);
  }

  if (subcommand === "turn") {
    const action = args[1];
    if (!action || action === "--help" || action === "-h") {
      emitConversationHelp(context);
      return;
    }
    if (action !== "create") {
      throw new Error("conversation turn supports only 'create'.");
    }
    await runConversationTurnCreate(args.slice(2), context);
    return;
  }

  throw new Error(`Unknown conversation subcommand '${subcommand}'. Use 'session' or 'turn'.`);
}

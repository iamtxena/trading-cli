import { parseArgs } from "node:util";

import {
  type CommandContext,
  deriveIdempotencyKey,
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
  ValidationDecision,
  ValidationReviewDecisionAction,
  ValidationRunStatus,
  ValidationSharePermission,
  type AcceptValidationInviteRequest,
  type CreateConversationSessionRequest,
  type CreateConversationTurnRequest,
  type CreateValidationInviteRequest,
  type CreateValidationReviewCommentRequest,
  type CreateValidationReviewDecisionRequest,
} from "./generated/trade-nexus-sdk";
import {
  createConversationsApiClient,
  createSharedValidationApiClient,
  createValidationApiClient,
} from "./platform-api-sdk";

type ParsedValues = ReturnType<typeof parseArgs>["values"];

const SHARED_REQUEST_ID_PREFIX = "req-shared";
const SHARED_IDEMPOTENCY_PREFIX = "idem-shared";

const RUN_STATUSES = new Set<string>(Object.values(ValidationRunStatus));
const FINAL_DECISIONS = new Set<string>(Object.values(ValidationDecision));
const PERMISSIONS = new Set<string>(Object.values(ValidationSharePermission));
const REVIEW_ACTIONS = new Set<string>(Object.values(ValidationReviewDecisionAction));
const CHANNELS = new Set<string>(Object.values(ConversationChannel));
const ROLES = new Set<string>(Object.values(ConversationRole));

type TableOutput = {
  title?: string;
  notes?: string[];
  rows: TableRow[];
  columns: string[];
  emptyMessage?: string;
};

function parseRequestId(values: ParsedValues): string {
  return deriveRequestId(SHARED_REQUEST_ID_PREFIX, nonEmpty(values["request-id"]));
}

function parseIdempotencyKey(values: ParsedValues): string {
  return deriveIdempotencyKey(
    SHARED_IDEMPOTENCY_PREFIX,
    nonEmpty(values["idempotency-key"]),
  );
}

function parseCsv(value: unknown): string[] {
  const raw = nonEmpty(value);
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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

function parseLimit(value: unknown): number | undefined {
  const raw = nonEmpty(value);
  if (!raw) {
    return undefined;
  }
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100.");
  }
  return limit;
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

function buildRunTableRow(run: Record<string, unknown>): TableRow {
  return {
    runId: run.id as string,
    status: run.status as string,
    profile: run.profile as string,
    finalDecision: run.finalDecision as string,
    createdAt: run.createdAt as string,
    updatedAt: run.updatedAt as string,
  };
}

function buildInviteTableRow(invite: Record<string, unknown>): TableRow {
  return {
    id: invite.id as string,
    runId: invite.runId as string,
    email: invite.email as string,
    permission: invite.permission as string,
    status: invite.status as string,
    createdAt: invite.createdAt as string,
    expiresAt: invite.expiresAt as string | null | undefined,
  };
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

async function runSharedWithMeCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      status: { type: "string" },
      "final-decision": { type: "string" },
      permission: { type: "string" },
      cursor: { type: "string" },
      limit: { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const status = parseEnum<ValidationRunStatus>(parsed.values.status, "--status", RUN_STATUSES);
  const finalDecision = parseEnum<ValidationDecision>(
    parsed.values["final-decision"],
    "--final-decision",
    FINAL_DECISIONS,
  );
  const permission = parseEnum<ValidationSharePermission>(
    parsed.values.permission,
    "--permission",
    PERMISSIONS,
  );
  const limit = parseLimit(parsed.values.limit);
  const output = parseOutputMode(parsed.values.output);

  const api = createSharedValidationApiClient(context);
  const response = await api.listValidationRunsSharedWithMeV2({
    xRequestId: parseRequestId(parsed.values),
    status,
    finalDecision,
    permission,
    cursor: nonEmpty(parsed.values.cursor),
    limit,
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const items = (serial.items as Record<string, unknown>[]) ?? [];
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "shared-validation shared-with-me",
      ...serial,
    },
    {
      title: "shared-validation shared-with-me",
      notes: [
        `requestId: ${response.requestId}`,
        `nextCursor: ${response.nextCursor ?? "-"}`,
      ],
      rows: items.map((item) => ({
        runId: item.runId as string,
        permission: item.permission as string,
        status: item.status as string,
        profile: item.profile as string,
        finalDecision: item.finalDecision as string,
        ownerUserId: item.ownerUserId as string,
        updatedAt: item.updatedAt as string,
      })),
      columns: [
        "runId",
        "permission",
        "status",
        "profile",
        "finalDecision",
        "ownerUserId",
        "updatedAt",
      ],
      emptyMessage: "No shared validation runs found.",
    },
  );
}

async function runSharedRunGetCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createValidationApiClient(context);
  const response = await api.getValidationRunV2({
    runId,
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const run = serial.run as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "shared-validation run",
      ...serial,
    },
    {
      title: "shared-validation run",
      notes: [`requestId: ${response.requestId}`],
      rows: [buildRunTableRow(run)],
      columns: ["runId", "status", "profile", "finalDecision", "createdAt", "updatedAt"],
    },
  );
}

async function runSharedArtifactCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }
  const output = parseOutputMode(parsed.values.output);
  const api = createValidationApiClient(context);
  const response = await api.getValidationRunArtifactV2({
    runId,
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "shared-validation artifact",
      ...serial,
    },
    {
      title: "shared-validation artifact",
      notes: [`requestId: ${response.requestId}`],
      rows: [
        {
          artifactType: serial.artifactType as string,
          runId,
        },
      ],
      columns: ["runId", "artifactType"],
    },
  );
}

function parseReviewCommentRequest(values: ParsedValues): CreateValidationReviewCommentRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationReviewCommentRequest>(
      inputPath,
      "shared-validation review comment payload",
    );
  }
  const body = nonEmpty(values.body);
  if (!body) {
    throw new Error("--body is required when --input is not provided.");
  }
  const evidenceRefs = parseCsv(values["evidence-refs"]);
  return {
    body,
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  };
}

function parseReviewDecisionRequest(values: ParsedValues): CreateValidationReviewDecisionRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationReviewDecisionRequest>(
      inputPath,
      "shared-validation review decision payload",
    );
  }

  const action = parseEnum<ValidationReviewDecisionAction>(
    values.action,
    "--action",
    REVIEW_ACTIONS,
  );
  const decision = parseEnum<ValidationDecision>(
    values.decision,
    "--decision",
    FINAL_DECISIONS,
  );
  const reason = nonEmpty(values.reason);

  if (!action) {
    throw new Error("--action is required when --input is not provided.");
  }
  if (!decision) {
    throw new Error("--decision is required when --input is not provided.");
  }
  if (!reason) {
    throw new Error("--reason is required when --input is not provided.");
  }
  const evidenceRefs = parseCsv(values["evidence-refs"]);
  return {
    action,
    decision,
    reason,
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  };
}

async function runSharedReviewCommentCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      input: { type: "string" },
      body: { type: "string" },
      "evidence-refs": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }
  const output = parseOutputMode(parsed.values.output);
  const api = createSharedValidationApiClient(context);
  const response = await api.createSharedValidationReviewCommentV2({
    runId,
    idempotencyKey: parseIdempotencyKey(parsed.values),
    xRequestId: parseRequestId(parsed.values),
    createValidationReviewCommentRequest: parseReviewCommentRequest(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const comment = serial.comment as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "shared-validation review-comment",
      ...serial,
    },
    {
      title: "shared-validation review-comment",
      notes: [`requestId: ${response.requestId}`],
      rows: [
        {
          runId: serial.runId as string,
          commentId: comment.id as string,
          accepted: serial.commentAccepted as boolean,
        },
      ],
      columns: ["runId", "commentId", "accepted"],
    },
  );
}

async function runSharedReviewDecisionCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      input: { type: "string" },
      action: { type: "string" },
      decision: { type: "string" },
      reason: { type: "string" },
      "evidence-refs": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }
  const output = parseOutputMode(parsed.values.output);
  const api = createSharedValidationApiClient(context);
  const response = await api.createSharedValidationReviewDecisionV2({
    runId,
    idempotencyKey: parseIdempotencyKey(parsed.values),
    xRequestId: parseRequestId(parsed.values),
    createValidationReviewDecisionRequest: parseReviewDecisionRequest(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const decision = serial.decision as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "shared-validation review-decision",
      ...serial,
    },
    {
      title: "shared-validation review-decision",
      notes: [`requestId: ${response.requestId}`],
      rows: [
        {
          runId: serial.runId as string,
          decisionId: decision.id as string,
          accepted: serial.decisionAccepted as boolean,
        },
      ],
      columns: ["runId", "decisionId", "accepted"],
    },
  );
}

function emitSharedValidationHelp(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "shared-validation",
    usage: [
      "trading-cli shared-validation shared-with-me [--permission view|review] [--status queued|running|completed|failed] [--final-decision pass|conditional_pass|fail] [--output json|table]",
      "trading-cli shared-validation run --run-id <id> [--output json|table]",
      "trading-cli shared-validation artifact --run-id <id> [--output json|table]",
      "trading-cli shared-validation review-comment --run-id <id> --body <text> [--evidence-refs <csv>] [--output json|table]",
      "trading-cli shared-validation review-decision --run-id <id> --action approve|reject --decision pass|conditional_pass|fail --reason <text> [--output json|table]",
    ],
  });
}

async function runSharedValidationCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    emitSharedValidationHelp(context);
    return;
  }

  if (subcommand === "shared-with-me" || subcommand === "list") {
    await runSharedWithMeCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "run") {
    await runSharedRunGetCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "artifact") {
    await runSharedArtifactCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "review-comment" || subcommand === "comment") {
    await runSharedReviewCommentCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "review-decision" || subcommand === "decision") {
    await runSharedReviewDecisionCommand(args.slice(1), context);
    return;
  }

  throw new Error(
    `Unknown shared-validation subcommand '${subcommand}'. Use 'shared-with-me', 'run', 'artifact', 'review-comment', or 'review-decision'.`,
  );
}

function parseCreateInvitePayload(values: ParsedValues): CreateValidationInviteRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationInviteRequest>(inputPath, "invite create payload");
  }

  const email = nonEmpty(values.email);
  if (!email) {
    throw new Error("--email is required when --input is not provided.");
  }
  const permission = parseEnum<ValidationSharePermission>(
    values.permission,
    "--permission",
    PERMISSIONS,
  );
  const message = nonEmpty(values.message);
  const expiresAtRaw = nonEmpty(values["expires-at"]);
  let expiresAt: Date | undefined;
  if (expiresAtRaw) {
    expiresAt = new Date(expiresAtRaw);
    if (Number.isNaN(expiresAt.getTime())) {
      throw new Error("--expires-at must be an ISO timestamp.");
    }
  }

  return {
    email,
    ...(permission ? { permission } : {}),
    ...(message ? { message } : {}),
    ...(expiresAt ? { expiresAt } : {}),
  };
}

function parseAcceptInvitePayload(values: ParsedValues): AcceptValidationInviteRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<AcceptValidationInviteRequest>(inputPath, "invite accept payload");
  }

  const acceptedEmail = nonEmpty(values["accepted-email"]);
  if (!acceptedEmail) {
    throw new Error("--accepted-email is required when --input is not provided.");
  }
  const loginSessionId = nonEmpty(values["login-session-id"]);
  return {
    acceptedEmail,
    ...(loginSessionId ? { loginSessionId } : {}),
  };
}

async function runInviteCreateCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      input: { type: "string" },
      email: { type: "string" },
      permission: { type: "string" },
      message: { type: "string" },
      "expires-at": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }
  const output = parseOutputMode(parsed.values.output);
  const api = createValidationApiClient(context);
  const response = await api.createValidationRunInviteV2({
    runId,
    idempotencyKey: parseIdempotencyKey(parsed.values),
    xRequestId: parseRequestId(parsed.values),
    createValidationInviteRequest: parseCreateInvitePayload(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const invite = serial.invite as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "invite create",
      ...serial,
    },
    {
      title: "invite create",
      notes: [`requestId: ${response.requestId}`],
      rows: [buildInviteTableRow(invite)],
      columns: ["id", "runId", "email", "permission", "status", "createdAt", "expiresAt"],
    },
  );
}

async function runInviteListCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      cursor: { type: "string" },
      limit: { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }
  const output = parseOutputMode(parsed.values.output);
  const api = createValidationApiClient(context);
  const response = await api.listValidationRunInvitesV2({
    runId,
    xRequestId: parseRequestId(parsed.values),
    cursor: nonEmpty(parsed.values.cursor),
    limit: parseLimit(parsed.values.limit),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const items = (serial.items as Record<string, unknown>[]) ?? [];
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "invite list",
      ...serial,
    },
    {
      title: "invite list",
      notes: [`requestId: ${response.requestId}`, `nextCursor: ${response.nextCursor ?? "-"}`],
      rows: items.map((invite) => buildInviteTableRow(invite)),
      columns: ["id", "runId", "email", "permission", "status", "createdAt", "expiresAt"],
      emptyMessage: "No invites found.",
    },
  );
}

async function runInviteAcceptCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "invite-id": { type: "string" },
      input: { type: "string" },
      "accepted-email": { type: "string" },
      "login-session-id": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const inviteId = nonEmpty(parsed.values["invite-id"]);
  if (!inviteId) {
    throw new Error("--invite-id is required.");
  }
  const output = parseOutputMode(parsed.values.output);
  const api = createValidationApiClient(context);
  const response = await api.acceptValidationInviteOnLoginV2({
    inviteId,
    idempotencyKey: parseIdempotencyKey(parsed.values),
    xRequestId: parseRequestId(parsed.values),
    acceptValidationInviteRequest: parseAcceptInvitePayload(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const invite = serial.invite as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "invite accept",
      ...serial,
    },
    {
      title: "invite accept",
      notes: [`requestId: ${response.requestId}`],
      rows: [buildInviteTableRow(invite)],
      columns: ["id", "runId", "email", "permission", "status", "createdAt", "expiresAt"],
    },
  );
}

async function runInviteRevokeCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "invite-id": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });
  const inviteId = nonEmpty(parsed.values["invite-id"]);
  if (!inviteId) {
    throw new Error("--invite-id is required.");
  }
  const output = parseOutputMode(parsed.values.output);
  const api = createValidationApiClient(context);
  const response = await api.revokeValidationInviteV2({
    inviteId,
    idempotencyKey: parseIdempotencyKey(parsed.values),
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const invite = serial.invite as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "invite revoke",
      ...serial,
    },
    {
      title: "invite revoke",
      notes: [`requestId: ${response.requestId}`],
      rows: [buildInviteTableRow(invite)],
      columns: ["id", "runId", "email", "permission", "status", "createdAt", "expiresAt"],
    },
  );
}

function emitInviteHelp(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "invite",
    usage: [
      "trading-cli invite create --run-id <id> --email <email> [--permission view|review] [--message <text>] [--expires-at <iso>] [--output json|table]",
      "trading-cli invite list --run-id <id> [--limit 20] [--cursor <token>] [--output json|table]",
      "trading-cli invite accept --invite-id <id> --accepted-email <email> [--login-session-id <id>] [--output json|table]",
      "trading-cli invite revoke --invite-id <id> [--output json|table]",
    ],
  });
}

async function runInviteCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    emitInviteHelp(context);
    return;
  }
  if (subcommand === "create") {
    await runInviteCreateCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "list") {
    await runInviteListCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "accept") {
    await runInviteAcceptCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "revoke") {
    await runInviteRevokeCommand(args.slice(1), context);
    return;
  }
  throw new Error(`Unknown invite subcommand '${subcommand}'. Use 'create', 'list', 'accept', or 'revoke'.`);
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
  const message = nonEmpty(values.message);
  if (!role) {
    throw new Error("--role is required when --input is not provided.");
  }
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

async function runConversationCommand(args: string[], context: CommandContext): Promise<void> {
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

export async function runSharedCommand(args: string[], context: CommandContext): Promise<void> {
  const group = args[0];
  if (!group || group === "--help" || group === "-h") {
    context.emit({
      status: "ok",
      command: "shared",
      groups: ["shared-validation", "invite", "conversation"],
    });
    return;
  }

  if (group === "shared-validation") {
    await runSharedValidationCommand(args.slice(1), context);
    return;
  }
  if (group === "invite") {
    await runInviteCommand(args.slice(1), context);
    return;
  }
  if (group === "conversation" || group === "conversations") {
    await runConversationCommand(args.slice(1), context);
    return;
  }

  throw new Error(`Unsupported shared command group '${group}'.`);
}

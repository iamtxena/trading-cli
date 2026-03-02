import { parseArgs } from "node:util";

import {
  type CommandContext,
  deriveIdempotencyKey,
  deriveRequestId,
  nonEmpty,
  parseJsonFile,
  toSerializable,
  trimTrailingSlash,
} from "./command-utils";
import { createValidationApiClient } from "./validation-api-client";
import {
  CreateValidationRunReviewRequestReviewerTypeEnum,
  FetchError,
  RequiredError,
  ResponseError,
  ValidationDecision,
  ValidationProfile,
  ValidationRenderFormat,
  ValidationReviewDecisionAction,
  ValidationRunDecision,
  ValidationRunStatus,
  type CreateValidationBaselineRequest,
  type CreateValidationRegressionReplayRequest,
  type CreateValidationReviewCommentRequest,
  type CreateValidationReviewDecisionRequest,
  type CreateValidationRunRequest,
  type CreateValidationRunReviewRequest,
  type ValidationReviewFinding,
  type ValidationRun,
  type ValidationReviewRunDetailResponse,
  type ValidationReviewRunSummary,
} from "./generated/trade-nexus-sdk";

const DEFAULT_REVIEW_WEB_BASE_URL = "https://trade-nexus.lona.agency";
const REVIEW_WEB_PATH = "/validation";
const REVIEW_RUN_REQUEST_ID_PREFIX = "req-review-run";
const REVIEW_RUN_IDEMPOTENCY_KEY_PREFIX = "idem-review-run";

const VALID_PROFILES = new Set<string>(Object.values(ValidationProfile));
const VALID_RENDER_FORMATS = new Set<string>(Object.values(ValidationRenderFormat));
const VALID_RUN_STATUSES = new Set<string>(Object.values(ValidationRunStatus));
const VALID_RUN_DECISIONS = new Set<string>(Object.values(ValidationRunDecision));
const VALID_REVIEW_DECISIONS = new Set<string>(Object.values(ValidationDecision));
const VALID_REVIEW_ACTIONS = new Set<string>(Object.values(ValidationReviewDecisionAction));
const VALID_REVIEWER_TYPES = new Set<string>(
  Object.values(CreateValidationRunReviewRequestReviewerTypeEnum),
);

type ParsedValues = ReturnType<typeof parseArgs>["values"];

type ReviewWebLink = {
  runId: string;
  path: string;
  url: string;
  fallbackUrl: string;
};

function withFallbackMessage(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  return fallback;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseProfile(value: unknown): ValidationProfile {
  const profile = nonEmpty(value)?.toUpperCase();
  if (!profile) {
    return ValidationProfile.Standard;
  }
  if (!VALID_PROFILES.has(profile)) {
    throw new Error(
      `Unsupported --profile value '${value}'. Expected one of: ${Object.values(ValidationProfile).join(
        ", ",
      )}.`,
    );
  }
  return profile as ValidationProfile;
}

function parseRenderFormats(value: unknown): ValidationRenderFormat[] {
  const formats = parseCsv(nonEmpty(value));
  if (formats.length === 0) {
    return [];
  }
  for (const format of formats) {
    if (!VALID_RENDER_FORMATS.has(format)) {
      throw new Error(
        `Unsupported render format '${format}'. Expected one of: ${Object.values(ValidationRenderFormat).join(
          ", ",
        )}.`,
      );
    }
  }
  return [...new Set(formats)] as ValidationRenderFormat[];
}

function parseRenderFormat(
  value: unknown,
  optionName = "--render-format",
): ValidationRenderFormat | undefined {
  const values = parseRenderFormats(value);
  if (values.length === 0) {
    return undefined;
  }
  if (values.length > 1) {
    throw new Error(`${optionName} accepts a single value (html or pdf).`);
  }
  return values[0];
}

function parseStatusFilter(value: unknown): ValidationRunStatus | undefined {
  const status = nonEmpty(value)?.toLowerCase();
  if (!status) {
    return undefined;
  }
  if (!VALID_RUN_STATUSES.has(status)) {
    throw new Error(
      `Unsupported --status value '${value}'. Expected one of: ${Object.values(ValidationRunStatus).join(
        ", ",
      )}.`,
    );
  }
  return status as ValidationRunStatus;
}

function parseFinalDecisionFilter(value: unknown): ValidationRunDecision | undefined {
  const decision = nonEmpty(value)?.toLowerCase();
  if (!decision) {
    return undefined;
  }
  if (!VALID_RUN_DECISIONS.has(decision)) {
    throw new Error(
      `Unsupported --final-decision value '${value}'. Expected one of: ${Object.values(
        ValidationRunDecision,
      ).join(", ")}.`,
    );
  }
  return decision as ValidationRunDecision;
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

function parseReviewDecision(value: unknown): ValidationDecision | undefined {
  const decision = nonEmpty(value)?.toLowerCase();
  if (!decision) {
    return undefined;
  }
  if (!VALID_REVIEW_DECISIONS.has(decision)) {
    throw new Error(
      `Unsupported --decision value '${value}'. Expected one of: ${Object.values(
        ValidationDecision,
      ).join(", ")}.`,
    );
  }
  return decision as ValidationDecision;
}

function parseReviewAction(value: unknown): ValidationReviewDecisionAction | undefined {
  const action = nonEmpty(value)?.toLowerCase();
  if (!action) {
    return undefined;
  }
  if (!VALID_REVIEW_ACTIONS.has(action)) {
    throw new Error(
      `Unsupported --action value '${value}'. Expected one of: ${Object.values(
        ValidationReviewDecisionAction,
      ).join(", ")}.`,
    );
  }
  return action as ValidationReviewDecisionAction;
}

function parseReviewerType(
  value: unknown,
): CreateValidationRunReviewRequestReviewerTypeEnum | undefined {
  const reviewerType = nonEmpty(value)?.toLowerCase();
  if (!reviewerType) {
    return undefined;
  }
  if (!VALID_REVIEWER_TYPES.has(reviewerType)) {
    throw new Error(
      `Unsupported --reviewer-type value '${value}'. Expected one of: ${Object.values(
        CreateValidationRunReviewRequestReviewerTypeEnum,
      ).join(", ")}.`,
    );
  }
  return reviewerType as CreateValidationRunReviewRequestReviewerTypeEnum;
}

function parseJsonArray(value: string, label: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(
      `Unable to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON array.`);
  }
  return parsed;
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
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

function parseJsonObjectFile(path: string, label: string): Record<string, unknown> {
  const parsed = parseJsonFile<unknown>(path, label);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function parseFindingsEntry(value: unknown, index: number): ValidationReviewFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`--findings entry at index ${index} must be a JSON object.`);
  }

  const record = value as Record<string, unknown>;
  const id = nonEmpty(record.id);
  const summary = nonEmpty(record.summary);
  const priority = record.priority;
  const confidence = record.confidence;
  const evidenceRefs = record.evidenceRefs;

  if (!id) {
    throw new Error(`--findings entry at index ${index} is missing non-empty 'id'.`);
  }
  if (typeof priority !== "number" || !Number.isFinite(priority)) {
    throw new Error(`--findings entry at index ${index} has invalid numeric 'priority'.`);
  }
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    throw new Error(`--findings entry at index ${index} has invalid numeric 'confidence'.`);
  }
  if (!summary) {
    throw new Error(`--findings entry at index ${index} is missing non-empty 'summary'.`);
  }
  if (!Array.isArray(evidenceRefs) || evidenceRefs.some((item) => nonEmpty(item) === undefined)) {
    throw new Error(`--findings entry at index ${index} has invalid 'evidenceRefs' array.`);
  }

  return {
    id,
    priority,
    confidence,
    summary,
    evidenceRefs: evidenceRefs.map((item) => String(item)),
  };
}

function parseFindings(values: ParsedValues): ValidationReviewFinding[] | undefined {
  const findingsJson = nonEmpty(values["findings-json"]);
  const findingsFile = nonEmpty(values["findings-file"]);

  if (findingsJson && findingsFile) {
    throw new Error("Specify only one of --findings-json or --findings-file.");
  }

  if (!findingsJson && !findingsFile) {
    return undefined;
  }

  const rawFindings = findingsJson
    ? parseJsonArray(findingsJson, "--findings-json")
    : parseJsonFile<unknown[]>(findingsFile as string, "--findings-file");

  if (!Array.isArray(rawFindings)) {
    throw new Error("--findings-file must contain a JSON array.");
  }

  return rawFindings.map((entry, index) => parseFindingsEntry(entry, index));
}

function defaultValidationPolicy(profile: ValidationProfile) {
  return {
    profile,
    blockMergeOnFail: true,
    blockReleaseOnFail: true,
    blockMergeOnAgentFail: true,
    blockReleaseOnAgentFail: false,
    requireTraderReview: true,
    hardFailOnMissingIndicators: true,
    failClosedOnEvidenceUnavailable: true,
  };
}

function buildCreateValidationRunRequest(values: ParsedValues): CreateValidationRunRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationRunRequest>(inputPath, "review-run trigger payload");
  }

  const strategyId = nonEmpty(values["strategy-id"]);
  if (!strategyId) {
    throw new Error("--strategy-id is required when --input is not provided.");
  }

  const requestedIndicators = parseCsv(nonEmpty(values["requested-indicators"]));
  if (requestedIndicators.length === 0) {
    throw new Error("--requested-indicators must contain at least one comma-separated indicator.");
  }

  const datasetIds = parseCsv(nonEmpty(values["dataset-ids"]));
  if (datasetIds.length === 0) {
    throw new Error("--dataset-ids must contain at least one comma-separated dataset id.");
  }

  const backtestReportRef = nonEmpty(values["backtest-report-ref"]);
  if (!backtestReportRef) {
    throw new Error("--backtest-report-ref is required when --input is not provided.");
  }

  const profile = parseProfile(values.profile);

  return {
    strategyId,
    providerRefId: nonEmpty(values["provider-ref-id"]),
    prompt: nonEmpty(values.prompt),
    requestedIndicators,
    datasetIds,
    backtestReportRef,
    policy: defaultValidationPolicy(profile),
  };
}

function buildReviewWebLink(reviewWebBaseUrl: string, runId: string): ReviewWebLink {
  const normalizedBase = trimTrailingSlash(reviewWebBaseUrl);
  const path = `${REVIEW_WEB_PATH}?runId=${encodeURIComponent(runId)}`;
  return {
    runId,
    path,
    url: `${normalizedBase}${path}`,
    fallbackUrl: `${normalizedBase}${REVIEW_WEB_PATH}`,
  };
}

function resolveReviewWebBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured =
    nonEmpty(env.REVIEW_WEB_BASE_URL) ??
    nonEmpty(env.TRADE_NEXUS_WEB_BASE_URL) ??
    DEFAULT_REVIEW_WEB_BASE_URL;

  let parsed: URL;
  try {
    parsed = new URL(configured);
  } catch {
    throw new Error("REVIEW_WEB_BASE_URL must be an absolute http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("REVIEW_WEB_BASE_URL must be an absolute http(s) URL.");
  }

  return trimTrailingSlash(parsed.toString());
}

function summarizeReviewArtifact(response: ValidationReviewRunDetailResponse) {
  const artifact = response.artifact;
  const run = artifact.run;
  const persistedArtifact = artifact.artifact;
  const traderReview = persistedArtifact.traderReview;
  return {
    runId: run.id,
    status: run.status,
    profile: run.profile,
    finalDecision: persistedArtifact.finalDecision,
    traderReviewStatus: traderReview.status,
    commentCount: traderReview.comments.length,
    pendingDecision: traderReview.status === "requested",
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    schemaVersion: artifact.schemaVersion,
    renderCount: artifact.renders.length,
  };
}

function summarizeReviewListItem(item: ValidationReviewRunSummary, reviewWebBaseUrl: string) {
  return {
    id: item.id,
    status: item.status,
    profile: item.profile,
    finalDecision: item.finalDecision,
    traderReviewStatus: item.traderReviewStatus,
    commentCount: item.commentCount,
    pendingDecision: item.pendingDecision,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    reviewWeb: buildReviewWebLink(reviewWebBaseUrl, item.id),
  };
}

function summarizeValidationRun(run: ValidationRun) {
  return {
    id: run.id,
    status: run.status,
    profile: run.profile,
    schemaVersion: run.schemaVersion,
    finalDecision: run.finalDecision,
    actor: run.actor ? toSerializable(run.actor) : null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

function parseReviewSubmissionRequest(values: ParsedValues): CreateValidationRunReviewRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationRunReviewRequest>(inputPath, "review-run review payload");
  }

  const reviewerType = parseReviewerType(values["reviewer-type"]);
  if (!reviewerType) {
    throw new Error("--reviewer-type is required when --input is not provided.");
  }

  const decision = parseReviewDecision(values.decision);
  if (!decision) {
    throw new Error("--decision is required when --input is not provided.");
  }

  const summary = nonEmpty(values.summary);
  const comments = parseCsv(nonEmpty(values.comments));
  const findings = parseFindings(values);

  return {
    reviewerType,
    decision,
    ...(summary ? { summary } : {}),
    ...(findings && findings.length > 0 ? { findings } : {}),
    ...(comments.length > 0 ? { comments } : {}),
  };
}

function parseReviewCommentRequest(values: ParsedValues): CreateValidationReviewCommentRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationReviewCommentRequest>(
      inputPath,
      "review-run review-comment payload",
    );
  }

  const body = nonEmpty(values.body);
  if (!body) {
    throw new Error("--body is required when --input is not provided.");
  }

  const evidenceRefs = parseCsv(nonEmpty(values["evidence-refs"]));
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
      "review-run review-decision payload",
    );
  }

  const action = parseReviewAction(values.action);
  const decision = parseReviewDecision(values.decision);
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

  const evidenceRefs = parseCsv(nonEmpty(values["evidence-refs"]));

  return {
    action,
    decision,
    reason,
    ...(evidenceRefs.length > 0 ? { evidenceRefs } : {}),
  };
}

function parseBaselineRequest(values: ParsedValues): CreateValidationBaselineRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationBaselineRequest>(inputPath, "review-run baseline payload");
  }

  const runId = nonEmpty(values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required when --input is not provided.");
  }

  const name = nonEmpty(values.name);
  if (!name) {
    throw new Error("--name is required when --input is not provided.");
  }

  const notes = nonEmpty(values.notes);

  return {
    runId,
    name,
    ...(notes ? { notes } : {}),
  };
}

function parseReplayRequest(values: ParsedValues): CreateValidationRegressionReplayRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateValidationRegressionReplayRequest>(inputPath, "review-run replay payload");
  }

  const baselineId = nonEmpty(values["baseline-id"]);
  if (!baselineId) {
    throw new Error("--baseline-id is required when --input is not provided.");
  }

  const candidateRunId = nonEmpty(values["candidate-run-id"]);
  if (!candidateRunId) {
    throw new Error("--candidate-run-id is required when --input is not provided.");
  }

  const policyOverridesJson = nonEmpty(values["policy-overrides-json"]);
  const policyOverridesFile = nonEmpty(values["policy-overrides-file"]);

  if (policyOverridesJson && policyOverridesFile) {
    throw new Error("Specify only one of --policy-overrides-json or --policy-overrides-file.");
  }

  const policyOverrides = policyOverridesJson
    ? parseJsonObject(policyOverridesJson, "--policy-overrides-json")
    : policyOverridesFile
      ? parseJsonObjectFile(policyOverridesFile, "--policy-overrides-file")
      : undefined;

  return {
    baselineId,
    candidateRunId,
    ...(policyOverrides ? { policyOverrides } : {}),
  };
}

function parseCommonHeaders(values: ParsedValues): {
  requestId: string;
  idempotencyKey: string;
} {
  return {
    requestId: deriveRequestId(REVIEW_RUN_REQUEST_ID_PREFIX, nonEmpty(values["request-id"])),
    idempotencyKey: deriveIdempotencyKey(
      REVIEW_RUN_IDEMPOTENCY_KEY_PREFIX,
      nonEmpty(values["idempotency-key"]),
    ),
  };
}

async function runTriggerCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      "strategy-id": { type: "string" },
      "provider-ref-id": { type: "string" },
      prompt: { type: "string" },
      "requested-indicators": { type: "string" },
      "dataset-ids": { type: "string" },
      "backtest-report-ref": { type: "string" },
      profile: { type: "string" },
      render: { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const payload = buildCreateValidationRunRequest(parsed.values);
  const renderFormats = parseRenderFormats(parsed.values.render);
  const { requestId, idempotencyKey } = parseCommonHeaders(parsed.values);

  const api = createValidationApiClient(context);
  const reviewWebBaseUrl = resolveReviewWebBaseUrl(context.env);

  const runResponse = await api.createValidationRunV2({
    idempotencyKey,
    xRequestId: requestId,
    createValidationRunRequest: payload,
  });

  const renderResponses = [];
  for (const [index, format] of renderFormats.entries()) {
    const renderResponse = await api.createValidationReviewRenderV2({
      runId: runResponse.run.id,
      idempotencyKey: `${idempotencyKey}-render-${format}-${index}`,
      xRequestId: `${requestId}-render-${format}-${index}`,
      createValidationReviewRenderRequest: {
        format,
      },
    });

    renderResponses.push({
      requestId: renderResponse.requestId,
      render: {
        ...renderResponse.render,
        requestedAt: renderResponse.render.requestedAt.toISOString(),
        updatedAt: renderResponse.render.updatedAt.toISOString(),
        expiresAt: renderResponse.render.expiresAt?.toISOString() ?? null,
      },
      pending: renderResponse.render.status !== "completed",
    });
  }

  context.emit({
    status: "ok",
    command: "review-run trigger",
    requestId: runResponse.requestId,
    idempotencyKey,
    runId: runResponse.run.id,
    run: {
      ...runResponse.run,
      createdAt: runResponse.run.createdAt.toISOString(),
      updatedAt: runResponse.run.updatedAt.toISOString(),
    },
    reviewWeb: buildReviewWebLink(reviewWebBaseUrl, runResponse.run.id),
    renders: renderResponses,
  });
}

async function runRetrieveCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      status: { type: "string" },
      "final-decision": { type: "string" },
      cursor: { type: "string" },
      limit: { type: "string" },
      "render-format": { type: "string" },
      raw: { type: "boolean", default: false },
      "request-id": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  const requestId = deriveRequestId(
    REVIEW_RUN_REQUEST_ID_PREFIX,
    nonEmpty(parsed.values["request-id"]),
  );
  const api = createValidationApiClient(context);
  const reviewWebBaseUrl = resolveReviewWebBaseUrl(context.env);

  if (runId) {
    const reviewRun = await api.getValidationReviewRunV2({
      runId,
      xRequestId: requestId,
    });

    const renderFormat = parseRenderFormat(parsed.values["render-format"]);
    const renderStatus =
      renderFormat === undefined
        ? undefined
        : await api.getValidationReviewRenderV2({
            runId,
            format: renderFormat,
            xRequestId: `${requestId}-render-${renderFormat}`,
          });

    context.emit({
      status: "ok",
      command: "review-run retrieve",
      requestId: reviewRun.requestId,
      runId,
      summary: summarizeReviewArtifact(reviewRun),
      reviewWeb: buildReviewWebLink(reviewWebBaseUrl, runId),
      render:
        renderStatus === undefined
          ? undefined
          : {
              requestId: renderStatus.requestId,
              render: {
                ...renderStatus.render,
                requestedAt: renderStatus.render.requestedAt.toISOString(),
                updatedAt: renderStatus.render.updatedAt.toISOString(),
                expiresAt: renderStatus.render.expiresAt?.toISOString() ?? null,
              },
              pending: renderStatus.render.status !== "completed",
            },
      artifact: parsed.values.raw ? reviewRun.artifact : undefined,
    });

    return;
  }

  const status = parseStatusFilter(parsed.values.status);
  const finalDecision = parseFinalDecisionFilter(parsed.values["final-decision"]);
  const cursor = nonEmpty(parsed.values.cursor);
  const limit = parseLimit(parsed.values.limit);

  const reviewRuns = await api.listValidationReviewRunsV2({
    xRequestId: requestId,
    status,
    finalDecision,
    cursor,
    limit,
  });

  context.emit({
    status: "ok",
    command: "review-run retrieve",
    requestId: reviewRuns.requestId,
    filters: {
      status: status ?? null,
      finalDecision: finalDecision ?? null,
      cursor: cursor ?? null,
      limit: limit ?? null,
    },
    items: reviewRuns.items.map((item) => summarizeReviewListItem(item, reviewWebBaseUrl)),
    nextCursor: reviewRuns.nextCursor ?? null,
  });
}

async function runRenderCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      format: { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }

  const format = parseRenderFormat(parsed.values.format, "--format");
  if (!format) {
    throw new Error("--format is required and must be one of: html,pdf.");
  }

  const { requestId, idempotencyKey } = parseCommonHeaders(parsed.values);
  const api = createValidationApiClient(context);
  const reviewWebBaseUrl = resolveReviewWebBaseUrl(context.env);

  const renderResponse = await api.createValidationRunRenderV2({
    runId,
    idempotencyKey,
    xRequestId: requestId,
    createValidationRenderRequest: {
      format,
    },
  });

  context.emit({
    status: "ok",
    command: "review-run render",
    requestId: renderResponse.requestId,
    idempotencyKey,
    runId,
    format,
    reviewWeb: buildReviewWebLink(reviewWebBaseUrl, runId),
    render: renderResponse.render,
    pending: renderResponse.render.status !== "completed",
  });
}

async function runListCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "request-id": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const requestId = deriveRequestId(
    REVIEW_RUN_REQUEST_ID_PREFIX,
    nonEmpty(parsed.values["request-id"]),
  );
  const api = createValidationApiClient(context);
  const response = await api.listValidationRunsV2({
    xRequestId: requestId,
  });

  context.emit({
    status: "ok",
    command: "review-run list",
    requestId: response.requestId,
    runs: response.runs.map((run) => summarizeValidationRun(run)),
    count: response.runs.length,
  });
}

async function runReviewCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      input: { type: "string" },
      "reviewer-type": { type: "string" },
      decision: { type: "string" },
      summary: { type: "string" },
      comments: { type: "string" },
      "findings-json": { type: "string" },
      "findings-file": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }

  const payload = parseReviewSubmissionRequest(parsed.values);
  const { requestId, idempotencyKey } = parseCommonHeaders(parsed.values);
  const api = createValidationApiClient(context);
  const response = await api.submitValidationRunReviewV2({
    runId,
    xRequestId: requestId,
    idempotencyKey,
    createValidationRunReviewRequest: payload,
  });

  context.emit({
    status: "ok",
    command: "review-run review",
    requestId: response.requestId,
    idempotencyKey,
    runId: response.runId,
    reviewAccepted: response.reviewAccepted,
  });
}

async function runReviewCommentCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "run-id": { type: "string" },
      input: { type: "string" },
      body: { type: "string" },
      "evidence-refs": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }

  const payload = parseReviewCommentRequest(parsed.values);
  const { requestId, idempotencyKey } = parseCommonHeaders(parsed.values);
  const api = createValidationApiClient(context);
  const response = await api.createValidationReviewCommentV2({
    runId,
    xRequestId: requestId,
    idempotencyKey,
    createValidationReviewCommentRequest: payload,
  });

  context.emit({
    status: "ok",
    command: "review-run review-comment",
    requestId: response.requestId,
    idempotencyKey,
    runId: response.runId,
    commentAccepted: response.commentAccepted,
    comment: {
      ...response.comment,
      createdAt: response.comment.createdAt.toISOString(),
    },
  });
}

async function runReviewDecisionCommand(args: string[], context: CommandContext): Promise<void> {
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
    },
    allowPositionals: false,
    strict: true,
  });

  const runId = nonEmpty(parsed.values["run-id"]);
  if (!runId) {
    throw new Error("--run-id is required.");
  }

  const payload = parseReviewDecisionRequest(parsed.values);
  const { requestId, idempotencyKey } = parseCommonHeaders(parsed.values);
  const api = createValidationApiClient(context);
  const response = await api.createValidationReviewDecisionV2({
    runId,
    xRequestId: requestId,
    idempotencyKey,
    createValidationReviewDecisionRequest: payload,
  });

  context.emit({
    status: "ok",
    command: "review-run review-decision",
    requestId: response.requestId,
    idempotencyKey,
    runId: response.runId,
    decisionAccepted: response.decisionAccepted,
    decision: {
      ...response.decision,
      createdAt: response.decision.createdAt.toISOString(),
    },
  });
}

async function runBaselineCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      "run-id": { type: "string" },
      name: { type: "string" },
      notes: { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const payload = parseBaselineRequest(parsed.values);
  const { requestId, idempotencyKey } = parseCommonHeaders(parsed.values);
  const api = createValidationApiClient(context);
  const response = await api.createValidationBaselineV2({
    xRequestId: requestId,
    idempotencyKey,
    createValidationBaselineRequest: payload,
  });

  context.emit({
    status: "ok",
    command: "review-run baseline",
    requestId: response.requestId,
    idempotencyKey,
    baseline: {
      ...response.baseline,
      createdAt: response.baseline.createdAt.toISOString(),
    },
  });
}

async function runReplayCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      "baseline-id": { type: "string" },
      "candidate-run-id": { type: "string" },
      "policy-overrides-json": { type: "string" },
      "policy-overrides-file": { type: "string" },
      "request-id": { type: "string" },
      "idempotency-key": { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const payload = parseReplayRequest(parsed.values);
  const { requestId, idempotencyKey } = parseCommonHeaders(parsed.values);
  const api = createValidationApiClient(context);
  const response = await api.replayValidationRegressionV2({
    xRequestId: requestId,
    idempotencyKey,
    createValidationRegressionReplayRequest: payload,
  });

  context.emit({
    status: "ok",
    command: "review-run replay",
    requestId: response.requestId,
    idempotencyKey,
    replay: toSerializable(response.replay),
  });
}

export async function runReviewRunCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];

  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "review-run",
      usage: [
        "trading-cli review-run trigger --strategy-id <id> --requested-indicators <csv> --dataset-ids <csv> --backtest-report-ref <ref> [--render html,pdf]",
        "trading-cli review-run trigger --input <payload.json> [--render html,pdf]",
        "trading-cli review-run retrieve --run-id <runId> [--render-format html|pdf] [--raw]",
        "trading-cli review-run render --run-id <runId> --format html|pdf",
        "trading-cli review-run retrieve [--status queued|running|completed|failed] [--final-decision pending|pass|conditional_pass|fail] [--limit 25]",
        "trading-cli review-run list",
        "trading-cli review-run review --run-id <runId> --reviewer-type agent|trader --decision pass|conditional_pass|fail [--summary <text>] [--comments <csv>] [--findings-json <json-array>]",
        "trading-cli review-run review-comment --run-id <runId> --body <text> [--evidence-refs <csv>]",
        "trading-cli review-run review-decision --run-id <runId> --action approve|reject --decision pass|conditional_pass|fail --reason <text> [--evidence-refs <csv>]",
        "trading-cli review-run baseline --run-id <runId> --name <name> [--notes <text>]",
        "trading-cli review-run replay --baseline-id <baselineId> --candidate-run-id <runId> [--policy-overrides-json <json>]",
      ],
    });
    return;
  }

  if (subcommand === "trigger") {
    await runTriggerCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "retrieve" || subcommand === "get") {
    await runRetrieveCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "list" || subcommand === "runs") {
    await runListCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "render") {
    await runRenderCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "review" || subcommand === "submit-review") {
    await runReviewCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "review-comment" || subcommand === "comment") {
    await runReviewCommentCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "review-decision" || subcommand === "decision") {
    await runReviewDecisionCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "baseline") {
    await runBaselineCommand(args.slice(1), context);
    return;
  }

  if (subcommand === "replay" || subcommand === "replay-regression") {
    await runReplayCommand(args.slice(1), context);
    return;
  }

  throw new Error(
    `Unknown review-run subcommand '${subcommand}'. Use 'trigger', 'retrieve', 'list', 'render', 'review', 'review-comment', 'review-decision', 'baseline', or 'replay'.`,
  );
}

type ErrorEnvelope = {
  status: "error";
  message: string;
  code?: string;
  requestId?: string;
  details?: unknown;
  httpStatus?: number;
};

export async function formatReviewRunError(error: unknown): Promise<ErrorEnvelope> {
  if (error instanceof ResponseError) {
    const status = error.response.status;
    let payload: unknown;
    try {
      payload = await error.response.json();
    } catch {
      payload = undefined;
    }

    const asRecord = payload as {
      requestId?: unknown;
      error?: {
        code?: unknown;
        message?: unknown;
        details?: unknown;
      };
    };

    return {
      status: "error",
      message: withFallbackMessage(
        asRecord.error?.message,
        `Platform API request failed with HTTP ${status}.`,
      ),
      code: nonEmpty(asRecord.error?.code),
      requestId: nonEmpty(asRecord.requestId),
      details: asRecord.error?.details,
      httpStatus: status,
    };
  }

  if (error instanceof RequiredError) {
    return {
      status: "error",
      message: `CLI request is missing required field '${error.field}'. ${error.message}`,
    };
  }

  if (error instanceof FetchError) {
    return {
      status: "error",
      message: `Platform API connection failed: ${error.cause.message}`,
    };
  }

  if (error instanceof Error) {
    return {
      status: "error",
      message: error.message,
    };
  }

  return {
    status: "error",
    message: String(error),
  };
}

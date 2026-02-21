import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";

import { type CommandContext, nonEmpty, parseJsonFile, trimTrailingSlash } from "./command-utils";
import {
  Configuration,
  FetchError,
  RequiredError,
  ResponseError,
  ValidationApi,
  ValidationProfile,
  ValidationRenderFormat,
  ValidationRunDecision,
  ValidationRunStatus,
  type CreateValidationRunRequest,
  type ValidationReviewRunDetailResponse,
  type ValidationReviewRunSummary,
} from "./generated/trade-nexus-sdk";

const DEFAULT_REVIEW_WEB_BASE_URL = "https://trade-nexus.lona.agency";
const REVIEW_WEB_PATH = "/validation";

const VALID_PROFILES = new Set<string>(Object.values(ValidationProfile));
const VALID_RENDER_FORMATS = new Set<string>(Object.values(ValidationRenderFormat));
const VALID_RUN_STATUSES = new Set<string>(Object.values(ValidationRunStatus));
const VALID_RUN_DECISIONS = new Set<string>(Object.values(ValidationRunDecision));

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

function deriveRequestId(seed?: string): string {
  if (seed) {
    return seed;
  }
  return `req-review-run-${Date.now()}`;
}

function deriveIdempotencyKey(seed?: string): string {
  if (seed) {
    return seed;
  }
  return `idem-review-run-${randomUUID()}`;
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

function createValidationApiClient(context: CommandContext): ValidationApi {
  const accessToken =
    nonEmpty(context.env.PLATFORM_API_BEARER_TOKEN) ?? nonEmpty(context.env.PLATFORM_API_TOKEN);
  const apiKey = nonEmpty(context.env.PLATFORM_API_KEY);

  if (!accessToken && !apiKey) {
    throw new Error(
      "Authentication required: set PLATFORM_API_BEARER_TOKEN (preferred) or PLATFORM_API_KEY.",
    );
  }

  const configuration = new Configuration({
    basePath: trimTrailingSlash(context.baseUrl),
    fetchApi: context.fetchImpl,
    accessToken,
    apiKey,
  });

  return new ValidationApi(configuration);
}

function summarizeReviewArtifact(response: ValidationReviewRunDetailResponse) {
  const artifact = response.artifact;
  const run = artifact.run;
  return {
    runId: run.id,
    status: run.status,
    profile: run.profile,
    finalDecision: run.finalDecision,
    traderReviewStatus: artifact.artifact.traderReview.status,
    commentCount: artifact.comments.length,
    pendingDecision: artifact.decision == null,
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

function parseCommonHeaders(values: ParsedValues): {
  requestId: string;
  idempotencyKey: string;
} {
  return {
    requestId: deriveRequestId(nonEmpty(values["request-id"])),
    idempotencyKey: deriveIdempotencyKey(nonEmpty(values["idempotency-key"])),
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
  const requestId = deriveRequestId(nonEmpty(parsed.values["request-id"]));
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

  if (subcommand === "render") {
    await runRenderCommand(args.slice(1), context);
    return;
  }

  throw new Error(
    `Unknown review-run subcommand '${subcommand}'. Use 'trigger', 'retrieve', or 'render'.`,
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

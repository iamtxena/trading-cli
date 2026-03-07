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
  type BacktestDataExportRequest,
  DeploymentStatus,
  OrderStatus,
  StrategyStatus,
  type CreateBacktestRequest,
  type CreateDeploymentRequest,
  type CreateOrderRequest,
  type CreateStrategyRequest,
  type KnowledgeSearchRequest,
  type MarketScanRequest,
  type UpdateStrategyRequest,
} from "./generated/trade-nexus-sdk";
import {
  createBacktestsApiClient,
  createDataApiClient,
  createDeploymentsApiClient,
  createHealthApiClient,
  createKnowledgeApiClient,
  createOrdersApiClient,
  createPortfoliosApiClient,
  createResearchApiClient,
  createStrategiesApiClient,
} from "./platform-api-sdk";

type ParsedValues = ReturnType<typeof parseArgs>["values"];
type TableOutput = {
  title?: string;
  rows: TableRow[];
  columns: string[];
  emptyMessage?: string;
  notes?: string[];
};

const CORE_REQUEST_ID_PREFIX = "req-core";
const CORE_IDEMPOTENCY_KEY_PREFIX = "idem-core";

const STRATEGY_STATUSES = new Set<string>(Object.values(StrategyStatus));
const DEPLOYMENT_STATUSES = new Set<string>(Object.values(DeploymentStatus));
const ORDER_STATUSES = new Set<string>(Object.values(OrderStatus));

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function hasLimitFlag(args: string[]): boolean {
  return args.some((arg) => arg === "--limit" || arg.startsWith("--limit="));
}

function emitLeafUsage(context: CommandContext, command: string, usage: string): void {
  context.emit({
    status: "ok",
    command,
    usage: [usage],
  });
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

function parseNumeric(value: unknown, label: string): number {
  const raw = nonEmpty(value);
  if (!raw) {
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }
  return parsed;
}

function parseOptionalPositiveInteger(value: unknown, label: string): number | undefined {
  const raw = nonEmpty(value);
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseOptionalDate(value: unknown, label: string): Date | undefined {
  const raw = nonEmpty(value);
  if (!raw) {
    return undefined;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${label} must be a valid ISO date.`);
  }
  return parsed;
}

function parseRequiredDate(value: unknown, label: string): Date {
  const parsed = parseOptionalDate(value, label);
  if (!parsed) {
    throw new Error(`${label} is required.`);
  }
  return parsed;
}

function parseEnumValue<T extends string>(
  value: unknown,
  label: string,
  allowed: Set<string>,
): T | undefined {
  const raw = nonEmpty(value)?.toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (!allowed.has(raw)) {
    throw new Error(`${label} must be one of: ${Array.from(allowed).join(", ")}.`);
  }
  return raw as T;
}

function parseRequestId(values: ParsedValues): string {
  return deriveRequestId(CORE_REQUEST_ID_PREFIX, nonEmpty(values["request-id"]));
}

function parseIdempotencyKey(values: ParsedValues): string {
  return deriveIdempotencyKey(CORE_IDEMPOTENCY_KEY_PREFIX, nonEmpty(values["idempotency-key"]));
}

function emitOutput(
  context: CommandContext,
  output: OutputMode,
  payload: unknown,
  table?: TableOutput,
): void {
  const normalizedPayload = toSerializable(payload);

  if (output === "json") {
    context.emit(normalizedPayload);
    return;
  }

  if (!table) {
    console.log(JSON.stringify(normalizedPayload, null, 2));
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

function toStrategyTableRow(strategy: Record<string, unknown>): TableRow {
  return {
    id: strategy.id as string,
    name: strategy.name as string,
    status: strategy.status as string,
    provider: strategy.provider as string,
    createdAt: strategy.createdAt as string,
  };
}

function toDeploymentTableRow(deployment: Record<string, unknown>): TableRow {
  return {
    id: deployment.id as string,
    strategyId: deployment.strategyId as string,
    mode: deployment.mode as string,
    status: deployment.status as string,
    capital: deployment.capital as number,
    latestPnl: deployment.latestPnl as number | null | undefined,
  };
}

function toOrderTableRow(order: Record<string, unknown>): TableRow {
  return {
    id: order.id as string,
    symbol: order.symbol as string,
    side: order.side as string,
    type: order.type as string,
    quantity: order.quantity as number,
    status: order.status as string,
    createdAt: order.createdAt as string,
  };
}

function toPortfolioTableRow(portfolio: Record<string, unknown>): TableRow {
  const positions = portfolio.positions as unknown[];
  return {
    id: portfolio.id as string,
    mode: portfolio.mode as string,
    cash: portfolio.cash as number,
    totalValue: portfolio.totalValue as number,
    pnlTotal: portfolio.pnlTotal as number | undefined,
    positions: Array.isArray(positions) ? positions.length : 0,
  };
}

function parseMarketScanRequest(values: ParsedValues): MarketScanRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<MarketScanRequest>(inputPath, "research scan payload");
  }

  const assetClasses = parseCsv(values["asset-classes"]);
  if (assetClasses.length === 0) {
    throw new Error("--asset-classes is required when --input is not provided.");
  }

  const capital = parseNumeric(values.capital, "--capital");

  const constraintsRaw = nonEmpty(values["constraints-json"]);
  let constraints: Record<string, unknown> | undefined;
  if (constraintsRaw) {
    try {
      const parsed = JSON.parse(constraintsRaw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("must be a JSON object");
      }
      constraints = parsed as Record<string, unknown>;
    } catch (error) {
      throw new Error(
        `Unable to parse --constraints-json: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    assetClasses: assetClasses as MarketScanRequest["assetClasses"],
    capital,
    constraints: constraints as MarketScanRequest["constraints"],
  };
}

async function runResearchCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "research",
      usage: [
        "trading-cli research scan --input <market-scan.json> [--version v2] [--output json|table]",
        "trading-cli research scan --asset-classes crypto,stocks --capital 50000 [--version v2] [--output json|table]",
      ],
    });
    return;
  }

  if (subcommand !== "scan") {
    throw new Error(`Unknown research subcommand '${subcommand}'. Use 'scan'.`);
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: {
      input: { type: "string" },
      version: { type: "string" },
      "asset-classes": { type: "string" },
      capital: { type: "string" },
      "constraints-json": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const version = nonEmpty(parsed.values.version)?.toLowerCase() ?? "v2";
  if (version !== "v1" && version !== "v2") {
    throw new Error("--version must be 'v1' or 'v2'.");
  }

  const output = parseOutputMode(parsed.values.output);
  const requestId = parseRequestId(parsed.values);
  const payload = parseMarketScanRequest(parsed.values);
  const api = createResearchApiClient(context);

  const response =
    version === "v1"
      ? await api.postMarketScanV1({ marketScanRequest: payload, xRequestId: requestId })
      : await api.postMarketScanV2({ marketScanRequest: payload, xRequestId: requestId });

  const body = {
    status: "ok",
    command: "research scan",
    version,
    requestId: response.requestId,
    regimeSummary: response.regimeSummary,
    strategyIdeas: response.strategyIdeas,
    ...(version === "v2"
      ? {
          knowledgeEvidence: (response as { knowledgeEvidence?: unknown[] }).knowledgeEvidence ?? [],
          dataContextSummary: (response as { dataContextSummary?: string }).dataContextSummary ?? null,
        }
      : {}),
  };

  emitOutput(context, output, body, {
    title: "research scan",
    notes: [`requestId: ${response.requestId}`, `regime: ${response.regimeSummary}`],
    rows: response.strategyIdeas.map((idea) => ({
      name: idea.name,
      assetClass: idea.assetClass,
      description: idea.description,
    })),
    columns: ["name", "assetClass", "description"],
    emptyMessage: "No strategy ideas returned.",
  });
}

async function runKnowledgeCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "knowledge",
      usage: [
        "trading-cli knowledge search --query \"momentum\" [--assets btc,eth] [--limit 10] [--output json|table]",
        "trading-cli knowledge search --input <knowledge-search.json> [--output json|table]",
        "trading-cli knowledge patterns [--type <pattern-type>] [--asset <asset>] [--limit 20] [--output json|table]",
        "trading-cli knowledge regime --asset <asset> [--output json|table]",
      ],
    });
    return;
  }

  const api = createKnowledgeApiClient(context);

  if (subcommand === "search") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        input: { type: "string" },
        query: { type: "string" },
        assets: { type: "string" },
        limit: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const output = parseOutputMode(parsed.values.output);
    const response = await api.searchKnowledgeV2({
      knowledgeSearchRequest: parseKnowledgeSearchRequest(parsed.values),
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const items = (serial.items as Record<string, unknown>[]) ?? [];
    emitOutput(
      context,
      output,
      { status: "ok", command: "knowledge search", ...serial },
      {
        title: "knowledge search",
        notes: [`requestId: ${response.requestId}`],
        rows: items.map((item) => toKnowledgeSearchTableRow(item)),
        columns: ["kind", "id", "title", "score", "summary"],
        emptyMessage: "No knowledge matches returned.",
      },
    );
    return;
  }

  if (subcommand === "patterns") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        type: { type: "string" },
        asset: { type: "string" },
        limit: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const output = parseOutputMode(parsed.values.output);
    const response = await api.listKnowledgePatternsV2({
      xRequestId: parseRequestId(parsed.values),
      type: nonEmpty(parsed.values.type),
      asset: nonEmpty(parsed.values.asset),
      limit: parseOptionalPositiveInteger(parsed.values.limit, "--limit"),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const items = (serial.items as Record<string, unknown>[]) ?? [];
    emitOutput(
      context,
      output,
      { status: "ok", command: "knowledge patterns", ...serial },
      {
        title: "knowledge patterns",
        notes: [`requestId: ${response.requestId}`],
        rows: items.map((item) => toKnowledgePatternTableRow(item)),
        columns: ["id", "name", "type", "confidenceScore", "assets", "timeframes", "suitableRegimes"],
        emptyMessage: "No knowledge patterns returned.",
      },
    );
    return;
  }

  if (subcommand === "regime") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        asset: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const asset = nonEmpty(parsed.values.asset);
    if (!asset) {
      throw new Error("--asset is required.");
    }

    const output = parseOutputMode(parsed.values.output);
    const response = await api.getKnowledgeRegimeV2({
      asset,
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const regime = serial.regime as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "knowledge regime", ...serial },
      {
        title: "knowledge regime",
        notes: [`requestId: ${response.requestId}`],
        rows: [toKnowledgeRegimeTableRow(regime)],
        columns: ["id", "asset", "regime", "volatility", "indicators", "startAt", "endAt"],
      },
    );
    return;
  }

  throw new Error(`Unknown knowledge subcommand '${subcommand}'. Use 'search', 'patterns', or 'regime'.`);
}

async function runHealthCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "health",
      usage: ["trading-cli health get [--output json|table]"],
    });
    return;
  }

  if (subcommand !== "get") {
    throw new Error(`Unknown health subcommand '${subcommand}'. Use 'get'.`);
  }

  const parsed = parseArgs({
    args: args.slice(1),
    options: {
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const output = parseOutputMode(parsed.values.output);
  const api = createHealthApiClient(context, { requireAuth: false });
  const response = await api.getHealthV1();
  const serial = toSerializable(response) as Record<string, unknown>;

  emitOutput(
    context,
    output,
    { status: "ok", command: "health get", health: serial },
    {
      title: "health get",
      rows: [
        {
          status: serial.status as string,
          service: serial.service as string,
          timestamp: serial.timestamp as string,
        },
      ],
      columns: ["status", "service", "timestamp"],
    },
  );
}

function parseCreateStrategyRequest(values: ParsedValues): CreateStrategyRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateStrategyRequest>(inputPath, "strategy create payload");
  }

  const description = nonEmpty(values.description);
  if (!description) {
    throw new Error("--description is required when --input is not provided.");
  }

  const name = nonEmpty(values.name);
  const provider = nonEmpty(values.provider);
  return {
    description,
    ...(name ? { name } : {}),
    ...(provider ? { provider: provider as CreateStrategyRequest["provider"] } : {}),
  };
}

function parseUpdateStrategyRequest(values: ParsedValues): UpdateStrategyRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<UpdateStrategyRequest>(inputPath, "strategy update payload");
  }

  const status = parseEnumValue<StrategyStatus>(
    values.status,
    "--status",
    STRATEGY_STATUSES,
  ) as StrategyStatus | undefined;
  const payload: UpdateStrategyRequest = {};
  const name = nonEmpty(values.name);
  const description = nonEmpty(values.description);
  const tags = parseCsv(values.tags);

  if (name) {
    payload.name = name;
  }
  if (description) {
    payload.description = description;
  }
  if (status) {
    payload.status = status;
  }
  if (tags.length > 0) {
    payload.tags = tags;
  }

  if (Object.keys(payload).length === 0) {
    throw new Error(
      "Provide at least one updatable field (--name, --description, --status, --tags) or --input.",
    );
  }

  return payload;
}

async function runStrategyCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "strategy",
      usage: [
        "trading-cli strategy create --description \"Momentum breakout\" [--name <name>] [--output json|table]",
        "trading-cli strategy create --input <create-strategy.json> [--output json|table]",
        "trading-cli strategy get --strategy-id <id> [--output json|table]",
        "trading-cli strategy list [--status draft|testing|tested|deployable|archived|failed] [--cursor <token>] [--output json|table]",
        "trading-cli strategy update --strategy-id <id> --status deployable [--output json|table]",
      ],
    });
    return;
  }

  if (subcommand === "create") {
    const api = createStrategiesApiClient(context);
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        input: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        provider: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const output = parseOutputMode(parsed.values.output);
    const response = await api.createStrategyV1({
      createStrategyRequest: parseCreateStrategyRequest(parsed.values),
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const strategy = serial.strategy as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "strategy create", ...serial },
      {
        title: "strategy create",
        notes: [`requestId: ${response.requestId}`],
        rows: [toStrategyTableRow(strategy)],
        columns: ["id", "name", "status", "provider", "createdAt"],
      },
    );
    return;
  }

  if (subcommand === "get") {
    if (hasHelpFlag(args.slice(1))) {
      emitLeafUsage(
        context,
        "strategy get",
        "trading-cli strategy get --strategy-id <id> [--request-id <id>] [--output json|table]",
      );
      return;
    }

    const api = createStrategiesApiClient(context);
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "strategy-id": { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const strategyId = nonEmpty(parsed.values["strategy-id"]);
    if (!strategyId) {
      throw new Error("--strategy-id is required.");
    }
    const output = parseOutputMode(parsed.values.output);
    const response = await api.getStrategyV1({
      strategyId,
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const strategy = serial.strategy as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "strategy get", ...serial },
      {
        title: "strategy get",
        notes: [`requestId: ${response.requestId}`],
        rows: [toStrategyTableRow(strategy)],
        columns: ["id", "name", "status", "provider", "createdAt"],
      },
    );
    return;
  }

  if (subcommand === "list") {
    if (hasHelpFlag(args.slice(1))) {
      emitLeafUsage(
        context,
        "strategy list",
        "trading-cli strategy list [--status draft|testing|tested|deployable|archived|failed] [--cursor <token>] [--request-id <id>] [--output json|table]",
      );
      return;
    }

    if (hasLimitFlag(args.slice(1))) {
      throw new Error("--limit is not supported for strategy list.");
    }

    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        status: { type: "string" },
        cursor: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const api = createStrategiesApiClient(context);
    const output = parseOutputMode(parsed.values.output);
    const status = parseEnumValue<StrategyStatus>(
      parsed.values.status,
      "--status",
      STRATEGY_STATUSES,
    );

    const response = await api.listStrategiesV1({
      xRequestId: parseRequestId(parsed.values),
      status,
      cursor: nonEmpty(parsed.values.cursor),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const items = (serial.items as Record<string, unknown>[]) ?? [];
    emitOutput(
      context,
      output,
      { status: "ok", command: "strategy list", ...serial },
      {
        title: "strategy list",
        notes: [`requestId: ${response.requestId}`, `nextCursor: ${response.nextCursor ?? "-"}`],
        rows: items.map((item) => toStrategyTableRow(item)),
        columns: ["id", "name", "status", "provider", "createdAt"],
      },
    );
    return;
  }

  if (subcommand === "update") {
    const api = createStrategiesApiClient(context);
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "strategy-id": { type: "string" },
        input: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        status: { type: "string" },
        tags: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const strategyId = nonEmpty(parsed.values["strategy-id"]);
    if (!strategyId) {
      throw new Error("--strategy-id is required.");
    }

    const output = parseOutputMode(parsed.values.output);
    const response = await api.updateStrategyV1({
      strategyId,
      updateStrategyRequest: parseUpdateStrategyRequest(parsed.values),
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const strategy = serial.strategy as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "strategy update", ...serial },
      {
        title: "strategy update",
        notes: [`requestId: ${response.requestId}`],
        rows: [toStrategyTableRow(strategy)],
        columns: ["id", "name", "status", "provider", "createdAt"],
      },
    );
    return;
  }

  throw new Error(`Unknown strategy subcommand '${subcommand}'. Use 'create', 'get', 'list', or 'update'.`);
}

function parseCreateBacktestRequest(values: ParsedValues): CreateBacktestRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateBacktestRequest>(inputPath, "backtest create payload");
  }

  const startDate = parseRequiredDate(values["start-date"], "--start-date");
  const endDate = parseRequiredDate(values["end-date"], "--end-date");
  const datasetIds = parseCsv(values["dataset-ids"]);
  const dataIds = parseCsv(values["data-ids"]);
  const initialCashRaw = nonEmpty(values["initial-cash"]);
  const initialCash = initialCashRaw ? parseNumeric(initialCashRaw, "--initial-cash") : undefined;

  return {
    startDate,
    endDate,
    ...(datasetIds.length > 0 ? { datasetIds } : {}),
    ...(dataIds.length > 0 ? { dataIds } : {}),
    ...(initialCash !== undefined ? { initialCash } : {}),
  };
}

function parseBacktestDataExportRequest(values: ParsedValues): BacktestDataExportRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<BacktestDataExportRequest>(inputPath, "backtest export create payload");
  }

  const datasetIds = parseCsv(values["dataset-ids"]);
  if (datasetIds.length === 0) {
    throw new Error("--dataset-ids is required when --input is not provided.");
  }
  const assetClasses = parseCsv(values["asset-classes"]);

  return {
    datasetIds,
    ...(assetClasses.length > 0 ? { assetClasses } : {}),
  };
}

function parseKnowledgeSearchRequest(values: ParsedValues): KnowledgeSearchRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<KnowledgeSearchRequest>(inputPath, "knowledge search payload");
  }

  const query = nonEmpty(values.query);
  if (!query) {
    throw new Error("--query is required when --input is not provided.");
  }
  const assets = parseCsv(values.assets);
  const limit = parseOptionalPositiveInteger(values.limit, "--limit");

  return {
    query,
    ...(assets.length > 0 ? { assets } : {}),
    ...(limit !== undefined ? { limit } : {}),
  };
}

function serializeBacktestTable(backtest: Record<string, unknown>): TableRow {
  return {
    id: backtest.id as string,
    strategyId: backtest.strategyId as string,
    status: backtest.status as string,
    startedAt: backtest.startedAt as string,
    completedAt: backtest.completedAt as string,
    createdAt: backtest.createdAt as string,
  };
}

function serializeBacktestExportTable(exportRecord: Record<string, unknown>): TableRow {
  const datasetIds = Array.isArray(exportRecord.datasetIds) ? exportRecord.datasetIds : [];
  const assetClasses = Array.isArray(exportRecord.assetClasses) ? exportRecord.assetClasses : [];
  return {
    id: exportRecord.id as string,
    status: exportRecord.status as string,
    datasetCount: datasetIds.length,
    assetClassCount: assetClasses.length,
    downloadUrl: exportRecord.downloadUrl as string | null | undefined,
    updatedAt: exportRecord.updatedAt as string,
  };
}

function toKnowledgeSearchTableRow(item: Record<string, unknown>): TableRow {
  return {
    kind: item.kind as string,
    id: item.id as string,
    title: item.title as string,
    score: item.score as number,
    summary: item.summary as string,
  };
}

function toKnowledgePatternTableRow(pattern: Record<string, unknown>): TableRow {
  const assets = Array.isArray(pattern.assets) ? pattern.assets.join(",") : "";
  const timeframes = Array.isArray(pattern.timeframes) ? pattern.timeframes.join(",") : "";
  const suitableRegimes = Array.isArray(pattern.suitableRegimes)
    ? pattern.suitableRegimes.join(",")
    : "";

  return {
    id: pattern.id as string,
    name: pattern.name as string,
    type: pattern.type as string,
    confidenceScore: pattern.confidenceScore as number,
    assets,
    timeframes,
    suitableRegimes,
  };
}

function toKnowledgeRegimeTableRow(regime: Record<string, unknown>): TableRow {
  const indicators = regime.indicators as Record<string, unknown> | undefined;
  return {
    id: regime.id as string,
    asset: regime.asset as string,
    regime: regime.regime as string,
    volatility: regime.volatility as string,
    indicators: indicators ? Object.keys(indicators).length : 0,
    startAt: regime.startAt as string,
    endAt: regime.endAt as string | null | undefined,
  };
}

async function runBacktestExportCreateCommand(
  args: string[],
  context: CommandContext,
): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      "dataset-ids": { type: "string" },
      "asset-classes": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const output = parseOutputMode(parsed.values.output);
  const api = createDataApiClient(context);
  const response = await api.createBacktestDataExportV2({
    backtestDataExportRequest: parseBacktestDataExportRequest(parsed.values),
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const exportRecord = serial._export as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "backtest export create",
      requestId: serial.requestId,
      export: exportRecord,
    },
    {
      title: "backtest export create",
      notes: [`requestId: ${response.requestId}`],
      rows: [serializeBacktestExportTable(exportRecord)],
      columns: ["id", "status", "datasetCount", "assetClassCount", "downloadUrl", "updatedAt"],
    },
  );
}

async function runBacktestExportGetCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "export-id": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const exportId = nonEmpty(parsed.values["export-id"]);
  if (!exportId) {
    throw new Error("--export-id is required.");
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createDataApiClient(context);
  const response = await api.getBacktestDataExportV2({
    exportId,
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const exportRecord = serial._export as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "backtest export get",
      requestId: serial.requestId,
      export: exportRecord,
    },
    {
      title: "backtest export get",
      notes: [`requestId: ${response.requestId}`],
      rows: [serializeBacktestExportTable(exportRecord)],
      columns: ["id", "status", "datasetCount", "assetClassCount", "downloadUrl", "updatedAt"],
    },
  );
}

async function runBacktestCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "backtest",
      usage: [
        "trading-cli backtest create --strategy-id <id> --start-date 2025-01-01 --end-date 2025-03-01 [--dataset-ids <csv>] [--output json|table]",
        "trading-cli backtest create --strategy-id <id> --input <create-backtest.json> [--output json|table]",
        "trading-cli backtest get --backtest-id <id> [--output json|table]",
        "trading-cli backtest export create --dataset-ids <csv> [--asset-classes <csv>] [--output json|table]",
        "trading-cli backtest export create --input <backtest-export.json> [--output json|table]",
        "trading-cli backtest export get --export-id <id> [--output json|table]",
      ],
    });
    return;
  }

  if (subcommand === "export") {
    const action = args[1];
    if (!action || action === "--help" || action === "-h") {
      context.emit({
        status: "ok",
        command: "backtest export",
        usage: [
          "trading-cli backtest export create --dataset-ids <csv> [--asset-classes <csv>] [--output json|table]",
          "trading-cli backtest export create --input <backtest-export.json> [--output json|table]",
          "trading-cli backtest export get --export-id <id> [--output json|table]",
        ],
      });
      return;
    }

    if (action === "create") {
      await runBacktestExportCreateCommand(args.slice(2), context);
      return;
    }

    if (action === "get") {
      await runBacktestExportGetCommand(args.slice(2), context);
      return;
    }

    throw new Error(`Unknown backtest export subcommand '${action}'. Use 'create' or 'get'.`);
  }

  if (subcommand === "create") {
    const api = createBacktestsApiClient(context);
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "strategy-id": { type: "string" },
        input: { type: "string" },
        "start-date": { type: "string" },
        "end-date": { type: "string" },
        "dataset-ids": { type: "string" },
        "data-ids": { type: "string" },
        "initial-cash": { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const strategyId = nonEmpty(parsed.values["strategy-id"]);
    if (!strategyId) {
      throw new Error("--strategy-id is required.");
    }

    const output = parseOutputMode(parsed.values.output);
    const response = await api.createBacktestV1({
      strategyId,
      createBacktestRequest: parseCreateBacktestRequest(parsed.values),
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const backtest = serial.backtest as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "backtest create", ...serial },
      {
        title: "backtest create",
        notes: [`requestId: ${response.requestId}`],
        rows: [serializeBacktestTable(backtest)],
        columns: ["id", "strategyId", "status", "startedAt", "completedAt", "createdAt"],
      },
    );
    return;
  }

  if (subcommand === "get") {
    const api = createBacktestsApiClient(context);
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "backtest-id": { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const backtestId = nonEmpty(parsed.values["backtest-id"]);
    if (!backtestId) {
      throw new Error("--backtest-id is required.");
    }
    const output = parseOutputMode(parsed.values.output);
    const response = await api.getBacktestV1({
      backtestId,
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const backtest = serial.backtest as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "backtest get", ...serial },
      {
        title: "backtest get",
        notes: [`requestId: ${response.requestId}`],
        rows: [serializeBacktestTable(backtest)],
        columns: ["id", "strategyId", "status", "startedAt", "completedAt", "createdAt"],
      },
    );
    return;
  }

  throw new Error(`Unknown backtest subcommand '${subcommand}'. Use 'create', 'get', or 'export'.`);
}

function parseCreateDeploymentRequest(values: ParsedValues): CreateDeploymentRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<CreateDeploymentRequest>(inputPath, "deploy create payload");
  }

  const strategyId = nonEmpty(values["strategy-id"]);
  const mode = nonEmpty(values.mode)?.toLowerCase();
  const capitalRaw = nonEmpty(values.capital);
  if (!strategyId) {
    throw new Error("--strategy-id is required when --input is not provided.");
  }
  if (!mode || (mode !== "paper" && mode !== "live")) {
    throw new Error("--mode is required when --input is not provided and must be paper|live.");
  }
  if (!capitalRaw) {
    throw new Error("--capital is required when --input is not provided.");
  }

  return {
    strategyId,
    mode: mode as CreateDeploymentRequest["mode"],
    capital: parseNumeric(capitalRaw, "--capital"),
  };
}

async function runDeployCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "deploy",
      usage: [
        "trading-cli deploy create --strategy-id <id> --mode paper|live --capital <amount> [--idempotency-key <key>] [--output json|table]",
        "trading-cli deploy create --input <create-deployment.json> [--idempotency-key <key>] [--output json|table]",
        "trading-cli deploy get --deployment-id <id> [--output json|table]",
        "trading-cli deploy list [--status queued|running|paused|stopping|stopped|failed] [--cursor <token>] [--output json|table]",
        "trading-cli deploy stop --deployment-id <id> [--reason <text>] [--output json|table]",
      ],
    });
    return;
  }

  const api = createDeploymentsApiClient(context);

  if (subcommand === "create") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        input: { type: "string" },
        "strategy-id": { type: "string" },
        mode: { type: "string" },
        capital: { type: "string" },
        "request-id": { type: "string" },
        "idempotency-key": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const output = parseOutputMode(parsed.values.output);
    const response = await api.createDeploymentV1({
      idempotencyKey: parseIdempotencyKey(parsed.values),
      createDeploymentRequest: parseCreateDeploymentRequest(parsed.values),
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const deployment = serial.deployment as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "deploy create", ...serial },
      {
        title: "deploy create",
        notes: [`requestId: ${response.requestId}`],
        rows: [toDeploymentTableRow(deployment)],
        columns: ["id", "strategyId", "mode", "status", "capital", "latestPnl"],
      },
    );
    return;
  }

  if (subcommand === "get") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "deployment-id": { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const deploymentId = nonEmpty(parsed.values["deployment-id"]);
    if (!deploymentId) {
      throw new Error("--deployment-id is required.");
    }
    const output = parseOutputMode(parsed.values.output);
    const response = await api.getDeploymentV1({
      deploymentId,
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const deployment = serial.deployment as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "deploy get", ...serial },
      {
        title: "deploy get",
        notes: [`requestId: ${response.requestId}`],
        rows: [toDeploymentTableRow(deployment)],
        columns: ["id", "strategyId", "mode", "status", "capital", "latestPnl"],
      },
    );
    return;
  }

  if (subcommand === "list") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        status: { type: "string" },
        cursor: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const output = parseOutputMode(parsed.values.output);
    const status = parseEnumValue<DeploymentStatus>(
      parsed.values.status,
      "--status",
      DEPLOYMENT_STATUSES,
    );
    const response = await api.listDeploymentsV1({
      xRequestId: parseRequestId(parsed.values),
      status,
      cursor: nonEmpty(parsed.values.cursor),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const items = (serial.items as Record<string, unknown>[]) ?? [];
    emitOutput(
      context,
      output,
      { status: "ok", command: "deploy list", ...serial },
      {
        title: "deploy list",
        notes: [`requestId: ${response.requestId}`, `nextCursor: ${response.nextCursor ?? "-"}`],
        rows: items.map((item) => toDeploymentTableRow(item)),
        columns: ["id", "strategyId", "mode", "status", "capital", "latestPnl"],
      },
    );
    return;
  }

  if (subcommand === "stop") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "deployment-id": { type: "string" },
        reason: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const deploymentId = nonEmpty(parsed.values["deployment-id"]);
    if (!deploymentId) {
      throw new Error("--deployment-id is required.");
    }
    const output = parseOutputMode(parsed.values.output);
    const reason = nonEmpty(parsed.values.reason);

    const response = await api.stopDeploymentV1({
      deploymentId,
      xRequestId: parseRequestId(parsed.values),
      stopDeploymentV1Request: reason ? { reason } : undefined,
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const deployment = serial.deployment as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "deploy stop", ...serial },
      {
        title: "deploy stop",
        notes: [`requestId: ${response.requestId}`],
        rows: [toDeploymentTableRow(deployment)],
        columns: ["id", "strategyId", "mode", "status", "capital", "latestPnl"],
      },
    );
    return;
  }

  throw new Error(`Unknown deploy subcommand '${subcommand}'. Use 'create', 'get', 'list', or 'stop'.`);
}

async function runPortfolioCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "portfolio",
      usage: [
        "trading-cli portfolio list [--output json|table]",
        "trading-cli portfolio get --portfolio-id <id> [--output json|table]",
      ],
    });
    return;
  }

  const api = createPortfoliosApiClient(context);

  if (subcommand === "list") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    const output = parseOutputMode(parsed.values.output);

    const response = await api.listPortfoliosV1({
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const items = (serial.items as Record<string, unknown>[]) ?? [];
    emitOutput(
      context,
      output,
      { status: "ok", command: "portfolio list", ...serial },
      {
        title: "portfolio list",
        notes: [`requestId: ${response.requestId}`],
        rows: items.map((item) => toPortfolioTableRow(item)),
        columns: ["id", "mode", "cash", "totalValue", "pnlTotal", "positions"],
      },
    );
    return;
  }

  if (subcommand === "get") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "portfolio-id": { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    const portfolioId = nonEmpty(parsed.values["portfolio-id"]);
    if (!portfolioId) {
      throw new Error("--portfolio-id is required.");
    }
    const output = parseOutputMode(parsed.values.output);
    const response = await api.getPortfolioV1({
      portfolioId,
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const portfolio = serial.portfolio as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "portfolio get", ...serial },
      {
        title: "portfolio get",
        notes: [`requestId: ${response.requestId}`],
        rows: [toPortfolioTableRow(portfolio)],
        columns: ["id", "mode", "cash", "totalValue", "pnlTotal", "positions"],
      },
    );
    return;
  }

  throw new Error(`Unknown portfolio subcommand '${subcommand}'. Use 'list' or 'get'.`);
}

function parseCreateOrderRequest(values: ParsedValues): CreateOrderRequest {
  const inputPath = nonEmpty(values.input);
  if (!inputPath) {
    throw new Error("--input is required for order create.");
  }
  return parseJsonFile<CreateOrderRequest>(inputPath, "order create payload");
}

async function runOrderCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    context.emit({
      status: "ok",
      command: "order",
      usage: [
        "trading-cli order create --input <create-order.json> [--idempotency-key <key>] [--output json|table]",
        "trading-cli order get --order-id <id> [--output json|table]",
        "trading-cli order list [--status pending|filled|cancelled|failed] [--cursor <token>] [--output json|table]",
        "trading-cli order cancel --order-id <id> [--output json|table]",
      ],
    });
    return;
  }

  const api = createOrdersApiClient(context);

  if (subcommand === "create") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        input: { type: "string" },
        "request-id": { type: "string" },
        "idempotency-key": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    const output = parseOutputMode(parsed.values.output);

    const response = await api.createOrderV1({
      idempotencyKey: parseIdempotencyKey(parsed.values),
      createOrderRequest: parseCreateOrderRequest(parsed.values),
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const order = serial.order as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "order create", ...serial },
      {
        title: "order create",
        notes: [`requestId: ${response.requestId}`],
        rows: [toOrderTableRow(order)],
        columns: ["id", "symbol", "side", "type", "quantity", "status", "createdAt"],
      },
    );
    return;
  }

  if (subcommand === "get") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "order-id": { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
    const orderId = nonEmpty(parsed.values["order-id"]);
    if (!orderId) {
      throw new Error("--order-id is required.");
    }
    const output = parseOutputMode(parsed.values.output);

    const response = await api.getOrderV1({
      orderId,
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const order = serial.order as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "order get", ...serial },
      {
        title: "order get",
        notes: [`requestId: ${response.requestId}`],
        rows: [toOrderTableRow(order)],
        columns: ["id", "symbol", "side", "type", "quantity", "status", "createdAt"],
      },
    );
    return;
  }

  if (subcommand === "list") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        status: { type: "string" },
        cursor: { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const output = parseOutputMode(parsed.values.output);
    const status = parseEnumValue<OrderStatus>(parsed.values.status, "--status", ORDER_STATUSES);
    const response = await api.listOrdersV1({
      xRequestId: parseRequestId(parsed.values),
      status,
      cursor: nonEmpty(parsed.values.cursor),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const items = (serial.items as Record<string, unknown>[]) ?? [];
    emitOutput(
      context,
      output,
      { status: "ok", command: "order list", ...serial },
      {
        title: "order list",
        notes: [`requestId: ${response.requestId}`, `nextCursor: ${response.nextCursor ?? "-"}`],
        rows: items.map((item) => toOrderTableRow(item)),
        columns: ["id", "symbol", "side", "type", "quantity", "status", "createdAt"],
      },
    );
    return;
  }

  if (subcommand === "cancel") {
    const parsed = parseArgs({
      args: args.slice(1),
      options: {
        "order-id": { type: "string" },
        "request-id": { type: "string" },
        output: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });

    const orderId = nonEmpty(parsed.values["order-id"]);
    if (!orderId) {
      throw new Error("--order-id is required.");
    }
    const output = parseOutputMode(parsed.values.output);
    const response = await api.cancelOrderV1({
      orderId,
      xRequestId: parseRequestId(parsed.values),
    });

    const serial = toSerializable(response) as Record<string, unknown>;
    const order = serial.order as Record<string, unknown>;
    emitOutput(
      context,
      output,
      { status: "ok", command: "order cancel", ...serial },
      {
        title: "order cancel",
        notes: [`requestId: ${response.requestId}`],
        rows: [toOrderTableRow(order)],
        columns: ["id", "symbol", "side", "type", "quantity", "status", "createdAt"],
      },
    );
    return;
  }

  throw new Error(`Unknown order subcommand '${subcommand}'. Use 'create', 'get', 'list', or 'cancel'.`);
}

export async function runCoreCommand(args: string[], context: CommandContext): Promise<void> {
  const group = args[0];
  if (!group || group === "--help" || group === "-h") {
    context.emit({
      status: "ok",
      command: "core",
      groups: ["health", "research", "knowledge", "strategy", "backtest", "deploy", "portfolio", "order"],
    });
    return;
  }

  if (group === "health") {
    await runHealthCommand(args.slice(1), context);
    return;
  }

  if (group === "research") {
    await runResearchCommand(args.slice(1), context);
    return;
  }

  if (group === "knowledge") {
    await runKnowledgeCommand(args.slice(1), context);
    return;
  }

  if (group === "strategy") {
    await runStrategyCommand(args.slice(1), context);
    return;
  }

  if (group === "backtest") {
    await runBacktestCommand(args.slice(1), context);
    return;
  }

  if (group === "deploy") {
    await runDeployCommand(args.slice(1), context);
    return;
  }

  if (group === "portfolio") {
    await runPortfolioCommand(args.slice(1), context);
    return;
  }

  if (group === "order") {
    await runOrderCommand(args.slice(1), context);
    return;
  }

  throw new Error(`Unsupported core command group '${group}'.`);
}

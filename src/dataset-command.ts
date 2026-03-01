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
import { DatasetPublishMode, type DatasetUploadCompleteRequest, type DatasetUploadInitRequest, type DatasetValidateRequest } from "./generated/trade-nexus-sdk";
import { createDatasetsApiClient } from "./platform-api-sdk";

type ParsedValues = ReturnType<typeof parseArgs>["values"];

const DATASET_REQUEST_ID_PREFIX = "req-dataset";
const DATASET_PUBLISH_MODES = new Set<string>(Object.values(DatasetPublishMode));

type TableOutput = {
  title?: string;
  rows: TableRow[];
  columns: string[];
  notes?: string[];
  emptyMessage?: string;
};

function parseRequestId(values: ParsedValues): string {
  return deriveRequestId(DATASET_REQUEST_ID_PREFIX, nonEmpty(values["request-id"]));
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

function parseIntValue(value: unknown, label: string): number {
  const raw = nonEmpty(value);
  if (!raw) {
    throw new Error(`${label} is required.`);
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

function parseDatasetTable(dataset: Record<string, unknown>): TableRow {
  return {
    id: dataset.id as string,
    filename: dataset.filename as string,
    contentType: dataset.contentType as string,
    sizeBytes: dataset.sizeBytes as number,
    status: dataset.status as string,
    providerDataId: dataset.providerDataId as string | null | undefined,
    updatedAt: dataset.updatedAt as string,
  };
}

function parseInitRequest(values: ParsedValues): DatasetUploadInitRequest {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<DatasetUploadInitRequest>(inputPath, "dataset upload init payload");
  }

  const filename = nonEmpty(values.filename);
  const contentType = nonEmpty(values["content-type"]);
  const sizeBytes = parseIntValue(values["size-bytes"], "--size-bytes");
  if (!filename) {
    throw new Error("--filename is required when --input is not provided.");
  }
  if (!contentType) {
    throw new Error("--content-type is required when --input is not provided.");
  }

  return {
    filename,
    contentType,
    sizeBytes,
  };
}

function parseUploadCompleteRequest(values: ParsedValues): DatasetUploadCompleteRequest | undefined {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<DatasetUploadCompleteRequest>(inputPath, "dataset upload complete payload");
  }
  const uploadToken = nonEmpty(values["upload-token"]);
  if (!uploadToken) {
    return undefined;
  }
  return { uploadToken };
}

function parseValidateRequest(values: ParsedValues): DatasetValidateRequest | undefined {
  const inputPath = nonEmpty(values.input);
  if (inputPath) {
    return parseJsonFile<DatasetValidateRequest>(inputPath, "dataset validate payload");
  }
  const mappingRaw = nonEmpty(values["column-mapping-json"]);
  if (!mappingRaw) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(mappingRaw);
  } catch (error) {
    throw new Error(
      `Unable to parse --column-mapping-json: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--column-mapping-json must be a JSON object.");
  }
  return {
    columnMapping: parsed as Record<string, string>,
  };
}

async function runUploadInitCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      input: { type: "string" },
      filename: { type: "string" },
      "content-type": { type: "string" },
      "size-bytes": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const output = parseOutputMode(parsed.values.output);
  const api = createDatasetsApiClient(context);
  const response = await api.initDatasetUploadV1({
    datasetUploadInitRequest: parseInitRequest(parsed.values),
    xRequestId: parseRequestId(parsed.values),
  });

  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "dataset upload init",
      requestId: response.requestId,
      datasetId: response.datasetId,
      uploadUrl: response.uploadUrl,
      datasetStatus: response.status,
    },
    {
      title: "dataset upload init",
      notes: [`requestId: ${response.requestId}`],
      rows: [
        {
          datasetId: response.datasetId,
          status: response.status,
          uploadUrl: response.uploadUrl,
        },
      ],
      columns: ["datasetId", "status", "uploadUrl"],
    },
  );
}

async function runUploadCompleteCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "dataset-id": { type: "string" },
      input: { type: "string" },
      "upload-token": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const datasetId = nonEmpty(parsed.values["dataset-id"]);
  if (!datasetId) {
    throw new Error("--dataset-id is required.");
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createDatasetsApiClient(context);
  const response = await api.completeDatasetUploadV1({
    datasetId,
    xRequestId: parseRequestId(parsed.values),
    datasetUploadCompleteRequest: parseUploadCompleteRequest(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const dataset = serial.dataset as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "dataset upload complete",
      ...serial,
    },
    {
      title: "dataset upload complete",
      notes: [`requestId: ${response.requestId}`],
      rows: [parseDatasetTable(dataset)],
      columns: ["id", "filename", "contentType", "sizeBytes", "status", "providerDataId", "updatedAt"],
    },
  );
}

async function runValidateCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "dataset-id": { type: "string" },
      input: { type: "string" },
      "column-mapping-json": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const datasetId = nonEmpty(parsed.values["dataset-id"]);
  if (!datasetId) {
    throw new Error("--dataset-id is required.");
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createDatasetsApiClient(context);
  const response = await api.validateDatasetV1({
    datasetId,
    xRequestId: parseRequestId(parsed.values),
    datasetValidateRequest: parseValidateRequest(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const dataset = serial.dataset as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "dataset validate",
      ...serial,
    },
    {
      title: "dataset validate",
      notes: [`requestId: ${response.requestId}`],
      rows: [parseDatasetTable(dataset)],
      columns: ["id", "filename", "contentType", "sizeBytes", "status", "providerDataId", "updatedAt"],
    },
  );
}

async function runTransformCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "dataset-id": { type: "string" },
      input: { type: "string" },
      frequency: { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const datasetId = nonEmpty(parsed.values["dataset-id"]);
  if (!datasetId) {
    throw new Error("--dataset-id is required.");
  }

  let transformRequest;
  const inputPath = nonEmpty(parsed.values.input);
  if (inputPath) {
    transformRequest = parseJsonFile<{ frequency: string }>(inputPath, "dataset transform payload");
  } else {
    const frequency = nonEmpty(parsed.values.frequency);
    if (!frequency) {
      throw new Error("--frequency is required when --input is not provided.");
    }
    transformRequest = { frequency };
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createDatasetsApiClient(context);
  const response = await api.transformDatasetCandlesV1({
    datasetId,
    datasetTransformCandlesRequest: transformRequest,
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const dataset = serial.dataset as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "dataset transform",
      ...serial,
    },
    {
      title: "dataset transform",
      notes: [`requestId: ${response.requestId}`],
      rows: [parseDatasetTable(dataset)],
      columns: ["id", "filename", "contentType", "sizeBytes", "status", "providerDataId", "updatedAt"],
    },
  );
}

async function runPublishCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "dataset-id": { type: "string" },
      input: { type: "string" },
      mode: { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const datasetId = nonEmpty(parsed.values["dataset-id"]);
  if (!datasetId) {
    throw new Error("--dataset-id is required.");
  }

  let publishRequest: { mode?: DatasetPublishMode } | undefined;
  const inputPath = nonEmpty(parsed.values.input);
  if (inputPath) {
    publishRequest = parseJsonFile<{ mode?: DatasetPublishMode }>(inputPath, "dataset publish payload");
  } else {
    const mode = nonEmpty(parsed.values.mode)?.toLowerCase();
    if (mode) {
      if (!DATASET_PUBLISH_MODES.has(mode)) {
        throw new Error(`--mode must be one of: ${Array.from(DATASET_PUBLISH_MODES).join(", ")}.`);
      }
      publishRequest = { mode: mode as DatasetPublishMode };
    }
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createDatasetsApiClient(context);
  const response = await api.publishDatasetLonaV1({
    datasetId,
    xRequestId: parseRequestId(parsed.values),
    datasetPublishLonaRequest: publishRequest,
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const dataset = serial.dataset as Record<string, unknown>;
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "dataset publish",
      ...serial,
    },
    {
      title: "dataset publish",
      notes: [`requestId: ${response.requestId}`],
      rows: [parseDatasetTable(dataset)],
      columns: ["id", "filename", "contentType", "sizeBytes", "status", "providerDataId", "updatedAt"],
    },
  );
}

async function runGetOrStatusCommand(
  args: string[],
  context: CommandContext,
  commandLabel: "dataset get" | "dataset status",
): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      "dataset-id": { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const datasetId = nonEmpty(parsed.values["dataset-id"]);
  if (!datasetId) {
    throw new Error("--dataset-id is required.");
  }

  const output = parseOutputMode(parsed.values.output);
  const api = createDatasetsApiClient(context);
  const response = await api.getDatasetV1({
    datasetId,
    xRequestId: parseRequestId(parsed.values),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const dataset = serial.dataset as Record<string, unknown>;

  if (commandLabel === "dataset status") {
    emitOutput(
      context,
      output,
      {
        status: "ok",
        command: commandLabel,
        requestId: serial.requestId,
        dataset: {
          id: dataset.id,
          status: dataset.status,
          providerDataId: dataset.providerDataId,
          updatedAt: dataset.updatedAt,
        },
      },
      {
        title: "dataset status",
        notes: [`requestId: ${String(serial.requestId)}`],
        rows: [
          {
            id: dataset.id as string,
            status: dataset.status as string,
            providerDataId: dataset.providerDataId as string | null | undefined,
            updatedAt: dataset.updatedAt as string,
          },
        ],
        columns: ["id", "status", "providerDataId", "updatedAt"],
      },
    );
    return;
  }

  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: commandLabel,
      ...serial,
    },
    {
      title: "dataset get",
      notes: [`requestId: ${response.requestId}`],
      rows: [parseDatasetTable(dataset)],
      columns: ["id", "filename", "contentType", "sizeBytes", "status", "providerDataId", "updatedAt"],
    },
  );
}

async function runListCommand(args: string[], context: CommandContext): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      cursor: { type: "string" },
      "request-id": { type: "string" },
      output: { type: "string" },
    },
    allowPositionals: false,
    strict: true,
  });

  const output = parseOutputMode(parsed.values.output);
  const api = createDatasetsApiClient(context);
  const response = await api.listDatasetsV1({
    xRequestId: parseRequestId(parsed.values),
    cursor: nonEmpty(parsed.values.cursor),
  });

  const serial = toSerializable(response) as Record<string, unknown>;
  const items = (serial.items as Record<string, unknown>[]) ?? [];
  emitOutput(
    context,
    output,
    {
      status: "ok",
      command: "dataset list",
      ...serial,
    },
    {
      title: "dataset list",
      notes: [`requestId: ${response.requestId}`, `nextCursor: ${response.nextCursor ?? "-"}`],
      rows: items.map((dataset) => parseDatasetTable(dataset)),
      columns: ["id", "filename", "contentType", "sizeBytes", "status", "providerDataId", "updatedAt"],
      emptyMessage: "No datasets found.",
    },
  );
}

function emitDatasetHelp(context: CommandContext): void {
  context.emit({
    status: "ok",
    command: "dataset",
    usage: [
      "trading-cli dataset upload init --filename btc.csv --content-type text/csv --size-bytes 1024 [--output json|table]",
      "trading-cli dataset upload init --input <init-upload.json> [--output json|table]",
      "trading-cli dataset upload complete --dataset-id <id> [--upload-token <token>] [--output json|table]",
      "trading-cli dataset validate --dataset-id <id> [--column-mapping-json '{\"timestamp\":\"ts\"}'] [--output json|table]",
      "trading-cli dataset transform --dataset-id <id> --frequency 1h [--output json|table]",
      "trading-cli dataset publish --dataset-id <id> [--mode explicit|just_in_time] [--output json|table]",
      "trading-cli dataset get --dataset-id <id> [--output json|table]",
      "trading-cli dataset status --dataset-id <id> [--output json|table]",
      "trading-cli dataset list [--cursor <token>] [--output json|table]",
    ],
  });
}

export async function runDatasetCommand(args: string[], context: CommandContext): Promise<void> {
  const subcommand = args[0];
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    emitDatasetHelp(context);
    return;
  }

  if (subcommand === "upload") {
    const uploadSubcommand = args[1];
    if (!uploadSubcommand || uploadSubcommand === "--help" || uploadSubcommand === "-h") {
      context.emit({
        status: "ok",
        command: "dataset upload",
        usage: [
          "trading-cli dataset upload init --filename <file> --content-type <mime> --size-bytes <bytes>",
          "trading-cli dataset upload complete --dataset-id <id> [--upload-token <token>]",
        ],
      });
      return;
    }
    if (uploadSubcommand === "init") {
      await runUploadInitCommand(args.slice(2), context);
      return;
    }
    if (uploadSubcommand === "complete") {
      await runUploadCompleteCommand(args.slice(2), context);
      return;
    }
    throw new Error(`Unknown dataset upload subcommand '${uploadSubcommand}'. Use 'init' or 'complete'.`);
  }

  if (subcommand === "init") {
    await runUploadInitCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "complete") {
    await runUploadCompleteCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "validate") {
    await runValidateCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "transform") {
    await runTransformCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "publish") {
    await runPublishCommand(args.slice(1), context);
    return;
  }
  if (subcommand === "get") {
    await runGetOrStatusCommand(args.slice(1), context, "dataset get");
    return;
  }
  if (subcommand === "status") {
    await runGetOrStatusCommand(args.slice(1), context, "dataset status");
    return;
  }
  if (subcommand === "list") {
    await runListCommand(args.slice(1), context);
    return;
  }

  throw new Error(
    `Unknown dataset subcommand '${subcommand}'. Use 'upload', 'validate', 'transform', 'publish', 'get', 'status', or 'list'.`,
  );
}

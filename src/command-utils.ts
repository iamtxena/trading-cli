import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

export type CommandContext = {
  baseUrl: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  emit: (payload: unknown) => void;
};

export type OutputMode = "json" | "table";
export type TableCell = string | number | boolean | null | undefined;
export type TableRow = Record<string, TableCell>;

export function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseJsonFile<T>(path: string, label: string): T {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    throw new Error(
      `Unable to parse ${label} at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function deriveRequestId(prefix: string, seed?: string): string {
  if (seed) {
    return seed;
  }
  return `${prefix}-${Date.now()}`;
}

export function deriveIdempotencyKey(prefix: string, seed?: string): string {
  if (seed) {
    return seed;
  }
  return `${prefix}-${randomUUID()}`;
}

export function parseOutputMode(value: unknown): OutputMode {
  const normalized = nonEmpty(value)?.toLowerCase();
  if (!normalized || normalized === "json") {
    return "json";
  }
  if (normalized === "table") {
    return "table";
  }
  throw new Error("Unsupported --output value. Use 'json' or 'table'.");
}

export function toSerializable(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => toSerializable(item));
  }

  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = toSerializable(item);
    }
    return result;
  }

  return value;
}

function stringifyTableCell(value: TableCell): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function formatTable(rows: TableRow[], columns: string[]): string {
  if (rows.length === 0) {
    return "(no rows)";
  }

  const widths = columns.map((column) =>
    Math.max(column.length, ...rows.map((row) => stringifyTableCell(row[column]).length)),
  );

  const renderLine = (values: string[]) =>
    values.map((value, index) => value.padEnd(widths[index] ?? value.length)).join(" | ");

  const header = renderLine(columns);
  const separator = widths.map((width) => "-".repeat(width)).join("-+-");
  const body = rows
    .map((row) => renderLine(columns.map((column) => stringifyTableCell(row[column]))))
    .join("\n");

  return `${header}\n${separator}\n${body}`;
}

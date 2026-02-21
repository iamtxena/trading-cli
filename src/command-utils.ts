import { readFileSync } from "node:fs";

export type CommandContext = {
  baseUrl: string;
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  emit: (payload: unknown) => void;
};

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

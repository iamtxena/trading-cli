import { afterEach, describe, expect, test } from "bun:test";

import { runCoreCommand } from "../../src/core-command";
import type { CommandContext } from "../../src/command-utils";

type RecordedRequest = {
  path: string;
  method: string;
  headers: Headers;
  body?: unknown;
};

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_LOG = console.log;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createContext(
  fetchImpl: typeof fetch,
  env: NodeJS.ProcessEnv = { PLATFORM_API_BEARER_TOKEN: "token-unit-core-001" },
): { context: CommandContext; emitted: unknown[] } {
  const emitted: unknown[] = [];
  return {
    emitted,
    context: {
      baseUrl: "http://localhost:3000",
      env,
      fetchImpl,
      emit: (payload: unknown) => {
        emitted.push(payload);
      },
    },
  };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_LOG;
});

describe("runCoreCommand unit parsing/output", () => {
  test("backtest export create validates required dataset ids", async () => {
    const fetchMock = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const { context } = createContext(fetchMock);

    await expect(runCoreCommand(["backtest", "export", "create"], context)).rejects.toThrow(
      "--dataset-ids is required when --input is not provided.",
    );
  });

  test("new command help surfaces usage for health/knowledge/backtest export", async () => {
    const fetchMock = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const { context, emitted } = createContext(fetchMock);

    await runCoreCommand(["health", "--help"], context);
    await runCoreCommand(["knowledge", "--help"], context);
    await runCoreCommand(["backtest", "export", "--help"], context);

    const healthHelp = emitted[0] as { command: string; usage: string[] };
    const knowledgeHelp = emitted[1] as { command: string; usage: string[] };
    const exportHelp = emitted[2] as { command: string; usage: string[] };

    expect(healthHelp.command).toBe("health");
    expect(healthHelp.usage).toContain("trading-cli health get [--output json|table]");
    expect(knowledgeHelp.command).toBe("knowledge");
    expect(knowledgeHelp.usage).toContain(
      "trading-cli knowledge search --query \"momentum\" [--assets btc,eth] [--limit 10] [--output json|table]",
    );
    expect(exportHelp.command).toBe("backtest export");
    expect(exportHelp.usage).toContain(
      "trading-cli backtest export get --export-id <id> [--output json|table]",
    );
  });

  test("knowledge search table output includes expected columns and request payload", async () => {
    const logs: string[] = [];
    const requests: RecordedRequest[] = [];
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, headers, body });

      if (url.pathname === "/v2/knowledge/search" && method === "POST") {
        return jsonResponse({
          requestId: "req-knowledge-search-unit-001",
          items: [
            {
              kind: "pattern",
              id: "kp-123",
              title: "Momentum breakout",
              summary: "Breakout with trend confirmation.",
              score: 0.91,
              evidence: {},
            },
          ],
        });
      }

      return jsonResponse(
        {
          requestId: "req-unexpected",
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
        },
        404,
      );
    }) as typeof fetch;

    const { context } = createContext(fetchMock);
    await runCoreCommand(
      [
        "knowledge",
        "search",
        "--query",
        "momentum",
        "--assets",
        "btc,eth",
        "--limit",
        "2",
        "--request-id",
        "req-core-fixed-unit-001",
        "--output",
        "table",
      ],
      context,
    );

    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/v2/knowledge/search");
    expect(requests[0]?.method).toBe("POST");
    expect(requests[0]?.headers.get("X-Request-Id")).toBe("req-core-fixed-unit-001");
    expect(requests[0]?.body).toEqual({
      query: "momentum",
      assets: ["btc", "eth"],
      limit: 2,
    });

    expect(logs.at(-1) ?? "").toContain("knowledge search");
    expect(logs.at(-1) ?? "").toContain("kind");
    expect(logs.at(-1) ?? "").toContain("Momentum breakout");
  });

  test("health get emits json payload without auth requirement", async () => {
    const requests: RecordedRequest[] = [];
    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({ path: url.pathname, method, headers });

      if (url.pathname === "/v1/health" && method === "GET") {
        return jsonResponse({
          status: "ok",
          service: "platform-api",
          timestamp: "2026-03-01T12:34:56Z",
        });
      }

      return jsonResponse(
        {
          requestId: "req-unexpected",
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
        },
        404,
      );
    }) as typeof fetch;

    const { context, emitted } = createContext(fetchMock, {});
    await runCoreCommand(["health", "get"], context);

    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/v1/health");
    expect(requests[0]?.headers.get("Authorization")).toBeNull();

    expect(emitted).toEqual([
      {
        status: "ok",
        command: "health get",
        health: {
          status: "ok",
          service: "platform-api",
          timestamp: "2026-03-01T12:34:56.000Z",
        },
      },
    ]);
  });
});

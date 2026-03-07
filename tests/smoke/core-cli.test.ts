import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

import { run } from "../../src/cli";

type RecordedRequest = {
  path: string;
  method: string;
  headers: Headers;
  body?: unknown;
};

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_LOG = console.log;
const ORIGINAL_ERROR = console.error;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_LOG;
  console.error = ORIGINAL_ERROR;
  delete process.env.PLATFORM_API_BASE_URL;
  delete process.env.PLATFORM_API_BEARER_TOKEN;
  delete process.env.PLATFORM_API_TOKEN;
  delete process.env.PLATFORM_API_KEY;
});

describe("core command groups", () => {
  test("health/research/knowledge/strategy/backtest/deploy/portfolio/order map to canonical endpoints", async () => {
    const requests: RecordedRequest[] = [];
    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-core-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, headers, body });

      if (url.pathname === "/v2/research/market-scan" && method === "POST") {
        return jsonResponse({
          requestId: "req-research-001",
          regimeSummary: "risk-on",
          strategyIdeas: [
            {
              name: "Breakout",
              assetClass: "crypto",
              description: "Momentum breakout",
            },
          ],
          knowledgeEvidence: [],
          dataContextSummary: "none",
        });
      }

      if (url.pathname === "/v2/knowledge/search" && method === "POST") {
        return jsonResponse({
          requestId: "req-knowledge-search-001",
          items: [
            {
              kind: "pattern",
              id: "kp-001",
              title: "Momentum breakout",
              summary: "Break resistance with trend confirmation.",
              score: 0.93,
              evidence: {},
            },
          ],
        });
      }

      if (url.pathname === "/v2/knowledge/patterns" && method === "GET") {
        return jsonResponse({
          requestId: "req-knowledge-patterns-001",
          items: [
            {
              id: "kp-001",
              name: "Momentum breakout",
              type: "momentum",
              description: "Breakout pattern",
              suitableRegimes: ["risk-on"],
              assets: ["btc"],
              timeframes: ["1h"],
              confidenceScore: 0.9,
              sourceRef: null,
              schemaVersion: "knowledge.pattern.v1",
              createdAt: "2026-03-01T08:00:00Z",
              updatedAt: "2026-03-01T08:00:00Z",
            },
          ],
        });
      }

      if (url.pathname === "/v2/knowledge/regimes/btc" && method === "GET") {
        return jsonResponse({
          requestId: "req-knowledge-regime-001",
          regime: {
            id: "regime-001",
            asset: "btc",
            regime: "risk-on",
            volatility: "medium",
            indicators: { rsi: 58.2 },
            startAt: "2026-03-01T06:00:00Z",
            endAt: null,
            notes: null,
            schemaVersion: "knowledge.regime.v1",
            createdAt: "2026-03-01T06:00:00Z",
          },
        });
      }

      if (url.pathname === "/v1/strategies" && method === "GET") {
        return jsonResponse({
          requestId: "req-strategy-list-001",
          items: [
            {
              id: "strat-001",
              name: "Breakout",
              status: "tested",
              provider: "lona",
              providerRefId: "provider-001",
              tags: ["momentum"],
              createdAt: "2026-03-01T10:00:00Z",
              updatedAt: "2026-03-01T10:00:00Z",
            },
          ],
          nextCursor: null,
        });
      }

      if (url.pathname === "/v2/data/exports/backtest" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-backtest-export-create-001",
            export: {
              id: "export-001",
              status: "queued",
              datasetIds: ["dataset-001"],
              assetClasses: ["crypto"],
              downloadUrl: null,
              lineage: {},
              createdAt: "2026-03-01T05:00:00Z",
              updatedAt: "2026-03-01T05:00:00Z",
            },
          },
          202,
        );
      }

      if (url.pathname === "/v2/data/exports/export-001" && method === "GET") {
        return jsonResponse({
          requestId: "req-backtest-export-get-001",
          export: {
            id: "export-001",
            status: "completed",
            datasetIds: ["dataset-001"],
            assetClasses: ["crypto"],
            downloadUrl: "https://downloads.local/export-001.zip",
            lineage: {},
            createdAt: "2026-03-01T05:00:00Z",
            updatedAt: "2026-03-01T05:10:00Z",
          },
        });
      }

      if (url.pathname === "/v1/health" && method === "GET") {
        return jsonResponse({
          status: "ok",
          service: "platform-api",
          timestamp: "2026-03-01T12:34:56Z",
        });
      }

      if (url.pathname === "/v1/backtests/backtest-001" && method === "GET") {
        return jsonResponse({
          requestId: "req-backtest-get-001",
          backtest: {
            id: "backtest-001",
            strategyId: "strat-001",
            status: "completed",
            startedAt: "2026-02-01T00:00:00Z",
            completedAt: "2026-02-02T00:00:00Z",
            metrics: { pnlPct: 3.2 },
            error: null,
            createdAt: "2026-02-01T00:00:00Z",
          },
        });
      }

      if (url.pathname === "/v1/deployments" && method === "GET") {
        return jsonResponse({
          requestId: "req-deploy-list-001",
          items: [
            {
              id: "deploy-001",
              strategyId: "strat-001",
              mode: "paper",
              status: "running",
              capital: 10000,
              latestPnl: 120.5,
              createdAt: "2026-03-01T08:00:00Z",
              updatedAt: "2026-03-01T10:00:00Z",
            },
          ],
          nextCursor: null,
        });
      }

      if (url.pathname === "/v1/portfolios" && method === "GET") {
        return jsonResponse({
          requestId: "req-portfolio-list-001",
          items: [
            {
              id: "portfolio-001",
              mode: "paper",
              cash: 9500,
              totalValue: 10120,
              pnlTotal: 120,
              positions: [],
            },
          ],
        });
      }

      if (url.pathname === "/v1/orders" && method === "GET") {
        return jsonResponse({
          requestId: "req-order-list-001",
          items: [
            {
              id: "order-001",
              symbol: "BTCUSDT",
              side: "buy",
              type: "market",
              quantity: 0.1,
              price: null,
              status: "filled",
              deploymentId: null,
              createdAt: "2026-03-01T11:00:00Z",
            },
          ],
          nextCursor: null,
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

    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "research",
          "scan",
          "--asset-classes",
          "crypto",
          "--capital",
          "25000",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(await run(["bun", "src/cli.ts", "health", "get"], fetchMock)).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "knowledge",
          "search",
          "--query",
          "breakout momentum",
          "--assets",
          "btc",
          "--limit",
          "5",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "knowledge",
          "patterns",
          "--type",
          "momentum",
          "--asset",
          "btc",
          "--limit",
          "10",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "knowledge", "regime", "--asset", "btc"],
        fetchMock,
      ),
    ).toBe(0);
    expect(await run(["bun", "src/cli.ts", "strategy", "list"], fetchMock)).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "backtest",
          "export",
          "create",
          "--dataset-ids",
          "dataset-001",
          "--asset-classes",
          "crypto",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "backtest", "export", "get", "--export-id", "export-001"],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(["bun", "src/cli.ts", "backtest", "get", "--backtest-id", "backtest-001"], fetchMock),
    ).toBe(0);
    expect(await run(["bun", "src/cli.ts", "deploy", "list"], fetchMock)).toBe(0);
    expect(await run(["bun", "src/cli.ts", "portfolio", "list"], fetchMock)).toBe(0);
    expect(await run(["bun", "src/cli.ts", "order", "list"], fetchMock)).toBe(0);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /v2/research/market-scan",
      "GET /v1/health",
      "POST /v2/knowledge/search",
      "GET /v2/knowledge/patterns",
      "GET /v2/knowledge/regimes/btc",
      "GET /v1/strategies",
      "POST /v2/data/exports/backtest",
      "GET /v2/data/exports/export-001",
      "GET /v1/backtests/backtest-001",
      "GET /v1/deployments",
      "GET /v1/portfolios",
      "GET /v1/orders",
    ]);

    const payloads = logs.map((entry) => JSON.parse(entry) as { command?: string; status?: string; requestId?: string });
    const researchPayload = payloads.find((payload) => payload.command === "research scan");
    const strategyPayload = payloads.find((payload) => payload.command === "strategy list");
    const healthPayload = payloads.find((payload) => payload.command === "health get");
    const exportPayload = payloads.find((payload) => payload.command === "backtest export create");

    expect(researchPayload?.status).toBe("ok");
    expect(researchPayload?.command).toBe("research scan");
    expect(strategyPayload?.command).toBe("strategy list");
    expect(strategyPayload?.requestId).toBe("req-strategy-list-001");
    expect(healthPayload?.status).toBe("ok");
    expect(exportPayload?.status).toBe("ok");
  });

  test("strategy get/list subcommand help bypasses auth and boundary validation", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const fetchMock = (async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    process.env.PLATFORM_API_BASE_URL = "https://api.binance.com";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    expect(await run(["bun", "src/cli.ts", "strategy", "list", "--help"], fetchMock)).toBe(0);
    expect(await run(["bun", "src/cli.ts", "strategy", "list", "-h"], fetchMock)).toBe(0);
    expect(await run(["bun", "src/cli.ts", "strategy", "get", "--help"], fetchMock)).toBe(0);
    expect(errors).toHaveLength(0);

    const listHelp = JSON.parse(logs[0] ?? "{}") as { command: string; usage: string[] };
    const listShortHelp = JSON.parse(logs[1] ?? "{}") as { command: string; usage: string[] };
    const getHelp = JSON.parse(logs[2] ?? "{}") as { command: string; usage: string[] };

    expect(listHelp.command).toBe("strategy list");
    expect(listHelp.usage).toEqual([
      "trading-cli strategy list [--status draft|testing|tested|deployable|archived|failed] [--cursor <token>] [--request-id <id>] [--output json|table]",
    ]);
    expect(listShortHelp).toEqual(listHelp);
    expect(getHelp.command).toBe("strategy get");
    expect(getHelp.usage).toEqual([
      "trading-cli strategy get --strategy-id <id> [--request-id <id>] [--output json|table]",
    ]);
  });

  test("strategy list rejects unsupported limit with explicit guidance before auth", async () => {
    const errors: string[] = [];
    const fetchMock = (async () => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    expect(await run(["bun", "src/cli.ts", "strategy", "list", "--limit", "1"], fetchMock)).toBe(1);

    const payload = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(payload.message).toBe("--limit is not supported for strategy list.");
  });

  test("deploy create sends idempotency header and table output is deterministic", async () => {
    const logs: string[] = [];
    const requests: RecordedRequest[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-core-002";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, headers, body });

      if (url.pathname === "/v1/deployments" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-deploy-create-001",
            deployment: {
              id: "deploy-002",
              strategyId: "strat-001",
              mode: "paper",
              status: "queued",
              capital: 12000,
              latestPnl: null,
              createdAt: "2026-03-01T12:00:00Z",
              updatedAt: "2026-03-01T12:00:00Z",
            },
          },
          202,
        );
      }

      return jsonResponse(
        {
          requestId: "req-unexpected",
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
        },
        404,
      );
    }) as typeof fetch;

    const exitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "deploy",
        "create",
        "--strategy-id",
        "strat-001",
        "--mode",
        "paper",
        "--capital",
        "12000",
        "--idempotency-key",
        "idem-core-fixed-001",
        "--request-id",
        "req-core-fixed-001",
        "--output",
        "table",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/v1/deployments");
    expect(requests[0]?.headers.get("Idempotency-Key")).toBe("idem-core-fixed-001");
    expect(requests[0]?.headers.get("X-Request-Id")).toBe("req-core-fixed-001");
    expect(logs.at(-1) ?? "").toContain("deploy create");
    expect(logs.at(-1) ?? "").toContain("id");
    expect(logs.at(-1) ?? "").toContain("deploy-002");
  });

  test("order create requires input payload file", async () => {
    const errors: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-core-003";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const exitCode = await run(["bun", "src/cli.ts", "order", "create"]);
    expect(exitCode).toBe(1);

    const envelope = JSON.parse(errors.at(-1) ?? "{}") as { status: string; message: string };
    expect(envelope.status).toBe("error");
    expect(envelope.message).toContain("--input is required");
  });

  test("order create accepts payload json file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "core-order-"));
    const payloadPath = join(tmp, "order.json");
    writeFileSync(payloadPath, JSON.stringify({ type: "market" }), "utf-8");

    const logs: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-core-004";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      if (url.pathname === "/v1/orders" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-order-create-001",
            order: {
              id: "order-002",
              symbol: "BTCUSDT",
              side: "buy",
              type: "market",
              quantity: 0.1,
              price: null,
              status: "pending",
              deploymentId: null,
              createdAt: "2026-03-01T12:15:00Z",
            },
          },
          201,
        );
      }
      return jsonResponse(
        {
          requestId: "req-unexpected",
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
        },
        404,
      );
    }) as typeof fetch;

    try {
      const exitCode = await run(
        ["bun", "src/cli.ts", "order", "create", "--input", payloadPath],
        fetchMock,
      );
      expect(exitCode).toBe(0);

      const payload = JSON.parse(logs.at(-1) ?? "{}") as {
        status: string;
        command: string;
        order: { id: string };
      };
      expect(payload.status).toBe("ok");
      expect(payload.command).toBe("order create");
      expect(payload.order.id).toBe("order-002");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

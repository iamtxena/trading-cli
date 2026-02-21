import { afterEach, describe, expect, test } from "bun:test";

import { run } from "../../src/cli";

type RecordedRequest = {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
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
  delete process.env.REVIEW_WEB_BASE_URL;
});

describe("review-run command", () => {
  test("trigger creates review run via generated SDK and returns stable web URL", async () => {
    const requests: RecordedRequest[] = [];
    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-test-123";
    process.env.REVIEW_WEB_BASE_URL = "https://trade-nexus.lona.agency";

    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;

      requests.push({
        url,
        method,
        headers,
        body,
      });

      if (url.pathname === "/v2/validation-runs" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-validation-run-create-001",
            run: {
              id: "valrun-20260220-0001",
              status: "queued",
              profile: "STANDARD",
              schemaVersion: "validation-run.v1",
              finalDecision: "pending",
              createdAt: "2026-02-20T18:00:00Z",
              updatedAt: "2026-02-20T18:00:00Z",
            },
          },
          202,
        );
      }

      if (
        url.pathname === "/v2/validation-review/runs/valrun-20260220-0001/renders" &&
        method === "POST"
      ) {
        return jsonResponse(
          {
            requestId: "req-validation-review-render-001",
            render: {
              runId: "valrun-20260220-0001",
              format: "html",
              status: "queued",
              artifactRef: null,
              downloadUrl: null,
              checksumSha256: null,
              expiresAt: null,
              requestedAt: "2026-02-20T18:00:30Z",
              updatedAt: "2026-02-20T18:00:30Z",
            },
          },
          202,
        );
      }

      return jsonResponse(
        {
          error: {
            code: "not_found",
            message: `Unexpected request: ${method} ${url.pathname}`,
          },
          requestId: "req-test-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const exitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "review-run",
        "trigger",
        "--strategy-id",
        "strat-001",
        "--requested-indicators",
        "ema,zigzag",
        "--dataset-ids",
        "dataset-btc-1h-2025",
        "--backtest-report-ref",
        "blob://validation/candidate/backtest.json",
        "--render",
        "html",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(requests.length).toBe(2);
    expect(requests[0].headers.get("Authorization")).toBe("Bearer token-test-123");
    expect(requests[0].headers.get("Idempotency-Key")).toContain("idem-review-run-");

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      status: string;
      runId: string;
      reviewWeb: {
        path: string;
        url: string;
      };
      renders: Array<{
        pending: boolean;
      }>;
    };

    expect(payload.status).toBe("ok");
    expect(payload.runId).toBe("valrun-20260220-0001");
    expect(payload.reviewWeb.path).toBe("/validation?runId=valrun-20260220-0001");
    expect(payload.reviewWeb.url).toBe("https://trade-nexus.lona.agency/validation?runId=valrun-20260220-0001");
    expect(payload.renders.length).toBe(1);
    expect(payload.renders[0]?.pending).toBe(true);
  });

  test("retrieve returns run summary and render pending signal", async () => {
    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-test-123";
    process.env.REVIEW_WEB_BASE_URL = "https://review-nexus.lona.agency";

    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname === "/v2/validation-review/runs/valrun-20260220-0002" && method === "GET") {
        return jsonResponse({
          requestId: "req-validation-review-run-001",
          artifact: {
            schemaVersion: "validation-review.v1",
            run: {
              id: "valrun-20260220-0002",
              status: "completed",
              profile: "STANDARD",
              schemaVersion: "validation-run.v1",
              finalDecision: "conditional_pass",
              createdAt: "2026-02-20T18:01:00Z",
              updatedAt: "2026-02-20T18:02:00Z",
            },
            artifact: {
              schemaVersion: "validation-run.v1",
              runId: "valrun-20260220-0002",
              createdAt: "2026-02-20T18:01:00Z",
              requestId: "req-validation-run-001",
              tenantId: "tenant-001",
              userId: "user-001",
              strategyRef: {
                strategyId: "strat-001",
                provider: "lona",
                providerRefId: "lona-strategy-001",
              },
              inputs: {
                prompt: "Build zig-zag strategy",
                requestedIndicators: ["ema"],
                datasetIds: ["dataset-btc-1h-2025"],
                backtestReportRef: "blob://validation/valrun-20260220-0002/backtest.json",
              },
              outputs: {
                strategyCodeRef: "blob://validation/valrun-20260220-0002/strategy.py",
                backtestReportRef: "blob://validation/valrun-20260220-0002/backtest.json",
                tradesRef: "blob://validation/valrun-20260220-0002/trades.json",
                executionLogsRef: "blob://validation/valrun-20260220-0002/execution.log",
                chartPayloadRef: "blob://validation/valrun-20260220-0002/chart.json",
              },
              deterministicChecks: {
                indicatorFidelity: {
                  status: "pass",
                  missingIndicators: [],
                },
                tradeCoherence: {
                  status: "pass",
                  violations: [],
                },
                metricConsistency: {
                  status: "pass",
                  driftPct: 0.1,
                },
              },
              agentReview: {
                status: "pass",
                summary: "No issues",
                findings: [],
              },
              traderReview: {
                required: true,
                status: "requested",
                comments: [],
              },
              policy: {
                profile: "STANDARD",
                blockMergeOnFail: true,
                blockReleaseOnFail: true,
                blockMergeOnAgentFail: true,
                blockReleaseOnAgentFail: false,
                requireTraderReview: true,
                hardFailOnMissingIndicators: true,
                failClosedOnEvidenceUnavailable: true,
              },
              finalDecision: "conditional_pass",
            },
            comments: [],
            decision: null,
            renders: [],
          },
        });
      }

      if (
        url.pathname ===
          "/v2/validation-review/runs/valrun-20260220-0002/renders/html" &&
        method === "GET"
      ) {
        return jsonResponse({
          requestId: "req-validation-review-render-get-001",
          render: {
            runId: "valrun-20260220-0002",
            format: "html",
            status: "queued",
            artifactRef: null,
            downloadUrl: null,
            checksumSha256: null,
            expiresAt: null,
            requestedAt: "2026-02-20T18:02:30Z",
            updatedAt: "2026-02-20T18:02:30Z",
          },
        });
      }

      return jsonResponse(
        {
          error: {
            code: "not_found",
            message: `Unexpected request: ${method} ${url.pathname}`,
          },
          requestId: "req-test-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const exitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "review-run",
        "retrieve",
        "--run-id",
        "valrun-20260220-0002",
        "--render-format",
        "html",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      status: string;
      runId: string;
      summary: {
        traderReviewStatus: string;
        pendingDecision: boolean;
      };
      reviewWeb: {
        path: string;
        url: string;
      };
      render: {
        pending: boolean;
      };
    };

    expect(payload.status).toBe("ok");
    expect(payload.runId).toBe("valrun-20260220-0002");
    expect(payload.summary.traderReviewStatus).toBe("requested");
    expect(payload.summary.pendingDecision).toBe(true);
    expect(payload.reviewWeb.path).toBe("/validation?runId=valrun-20260220-0002");
    expect(payload.reviewWeb.url).toBe(
      "https://review-nexus.lona.agency/validation?runId=valrun-20260220-0002",
    );
    expect(payload.render.pending).toBe(true);
  });
});

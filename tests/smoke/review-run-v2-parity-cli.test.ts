import { afterEach, describe, expect, test } from "bun:test";

import { run } from "../../src/cli";

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

describe("review-run parity closure commands", () => {
  test("review-run list maps to listValidationRunsV2 with deterministic json envelope", async () => {
    const logs: string[] = [];
    let requestIdHeader: string | null = null;

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-review-list-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      requestIdHeader = new Headers(init?.headers).get("X-Request-Id");

      if (url.pathname === "/v2/validation-runs" && method === "GET") {
        return jsonResponse({
          requestId: "req-validation-run-list-001",
          runs: [
            {
              id: "valrun-20260217-0002",
              status: "completed",
              profile: "STANDARD",
              schemaVersion: "validation-run.v1",
              finalDecision: "pass",
              actor: {
                actorType: "human",
                actorId: "user-001",
              },
              createdAt: "2026-02-17T10:30:00Z",
              updatedAt: "2026-02-17T10:35:00Z",
            },
          ],
        });
      }

      return jsonResponse(
        {
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
          requestId: "req-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const exitCode = await run(
      ["bun", "src/cli.ts", "review-run", "list", "--request-id", "req-review-list-fixed-001"],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(requestIdHeader === "req-review-list-fixed-001").toBe(true);

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      requestId: string;
      count: number;
      runs: Array<{ createdAt: string; updatedAt: string; actor: { actorType: string } | null }>;
    };
    expect(payload.command).toBe("review-run list");
    expect(payload.requestId).toBe("req-validation-run-list-001");
    expect(payload.count).toBe(1);
    expect(payload.runs[0]?.createdAt).toBe("2026-02-17T10:30:00.000Z");
    expect(payload.runs[0]?.updatedAt).toBe("2026-02-17T10:35:00.000Z");
    expect(payload.runs[0]?.actor?.actorType).toBe("human");
  });

  test("review-run review submits review payload and idempotency headers", async () => {
    const logs: string[] = [];
    let requestBody: unknown;
    let idempotencyHeader: string | null = null;
    let requestIdHeader: string | null = null;

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-review-submit-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      idempotencyHeader = headers.get("Idempotency-Key");
      requestIdHeader = headers.get("X-Request-Id");

      if (url.pathname === "/v2/validation-runs/valrun-20260220-0001/review" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-validation-review-001",
            runId: "valrun-20260220-0001",
            reviewAccepted: true,
          },
          202,
        );
      }

      return jsonResponse(
        {
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
          requestId: "req-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const exitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "review-run",
        "review",
        "--run-id",
        "valrun-20260220-0001",
        "--reviewer-type",
        "agent",
        "--decision",
        "pass",
        "--summary",
        "Checks are green",
        "--comments",
        "ship,monitor",
        "--findings-json",
        '[{"id":"finding-001","priority":1,"confidence":0.9,"summary":"All good","evidenceRefs":["blob://validation/report.json"]}]',
        "--request-id",
        "req-review-submit-fixed-001",
        "--idempotency-key",
        "idem-review-submit-fixed-001",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(idempotencyHeader === "idem-review-submit-fixed-001").toBe(true);
    expect(requestIdHeader === "req-review-submit-fixed-001").toBe(true);
    expect(requestBody).toEqual({
      reviewerType: "agent",
      decision: "pass",
      summary: "Checks are green",
      comments: ["ship", "monitor"],
      findings: [
        {
          id: "finding-001",
          priority: 1,
          confidence: 0.9,
          summary: "All good",
          evidenceRefs: ["blob://validation/report.json"],
        },
      ],
    });

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      requestId: string;
      runId: string;
      reviewAccepted: boolean;
    };
    expect(payload.command).toBe("review-run review");
    expect(payload.requestId).toBe("req-validation-review-001");
    expect(payload.runId).toBe("valrun-20260220-0001");
    expect(payload.reviewAccepted).toBe(true);
  });

  test("review-run review validates reviewer/decision option parsing", async () => {
    const errors: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-review-submit-002";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const exitCode = await run([
      "bun",
      "src/cli.ts",
      "review-run",
      "review",
      "--run-id",
      "valrun-20260220-0001",
      "--reviewer-type",
      "robot",
      "--decision",
      "pass",
    ]);
    expect(exitCode).toBe(1);
    const payload = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(payload.message).toContain("Unsupported --reviewer-type value 'robot'");
  });

  test("review-run review-comment posts comment payload and parses evidence refs", async () => {
    const logs: string[] = [];
    let requestBody: unknown;

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-review-comment-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (url.pathname === "/v2/validation-review/runs/valrun-20260220-0001/comments" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-validation-review-comment-001",
            runId: "valrun-20260220-0001",
            commentAccepted: true,
            comment: {
              id: "valcomment-001",
              runId: "valrun-20260220-0001",
              tenantId: "tenant-001",
              userId: "user-001",
              body: "Looks stable",
              evidenceRefs: ["blob://validation/backtest.json"],
              createdAt: "2026-02-20T10:36:00Z",
            },
          },
          202,
        );
      }

      return jsonResponse(
        {
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
          requestId: "req-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const exitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "review-run",
        "review-comment",
        "--run-id",
        "valrun-20260220-0001",
        "--body",
        "Looks stable",
        "--evidence-refs",
        "blob://validation/backtest.json",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(requestBody).toEqual({
      body: "Looks stable",
      evidenceRefs: ["blob://validation/backtest.json"],
    });

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      commentAccepted: boolean;
      comment: { createdAt: string };
    };
    expect(payload.command).toBe("review-run review-comment");
    expect(payload.commentAccepted).toBe(true);
    expect(payload.comment.createdAt).toBe("2026-02-20T10:36:00.000Z");
  });

  test("review-run review-comment requires --body when --input is not provided", async () => {
    const errors: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-review-comment-002";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const exitCode = await run([
      "bun",
      "src/cli.ts",
      "review-run",
      "review-comment",
      "--run-id",
      "valrun-20260220-0001",
    ]);
    expect(exitCode).toBe(1);
    const payload = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(payload.message).toContain("--body is required");
  });

  test("review-run review-decision posts decision payload and validates action enum", async () => {
    const logs: string[] = [];
    let requestBody: unknown;
    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-review-decision-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (url.pathname === "/v2/validation-review/runs/valrun-20260220-0001/decisions" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-validation-review-decision-001",
            runId: "valrun-20260220-0001",
            decisionAccepted: true,
            decision: {
              runId: "valrun-20260220-0001",
              action: "approve",
              decision: "conditional_pass",
              reason: "Accept with tighter guardrails",
              evidenceRefs: ["blob://validation/backtest.json"],
              decidedByTenantId: "tenant-001",
              decidedByUserId: "user-001",
              createdAt: "2026-02-20T10:40:00Z",
            },
          },
          202,
        );
      }

      return jsonResponse(
        {
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
          requestId: "req-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const okExitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "review-run",
        "review-decision",
        "--run-id",
        "valrun-20260220-0001",
        "--action",
        "approve",
        "--decision",
        "conditional_pass",
        "--reason",
        "Accept with tighter guardrails",
        "--evidence-refs",
        "blob://validation/backtest.json",
      ],
      fetchMock,
    );

    expect(okExitCode).toBe(0);
    expect(requestBody).toEqual({
      action: "approve",
      decision: "conditional_pass",
      reason: "Accept with tighter guardrails",
      evidenceRefs: ["blob://validation/backtest.json"],
    });

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      decisionAccepted: boolean;
      decision: { createdAt: string };
    };
    expect(payload.command).toBe("review-run review-decision");
    expect(payload.decisionAccepted).toBe(true);
    expect(payload.decision.createdAt).toBe("2026-02-20T10:40:00.000Z");

    const badExitCode = await run([
      "bun",
      "src/cli.ts",
      "review-run",
      "review-decision",
      "--run-id",
      "valrun-20260220-0001",
      "--action",
      "accept",
      "--decision",
      "pass",
      "--reason",
      "text",
    ]);
    expect(badExitCode).toBe(1);
    const badPayload = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(badPayload.message).toContain("Unsupported --action value 'accept'");
  });

  test("review-run baseline creates baseline and validates required options", async () => {
    const logs: string[] = [];
    let requestBody: unknown;
    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-baseline-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (url.pathname === "/v2/validation-baselines" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-validation-baseline-001",
            baseline: {
              id: "valbase-001",
              runId: "valrun-20260220-0001",
              name: "btc-1h-baseline",
              profile: "STANDARD",
              createdAt: "2026-02-20T11:00:00Z",
            },
          },
          201,
        );
      }

      return jsonResponse(
        {
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
          requestId: "req-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const okExitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "review-run",
        "baseline",
        "--run-id",
        "valrun-20260220-0001",
        "--name",
        "btc-1h-baseline",
        "--notes",
        "Golden run for replay",
      ],
      fetchMock,
    );
    expect(okExitCode).toBe(0);
    expect(requestBody).toEqual({
      runId: "valrun-20260220-0001",
      name: "btc-1h-baseline",
      notes: "Golden run for replay",
    });

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      baseline: { createdAt: string; id: string };
    };
    expect(payload.command).toBe("review-run baseline");
    expect(payload.baseline.id).toBe("valbase-001");
    expect(payload.baseline.createdAt).toBe("2026-02-20T11:00:00.000Z");

    const badExitCode = await run([
      "bun",
      "src/cli.ts",
      "review-run",
      "baseline",
      "--run-id",
      "valrun-20260220-0001",
    ]);
    expect(badExitCode).toBe(1);
    const badPayload = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(badPayload.message).toContain("--name is required");
  });

  test("review-run replay submits replay request and validates policy override shape", async () => {
    const logs: string[] = [];
    let requestBody: unknown;
    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-replay-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      requestBody = init?.body ? JSON.parse(String(init.body)) : undefined;

      if (url.pathname === "/v2/validation-regressions/replay" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-validation-replay-001",
            replay: {
              id: "valreplay-001",
              baselineId: "valbase-001",
              candidateRunId: "valrun-20260220-0099",
              status: "completed",
              decision: "pass",
              mergeBlocked: false,
              releaseBlocked: false,
              mergeGateStatus: "pass",
              releaseGateStatus: "pass",
              baselineDecision: "pass",
              candidateDecision: "pass",
              metricDriftDeltaPct: 0.18,
              metricDriftThresholdPct: 0.2,
              thresholdBreached: false,
              reasons: [],
              summary: "Replay comparison passed without regression.",
            },
          },
          202,
        );
      }

      return jsonResponse(
        {
          error: { code: "not_found", message: `Unexpected request: ${method} ${url.pathname}` },
          requestId: "req-unexpected",
        },
        404,
      );
    }) as typeof fetch;

    const okExitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "review-run",
        "replay",
        "--baseline-id",
        "valbase-001",
        "--candidate-run-id",
        "valrun-20260220-0099",
        "--policy-overrides-json",
        "{\"metricDriftThresholdPct\":0.2}",
      ],
      fetchMock,
    );
    expect(okExitCode).toBe(0);
    expect(requestBody).toEqual({
      baselineId: "valbase-001",
      candidateRunId: "valrun-20260220-0099",
      policyOverrides: {
        metricDriftThresholdPct: 0.2,
      },
    });

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      replay: { id: string; decision: string };
    };
    expect(payload.command).toBe("review-run replay");
    expect(payload.replay.id).toBe("valreplay-001");
    expect(payload.replay.decision).toBe("pass");

    const badExitCode = await run([
      "bun",
      "src/cli.ts",
      "review-run",
      "replay",
      "--baseline-id",
      "valbase-001",
      "--candidate-run-id",
      "valrun-20260220-0099",
      "--policy-overrides-json",
      "[]",
    ]);
    expect(badExitCode).toBe(1);
    const badPayload = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(badPayload.message).toContain("--policy-overrides-json must be a JSON object");
  });
});

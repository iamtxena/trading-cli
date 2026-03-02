import { afterEach, describe, expect, test } from "bun:test";

import { run } from "../../src/cli";

type RecordedRequest = {
  path: string;
  method: string;
  query: URLSearchParams;
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

describe("shared validation/invite/conversation command groups", () => {
  test("shared-validation maps shared read/artifact/review actions", async () => {
    const requests: RecordedRequest[] = [];
    const logs: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-shared-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, query: url.searchParams, headers, body });

      if (url.pathname === "/v2/validation-sharing/runs/shared-with-me" && method === "GET") {
        return jsonResponse({
          requestId: "req-shared-list-001",
          items: [
            {
              runId: "run-001",
              permission: "review",
              status: "completed",
              profile: "STANDARD",
              finalDecision: "pass",
              ownerUserId: "owner-001",
              sharedAt: "2026-03-01T09:00:00Z",
              createdAt: "2026-03-01T08:00:00Z",
              updatedAt: "2026-03-01T09:00:00Z",
            },
          ],
          nextCursor: null,
        });
      }

      if (url.pathname === "/v2/validation-runs/run-001" && method === "GET") {
        return jsonResponse({
          requestId: "req-shared-run-001",
          run: {
            id: "run-001",
            status: "completed",
            profile: "STANDARD",
            schemaVersion: "validation-run.v1",
            finalDecision: "pass",
            createdAt: "2026-03-01T08:00:00Z",
            updatedAt: "2026-03-01T09:00:00Z",
          },
        });
      }

      if (url.pathname === "/v2/validation-runs/run-001/artifact" && method === "GET") {
        return jsonResponse({
          requestId: "req-shared-artifact-001",
          artifactType: "validation_run",
          artifact: {
            schemaVersion: "validation-run.v1",
            runId: "run-001",
            createdAt: "2026-03-01T08:00:00Z",
            requestId: "req-shared-run-001",
            tenantId: "tenant-001",
            userId: "user-001",
            strategyRef: {
              strategyId: "strat-001",
              provider: "lona",
              providerRefId: "provider-001",
            },
            inputs: {
              prompt: "test",
              requestedIndicators: ["ema"],
              datasetIds: ["dataset-001"],
              backtestReportRef: "blob://report",
            },
            outputs: {
              strategyCodeRef: "blob://strategy",
              backtestReportRef: "blob://report",
              tradesRef: "blob://trades",
              executionLogsRef: "blob://logs",
              chartPayloadRef: "blob://chart",
            },
            deterministicChecks: {
              indicatorFidelity: { status: "pass", missingIndicators: [] },
              tradeCoherence: { status: "pass", violations: [] },
              metricConsistency: { status: "pass", driftPct: 0 },
            },
            agentReview: { status: "pass", summary: "ok", findings: [] },
            traderReview: { required: true, status: "requested", comments: [] },
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
            finalDecision: "pass",
          },
        });
      }

      if (url.pathname === "/v2/validation-sharing/runs/run-001/comments" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-shared-comment-001",
            runId: "run-001",
            commentAccepted: true,
            comment: {
              id: "comment-001",
              runId: "run-001",
              body: "Looks good",
              evidenceRefs: [],
              createdByUserId: "reviewer-001",
              createdByActorType: "human",
              createdAt: "2026-03-01T09:30:00Z",
            },
          },
          201,
        );
      }

      if (url.pathname === "/v2/validation-sharing/runs/run-001/decisions" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-shared-decision-001",
            runId: "run-001",
            decisionAccepted: true,
            decision: {
              id: "decision-001",
              runId: "run-001",
              action: "approve",
              decision: "pass",
              reason: "meets criteria",
              evidenceRefs: [],
              createdByUserId: "reviewer-001",
              createdByActorType: "human",
              createdAt: "2026-03-01T09:31:00Z",
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

    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "shared-validation",
          "shared-with-me",
          "--permission",
          "review",
          "--status",
          "completed",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "shared-validation", "run", "--run-id", "run-001"],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "shared-validation", "artifact", "--run-id", "run-001"],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "shared-validation",
          "review-comment",
          "--run-id",
          "run-001",
          "--body",
          "Looks good",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "shared-validation",
          "review-decision",
          "--run-id",
          "run-001",
          "--action",
          "approve",
          "--decision",
          "pass",
          "--reason",
          "meets criteria",
        ],
        fetchMock,
      ),
    ).toBe(0);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "GET /v2/validation-sharing/runs/shared-with-me",
      "GET /v2/validation-runs/run-001",
      "GET /v2/validation-runs/run-001/artifact",
      "POST /v2/validation-sharing/runs/run-001/comments",
      "POST /v2/validation-sharing/runs/run-001/decisions",
    ]);

    expect(requests[0]?.query.get("permission")).toBe("review");
    expect(requests[0]?.query.get("status")).toBe("completed");
    expect(requests[3]?.headers.get("Idempotency-Key")).toContain("idem-shared-");
    expect(requests[4]?.headers.get("Idempotency-Key")).toContain("idem-shared-");

    const payload = JSON.parse(logs[0] ?? "{}") as { command: string; status: string };
    expect(payload.command).toBe("shared-validation shared-with-me");
    expect(payload.status).toBe("ok");
  });

  test("invite lifecycle maps to canonical invite endpoints and validates permission semantics", async () => {
    const requests: RecordedRequest[] = [];
    const logs: string[] = [];
    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-shared-002";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, query: url.searchParams, headers, body });

      if (url.pathname === "/v2/validation-sharing/runs/run-001/invites" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-invite-create-001",
            invite: {
              id: "invite-001",
              runId: "run-001",
              email: "reviewer@example.com",
              permission: "review",
              status: "pending",
              invitedByUserId: "owner-001",
              invitedByActorType: "human",
              createdAt: "2026-03-01T10:00:00Z",
              expiresAt: null,
              acceptedAt: null,
              revokedAt: null,
            },
          },
          201,
        );
      }

      if (url.pathname === "/v2/validation-sharing/runs/run-001/invites" && method === "GET") {
        return jsonResponse({
          requestId: "req-invite-list-001",
          items: [
            {
              id: "invite-001",
              runId: "run-001",
              email: "reviewer@example.com",
              permission: "review",
              status: "pending",
              invitedByUserId: "owner-001",
              invitedByActorType: "human",
              createdAt: "2026-03-01T10:00:00Z",
              expiresAt: null,
              acceptedAt: null,
              revokedAt: null,
            },
          ],
          nextCursor: null,
        });
      }

      if (url.pathname === "/v2/validation-sharing/invites/invite-001/accept" && method === "POST") {
        return jsonResponse({
          requestId: "req-invite-accept-001",
          invite: {
            id: "invite-001",
            runId: "run-001",
            email: "reviewer@example.com",
            permission: "review",
            status: "accepted",
            invitedByUserId: "owner-001",
            invitedByActorType: "human",
            createdAt: "2026-03-01T10:00:00Z",
            expiresAt: null,
            acceptedAt: "2026-03-01T10:05:00Z",
            revokedAt: null,
          },
          share: {
            id: "share-001",
            runId: "run-001",
            ownerUserId: "owner-001",
            sharedWithEmail: "reviewer@example.com",
            sharedWithUserId: "reviewer-001",
            inviteId: "invite-001",
            status: "active",
            grantedAt: "2026-03-01T10:05:00Z",
            revokedAt: null,
          },
        });
      }

      if (url.pathname === "/v2/validation-sharing/invites/invite-001/revoke" && method === "POST") {
        return jsonResponse({
          requestId: "req-invite-revoke-001",
          invite: {
            id: "invite-001",
            runId: "run-001",
            email: "reviewer@example.com",
            permission: "review",
            status: "revoked",
            invitedByUserId: "owner-001",
            invitedByActorType: "human",
            createdAt: "2026-03-01T10:00:00Z",
            expiresAt: null,
            acceptedAt: null,
            revokedAt: "2026-03-01T10:06:00Z",
          },
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
          "invite",
          "create",
          "--run-id",
          "run-001",
          "--email",
          "reviewer@example.com",
          "--permission",
          "review",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "invite", "list", "--run-id", "run-001", "--limit", "10"],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "invite",
          "accept",
          "--invite-id",
          "invite-001",
          "--accepted-email",
          "reviewer@example.com",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "invite", "revoke", "--invite-id", "invite-001"],
        fetchMock,
      ),
    ).toBe(0);

    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "invite",
          "create",
          "--run-id",
          "run-001",
          "--email",
          "bad@example.com",
          "--permission",
          "admin",
        ],
        fetchMock,
      ),
    ).toBe(1);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /v2/validation-sharing/runs/run-001/invites",
      "GET /v2/validation-sharing/runs/run-001/invites",
      "POST /v2/validation-sharing/invites/invite-001/accept",
      "POST /v2/validation-sharing/invites/invite-001/revoke",
    ]);
    expect(requests[0]?.headers.get("Idempotency-Key")).toContain("idem-shared-");
    expect(requests[2]?.headers.get("Idempotency-Key")).toContain("idem-shared-");
    expect(requests[3]?.headers.get("Idempotency-Key")).toContain("idem-shared-");

    const errorPayload = JSON.parse(errors.at(-1) ?? "{}") as { status: string; message: string };
    expect(errorPayload.status).toBe("error");
    expect(errorPayload.message).toContain("--permission must be one of: view, review");

    const payload = JSON.parse(logs[0] ?? "{}") as { command: string; status: string };
    expect(payload.command).toBe("invite create");
    expect(payload.status).toBe("ok");
  });

  test("conversation session and turn commands map to canonical endpoints", async () => {
    const requests: RecordedRequest[] = [];
    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-shared-003";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, query: url.searchParams, headers, body });

      if (url.pathname === "/v2/conversations/sessions" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-conv-create-001",
            session: {
              id: "session-001",
              channel: "cli",
              status: "active",
              topic: "phase2",
              metadata: {},
              createdAt: "2026-03-01T11:00:00Z",
              updatedAt: "2026-03-01T11:00:00Z",
              lastTurnAt: null,
            },
          },
          201,
        );
      }

      if (url.pathname === "/v2/conversations/sessions/session-001" && method === "GET") {
        return jsonResponse({
          requestId: "req-conv-get-001",
          session: {
            id: "session-001",
            channel: "cli",
            status: "active",
            topic: "phase2",
            metadata: {},
            createdAt: "2026-03-01T11:00:00Z",
            updatedAt: "2026-03-01T11:01:00Z",
            lastTurnAt: "2026-03-01T11:01:00Z",
          },
        });
      }

      if (url.pathname === "/v2/conversations/sessions/session-001/turns" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-conv-turn-001",
            sessionId: "session-001",
            turn: {
              id: "turn-001",
              sessionId: "session-001",
              role: "user",
              message: "hello",
              suggestions: [],
              metadata: {},
              createdAt: "2026-03-01T11:01:00Z",
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

    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "conversation",
          "session",
          "create",
          "--channel",
          "cli",
          "--topic",
          "phase2",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "conversation", "session", "get", "--session-id", "session-001"],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "conversation",
          "turn",
          "create",
          "--session-id",
          "session-001",
          "--role",
          "user",
          "--message",
          "hello",
        ],
        fetchMock,
      ),
    ).toBe(0);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /v2/conversations/sessions",
      "GET /v2/conversations/sessions/session-001",
      "POST /v2/conversations/sessions/session-001/turns",
    ]);
    const payload = JSON.parse(logs[2] ?? "{}") as { command: string; sessionId: string };
    expect(payload.command).toBe("conversation turn create");
    expect(payload.sessionId).toBe("session-001");
  });
});

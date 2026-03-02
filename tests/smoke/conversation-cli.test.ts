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

describe("conversation command group", () => {
  test("maps session and turn operations to canonical endpoints", async () => {
    const requests: RecordedRequest[] = [];
    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-conversation-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, headers, body });

      if (url.pathname === "/v2/conversations/sessions" && method === "POST") {
        return jsonResponse({
          requestId: "req-conversation-create-001",
          session: {
            id: "session-001",
            channel: "cli",
            status: "active",
            topic: "cli test",
            metadata: {},
            createdAt: "2026-03-02T09:00:00Z",
            lastTurnAt: null,
            updatedAt: "2026-03-02T09:00:00Z",
          },
        });
      }

      if (url.pathname === "/v2/conversations/sessions/session-001" && method === "GET") {
        return jsonResponse({
          requestId: "req-conversation-get-001",
          session: {
            id: "session-001",
            channel: "cli",
            status: "active",
            topic: "cli test",
            metadata: {},
            createdAt: "2026-03-02T09:00:00Z",
            lastTurnAt: "2026-03-02T09:00:30Z",
            updatedAt: "2026-03-02T09:00:30Z",
          },
        });
      }

      if (url.pathname === "/v2/conversations/sessions/session-001/turns" && method === "POST") {
        return jsonResponse({
          requestId: "req-conversation-turn-001",
          sessionId: "session-001",
          turn: {
            id: "turn-001",
            sessionId: "session-001",
            role: "user",
            message: "scan and deploy",
            suggestions: ["risk-check"],
            metadata: {},
            createdAt: "2026-03-02T09:00:30Z",
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
          "conversation",
          "session",
          "create",
          "--channel",
          "cli",
          "--topic",
          "cli test",
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
          "scan and deploy",
        ],
        fetchMock,
      ),
    ).toBe(0);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /v2/conversations/sessions",
      "GET /v2/conversations/sessions/session-001",
      "POST /v2/conversations/sessions/session-001/turns",
    ]);

    const payload = JSON.parse(logs[2] ?? "{}") as { command: string; status: string };
    expect(payload.command).toBe("conversation turn create");
    expect(payload.status).toBe("ok");
  });

  test("de-scoped commands return unknown command guidance", async () => {
    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    expect(await run(["bun", "src/cli.ts", "review-run", "trigger"])).toBe(1);
    expect(await run(["bun", "src/cli.ts", "register", "invite"])).toBe(1);
    expect(await run(["bun", "src/cli.ts", "shared-validation", "shared-with-me"])).toBe(1);

    expect(errors).toHaveLength(3);
    for (const error of errors) {
      const payload = JSON.parse(error) as { message: string };
      expect(payload.message).toContain("Unknown command");
    }
  });

  test("conversation turn help returns usage instead of error", async () => {
    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    expect(await run(["bun", "src/cli.ts", "conversation", "turn"])).toBe(0);

    const payload = JSON.parse(logs.at(-1) ?? "{}") as { command: string; usage: string[] };
    expect(payload.command).toBe("conversation");
    expect(payload.usage).toContain(
      "trading-cli conversation turn create --session-id <id> --role user|assistant|system --message <text> [--metadata-json '{...}'] [--output json|table]",
    );
  });
});

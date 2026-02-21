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

describe("bot registration and key lifecycle commands", () => {
  test("register invite uses invite-code endpoint and returns one-time key with warning", async () => {
    const logs: string[] = [];
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, body });

      if (url.pathname === "/v2/validation-bots/registrations/invite-code" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-bot-reg-invite-001",
            bot: {
              id: "bot-001",
              tenantId: "tenant-001",
              ownerUserId: "user-001",
              name: "Wave-Invite-Bot",
              status: "active",
              registrationPath: "invite_code_trial",
              trialExpiresAt: "2026-03-01T00:00:00Z",
              metadata: { source: "cli-smoke" },
              createdAt: "2026-02-21T18:00:00Z",
              updatedAt: "2026-02-21T18:00:00Z",
            },
            registration: {
              id: "botreg-001",
              botId: "bot-001",
              registrationPath: "invite_code_trial",
              status: "completed",
              audit: { path: "invite" },
              createdAt: "2026-02-21T18:00:00Z",
            },
            issuedKey: {
              rawKey: "tnx_live_new_invite_key",
              key: {
                id: "key-001",
                botId: "bot-001",
                keyPrefix: "tnx_live_",
                status: "active",
                createdAt: "2026-02-21T18:00:00Z",
                lastUsedAt: null,
                revokedAt: null,
              },
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

    const exitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "register",
        "invite",
        "--invite-code",
        "INVITE-TEAM-D-001",
        "--bot-name",
        "Wave-Invite-Bot",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/v2/validation-bots/registrations/invite-code");

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      status: string;
      command: string;
      issuedKey: {
        rawKey: string;
        warning: string;
      };
    };

    expect(payload.status).toBe("ok");
    expect(payload.command).toBe("register invite");
    expect(payload.issuedKey.rawKey).toBe("tnx_live_new_invite_key");
    expect(payload.issuedKey.warning).toContain("Store this key now");
  });

  test("register partner sends partner credentials but never echoes partner secret", async () => {
    const logs: string[] = [];
    let requestBody: Record<string, unknown> | undefined;

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (
        url.pathname === "/v2/validation-bots/registrations/partner-bootstrap" &&
        method === "POST"
      ) {
        requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        return jsonResponse({
          requestId: "req-bot-reg-partner-001",
          bot: {
            id: "bot-010",
            tenantId: "tenant-001",
            ownerUserId: "user-001",
            name: "Wave-Partner-Bot",
            status: "active",
            registrationPath: "partner_bootstrap",
            trialExpiresAt: null,
            metadata: {},
            createdAt: "2026-02-21T18:30:00Z",
            updatedAt: "2026-02-21T18:30:00Z",
          },
          registration: {
            id: "botreg-010",
            botId: "bot-010",
            registrationPath: "partner_bootstrap",
            status: "completed",
            audit: { path: "partner" },
            createdAt: "2026-02-21T18:30:00Z",
          },
          issuedKey: {
            rawKey: "tnx_live_new_partner_key",
            key: {
              id: "key-010",
              botId: "bot-010",
              keyPrefix: "tnx_live_",
              status: "active",
              createdAt: "2026-02-21T18:30:00Z",
              lastUsedAt: null,
              revokedAt: null,
            },
          },
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

    const secret = "partner-super-secret-xyz";
    const exitCode = await run(
      [
        "bun",
        "src/cli.ts",
        "register",
        "partner",
        "--partner-key",
        "pk_team_d",
        "--partner-secret",
        secret,
        "--owner-email",
        "team-d@example.com",
        "--bot-name",
        "Wave-Partner-Bot",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(requestBody?.partnerSecret).toBe(secret);
    expect(logs.at(-1) ?? "").not.toContain(secret);
  });

  test("key rotate requires auth, rotates key, and returns one-time raw key", async () => {
    const logs: string[] = [];
    let authHeader: string | null = null;

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-rotate-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      authHeader = new Headers(init?.headers).get("Authorization");

      if (url.pathname === "/v2/validation-bots/bot-rotate-001/keys/rotate" && method === "POST") {
        return jsonResponse({
          requestId: "req-key-rotate-001",
          botId: "bot-rotate-001",
          issuedKey: {
            rawKey: "tnx_live_rotated_001",
            key: {
              id: "key-rotate-001",
              botId: "bot-rotate-001",
              keyPrefix: "tnx_live_",
              status: "active",
              createdAt: "2026-02-21T19:00:00Z",
              lastUsedAt: null,
              revokedAt: null,
            },
          },
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
      ["bun", "src/cli.ts", "key", "rotate", "--bot-id", "bot-rotate-001", "--reason", "routine"],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    expect(authHeader === "Bearer token-rotate-001").toBe(true);

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      issuedKey: { rawKey: string };
    };
    expect(payload.command).toBe("key rotate");
    expect(payload.issuedKey.rawKey).toBe("tnx_live_rotated_001");
  });

  test("key revoke returns key metadata only (no raw key)", async () => {
    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-revoke-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (
        url.pathname === "/v2/validation-bots/bot-revoke-001/keys/key-revoke-001/revoke" &&
        method === "POST"
      ) {
        return jsonResponse({
          requestId: "req-key-revoke-001",
          botId: "bot-revoke-001",
          key: {
            id: "key-revoke-001",
            botId: "bot-revoke-001",
            keyPrefix: "tnx_live_",
            status: "revoked",
            createdAt: "2026-02-21T17:00:00Z",
            lastUsedAt: "2026-02-21T18:45:00Z",
            revokedAt: "2026-02-21T19:15:00Z",
          },
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
      [
        "bun",
        "src/cli.ts",
        "key",
        "revoke",
        "--bot-id",
        "bot-revoke-001",
        "--key-id",
        "key-revoke-001",
      ],
      fetchMock,
    );

    expect(exitCode).toBe(0);
    const payloadText = logs.at(-1) ?? "{}";
    expect(payloadText).not.toContain("rawKey");

    const payload = JSON.parse(payloadText) as {
      command: string;
      key: { status: string };
    };
    expect(payload.command).toBe("key revoke");
    expect(payload.key.status).toBe("revoked");
  });
});

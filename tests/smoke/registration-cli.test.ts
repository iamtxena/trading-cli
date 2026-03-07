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

  test("register and key subcommand help emit targeted usage", async () => {
    const logs: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const registerExitCode = await run(["bun", "src/cli.ts", "register", "--help"]);
    expect(registerExitCode).toBe(0);
    const registerPayload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      usage: string[];
    };
    expect(registerPayload.command).toBe("register");
    expect(registerPayload.usage).toContain(
      "trading-cli register invite --invite-code <code> --bot-name <name>",
    );

    const keyExitCode = await run(["bun", "src/cli.ts", "key", "--help"]);
    expect(keyExitCode).toBe(0);
    const keyPayload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      usage: string[];
    };
    expect(keyPayload.command).toBe("key");
    expect(keyPayload.usage).toContain("trading-cli key rotate --bot-id <botId> [--reason <text>]");
  });

  test("bot/register/key leaf help bypasses boundary validation and emits targeted usage", async () => {
    const logs: string[] = [];
    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "https://api.binance.com";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    expect(await run(["bun", "src/cli.ts", "bot", "list", "--help"])).toBe(0);
    expect(await run(["bun", "src/cli.ts", "register", "invite", "--help"])).toBe(0);
    expect(await run(["bun", "src/cli.ts", "key", "rotate", "--help"])).toBe(0);
    expect(errors).toEqual([]);

    const payloads = logs.map((line) => JSON.parse(line) as { command?: string; usage?: string[] });
    expect(payloads[0]?.command).toBe("bot list");
    expect(payloads[0]?.usage).toContain("trading-cli bot list [--request-id <id>]");
    expect(payloads[1]?.command).toBe("register invite");
    expect(payloads[1]?.usage?.[0]).toContain("trading-cli register invite --invite-code <code>");
    expect(payloads[2]?.command).toBe("key rotate");
    expect(payloads[2]?.usage?.[0]).toContain("trading-cli key rotate --bot-id <botId>");
  });

  test("bot list maps to validation bot registry endpoint and emits deterministic json", async () => {
    const logs: string[] = [];
    let authHeader: string | null = null;

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-bot-list-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      authHeader = new Headers(init?.headers).get("Authorization");

      if (url.pathname === "/v2/validation-bots" && method === "GET") {
        return jsonResponse({
          requestId: "req-bot-list-001",
          bots: [
            {
              id: "bot-001",
              tenantId: "tenant-001",
              ownerUserId: "user-001",
              name: "Momentum Guard Bot",
              status: "active",
              registrationPath: "invite_code_trial",
              trialExpiresAt: "2026-03-20T10:30:00Z",
              metadata: { runtime: "openclaw" },
              createdAt: "2026-02-20T10:30:00Z",
              updatedAt: "2026-02-20T12:00:00Z",
              keys: [
                {
                  id: "botkey-001",
                  botId: "bot-001",
                  keyPrefix: "tnx.bot.bot-001.",
                  status: "active",
                  createdAt: "2026-02-20T12:00:00Z",
                  lastUsedAt: "2026-02-20T12:05:00Z",
                  revokedAt: null,
                },
              ],
              usage: {
                lastSeenAt: "2026-02-20T12:05:00Z",
              },
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

    const exitCode = await run(["bun", "src/cli.ts", "bot", "list"], fetchMock);
    expect(exitCode).toBe(0);
    expect(authHeader === "Bearer token-bot-list-001").toBe(true);

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      count: number;
      requestId: string;
      bots: Array<{ createdAt: string; keys: Array<{ createdAt: string }> }>;
    };
    expect(payload.command).toBe("bot list");
    expect(payload.requestId).toBe("req-bot-list-001");
    expect(payload.count).toBe(1);
    expect(payload.bots[0]?.createdAt).toBe("2026-02-20T10:30:00.000Z");
    expect(payload.bots[0]?.keys[0]?.createdAt).toBe("2026-02-20T12:00:00.000Z");
  });

  test("bot list rejects unsupported options with strict parser error", async () => {
    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-bot-list-002";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const exitCode = await run(["bun", "src/cli.ts", "bot", "list", "--output", "table"]);
    expect(exitCode).toBe(1);

    const payload = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(payload.message).toContain("Unknown option '--output'");
  });

  test("missing register/key subcommands return explicit guidance", async () => {
    const errors: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const registerExitCode = await run(["bun", "src/cli.ts", "register"]);
    expect(registerExitCode).toBe(1);
    const registerError = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(registerError.message).toBe("Unknown register mode. Use 'invite' or 'partner'.");

    const keyExitCode = await run(["bun", "src/cli.ts", "key"]);
    expect(keyExitCode).toBe(1);
    const keyError = JSON.parse(errors.at(-1) ?? "{}") as { message: string };
    expect(keyError.message).toBe("Unknown key action. Use 'rotate' or 'revoke'.");
  });
});

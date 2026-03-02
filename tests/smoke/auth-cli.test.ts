import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

function createAuthStorePath(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "trading-cli-auth-"));
  return {
    dir,
    file: join(dir, "auth.json"),
  };
}

function writeFallbackCredentialFile(filePath: string, accessToken: string): void {
  const payload = {
    version: 1,
    targets: {
      "http://localhost:3000": {
        accessToken,
        sessionId: "clisess-000001",
      },
    },
  };
  writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  console.log = ORIGINAL_LOG;
  console.error = ORIGINAL_ERROR;

  delete process.env.PLATFORM_API_BASE_URL;
  delete process.env.PLATFORM_API_BEARER_TOKEN;
  delete process.env.PLATFORM_API_TOKEN;
  delete process.env.PLATFORM_API_KEY;
  delete process.env.TRADING_CLI_ENABLE_AUTH_STORE;
  delete process.env.TRADING_CLI_AUTH_SECURE_STORE;
  delete process.env.TRADING_CLI_AUTH_FALLBACK_PATH;
});

describe("auth commands", () => {
  test("auth login completes device flow and stores token without printing secrets", async () => {
    const logs: string[] = [];
    const errors: string[] = [];
    const requests: string[] = [];
    const store = createAuthStorePath();

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.TRADING_CLI_ENABLE_AUTH_STORE = "1";
    process.env.TRADING_CLI_AUTH_SECURE_STORE = "0";
    process.env.TRADING_CLI_AUTH_FALLBACK_PATH = store.file;

    console.log = (value: unknown) => {
      logs.push(String(value));
    };
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url.pathname}`);

      if (url.pathname === "/v2/validation-cli-auth/device/start" && method === "POST") {
        return jsonResponse(
          {
            requestId: "req-cli-device-start-001",
            deviceCode: "tnx_device_001",
            userCode: "K8JH-4WQ2",
            verificationUri: "https://trade-nexus.local/cli/device",
            verificationUriComplete:
              "https://trade-nexus.local/cli/device?user_code=K8JH-4WQ2",
            scopes: ["validation:read", "validation:write"],
            expiresAt: "2026-03-02T12:40:00Z",
            expiresIn: 900,
            interval: 1,
          },
          201,
        );
      }

      if (url.pathname === "/v2/validation-cli-auth/device/token" && method === "POST") {
        return jsonResponse({
          requestId: "req-cli-device-token-001",
          tokenType: "Bearer",
          accessToken: "tnx.cli.clisess-000001.secret-value",
          sessionId: "clisess-000001",
          tenantId: "tenant-001",
          userId: "user-001",
          createdByUserId: "user-001",
          scopes: ["validation:read", "validation:write"],
          createdAt: "2026-03-02T12:33:00Z",
          expiresAt: "2026-03-02T13:33:00Z",
          expiresIn: 3600,
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

    const exitCode = await run(["bun", "src/cli.ts", "auth", "login"], fetchMock);
    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      "POST /v2/validation-cli-auth/device/start",
      "POST /v2/validation-cli-auth/device/token",
    ]);
    expect(errors.join("\n")).toContain("K8JH-4WQ2");
    expect(errors.join("\n")).toContain("https://trade-nexus.local/cli/device");

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      sessionId: string;
      storage: { backend: string };
    };
    expect(payload.command).toBe("auth login");
    expect(payload.sessionId).toBe("clisess-000001");
    expect(payload.storage.backend).toBe("fallback_file");
    expect(logs.at(-1) ?? "").not.toContain("tnx.cli.clisess-000001.secret-value");

    const stored = JSON.parse(readFileSync(store.file, "utf8")) as {
      targets: Record<string, { accessToken: string }>;
    };
    expect(stored.targets["http://localhost:3000"]?.accessToken).toBe(
      "tnx.cli.clisess-000001.secret-value",
    );

    rmSync(store.dir, { force: true, recursive: true });
  });

  test("auth whoami uses stored credential when env token is absent", async () => {
    const logs: string[] = [];
    const headers: string[] = [];
    const store = createAuthStorePath();

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.TRADING_CLI_ENABLE_AUTH_STORE = "1";
    process.env.TRADING_CLI_AUTH_SECURE_STORE = "0";
    process.env.TRADING_CLI_AUTH_FALLBACK_PATH = store.file;

    writeFallbackCredentialFile(store.file, "tnx.cli.clisess-000001.secret-value");

    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      headers.push(new Headers(init?.headers).get("Authorization") ?? "");

      if (url.pathname === "/v2/validation-cli-auth/whoami" && method === "GET") {
        return jsonResponse({
          requestId: "req-cli-whoami-001",
          session: {
            id: "clisess-000001",
            tenantId: "tenant-001",
            userId: "user-001",
            createdByUserId: "user-001",
            scopes: ["validation:read"],
            createdAt: "2026-03-02T12:33:00Z",
            expiresAt: "2026-03-02T13:33:00Z",
            revokedAt: null,
            lastUsedAt: "2026-03-02T12:34:00Z",
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

    const exitCode = await run(["bun", "src/cli.ts", "auth", "whoami"], fetchMock);
    expect(exitCode).toBe(0);
    expect(headers[0]).toBe("Bearer tnx.cli.clisess-000001.secret-value");

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      sessionId: string;
      tenantId: string;
      userId: string;
      scopes: string[];
    };
    expect(payload.command).toBe("auth whoami");
    expect(payload.sessionId).toBe("clisess-000001");
    expect(payload.tenantId).toBe("tenant-001");
    expect(payload.userId).toBe("user-001");
    expect(payload.scopes).toEqual(["validation:read"]);

    rmSync(store.dir, { force: true, recursive: true });
  });

  test("auth whoami honors PLATFORM_API_BEARER_TOKEN override over stored credential", async () => {
    const headers: string[] = [];
    const logs: string[] = [];
    const store = createAuthStorePath();

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.TRADING_CLI_ENABLE_AUTH_STORE = "1";
    process.env.TRADING_CLI_AUTH_SECURE_STORE = "0";
    process.env.TRADING_CLI_AUTH_FALLBACK_PATH = store.file;
    process.env.PLATFORM_API_BEARER_TOKEN = "env-token-override-001";

    writeFallbackCredentialFile(store.file, "stored-token-should-not-be-used");
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      headers.push(new Headers(init?.headers).get("Authorization") ?? "");
      if (url.pathname === "/v2/validation-cli-auth/whoami") {
        return jsonResponse({
          requestId: "req-cli-whoami-override-001",
          session: {
            id: "clisess-override-001",
            tenantId: "tenant-001",
            userId: "user-001",
            createdByUserId: "user-001",
            scopes: ["validation:read"],
            createdAt: "2026-03-02T12:33:00Z",
            expiresAt: "2026-03-02T13:33:00Z",
            revokedAt: null,
            lastUsedAt: "2026-03-02T12:34:00Z",
          },
        });
      }
      return jsonResponse({ error: { code: "not_found", message: "Unexpected request" } }, 404);
    }) as typeof fetch;

    const exitCode = await run(["bun", "src/cli.ts", "auth", "whoami"], fetchMock);
    expect(exitCode).toBe(0);
    expect(headers[0]).toBe("Bearer env-token-override-001");
    expect(JSON.parse(logs.at(-1) ?? "{}").command).toBe("auth whoami");

    rmSync(store.dir, { force: true, recursive: true });
  });

  test("auth logout revokes current session and clears local credential file", async () => {
    const logs: string[] = [];
    const requests: string[] = [];
    const store = createAuthStorePath();

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.TRADING_CLI_ENABLE_AUTH_STORE = "1";
    process.env.TRADING_CLI_AUTH_SECURE_STORE = "0";
    process.env.TRADING_CLI_AUTH_FALLBACK_PATH = store.file;

    writeFallbackCredentialFile(store.file, "tnx.cli.clisess-000001.secret-value");

    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      requests.push(`${method} ${url.pathname}`);

      if (url.pathname === "/v2/validation-cli-auth/whoami" && method === "GET") {
        return jsonResponse({
          requestId: "req-cli-whoami-logout-001",
          session: {
            id: "clisess-000001",
            tenantId: "tenant-001",
            userId: "user-001",
            createdByUserId: "user-001",
            scopes: ["validation:read", "validation:write"],
            createdAt: "2026-03-02T12:33:00Z",
            expiresAt: "2026-03-02T13:33:00Z",
            revokedAt: null,
            lastUsedAt: "2026-03-02T12:34:00Z",
          },
        });
      }

      if (
        url.pathname === "/v2/validation-cli-auth/sessions/clisess-000001/revoke" &&
        method === "POST"
      ) {
        return jsonResponse({
          requestId: "req-cli-session-revoke-001",
          session: {
            id: "clisess-000001",
            tenantId: "tenant-001",
            userId: "user-001",
            createdByUserId: "user-001",
            scopes: ["validation:read", "validation:write"],
            createdAt: "2026-03-02T12:33:00Z",
            expiresAt: "2026-03-02T13:33:00Z",
            revokedAt: "2026-03-02T12:40:00Z",
            lastUsedAt: "2026-03-02T12:34:00Z",
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

    const exitCode = await run(["bun", "src/cli.ts", "auth", "logout"], fetchMock);
    expect(exitCode).toBe(0);
    expect(requests).toEqual([
      "GET /v2/validation-cli-auth/whoami",
      "POST /v2/validation-cli-auth/sessions/clisess-000001/revoke",
    ]);

    const payload = JSON.parse(logs.at(-1) ?? "{}") as {
      command: string;
      localCredentialsCleared: boolean;
      sessionId: string;
    };
    expect(payload.command).toBe("auth logout");
    expect(payload.sessionId).toBe("clisess-000001");
    expect(payload.localCredentialsCleared).toBe(true);
    expect(existsSync(store.file)).toBe(false);

    rmSync(store.dir, { force: true, recursive: true });
  });
});

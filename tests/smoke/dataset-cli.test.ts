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

describe("dataset lifecycle command group", () => {
  test("maps full lifecycle to canonical dataset endpoints", async () => {
    const requests: RecordedRequest[] = [];
    const logs: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-dataset-001";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const dataset: {
      id: string;
      filename: string;
      contentType: string;
      sizeBytes: number;
      status: string;
      providerDataId: string | null;
      uploadUrl: string;
      createdAt: string;
      updatedAt: string;
    } = {
      id: "dataset-001",
      filename: "btc-1h.csv",
      contentType: "text/csv",
      sizeBytes: 1024,
      status: "uploading",
      providerDataId: null,
      uploadUrl: "https://uploads.local/dataset-001",
      createdAt: "2026-03-01T00:00:00Z",
      updatedAt: "2026-03-01T00:00:00Z",
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      requests.push({ path: url.pathname, method, headers, body });

      if (url.pathname === "/v1/datasets/uploads:init" && method === "POST") {
        return jsonResponse({
          requestId: "req-dataset-init-001",
          datasetId: "dataset-001",
          uploadUrl: "https://uploads.local/dataset-001",
          status: "uploading",
        });
      }

      if (url.pathname === "/v1/datasets/dataset-001/uploads:complete" && method === "POST") {
        dataset.status = "uploaded";
        dataset.updatedAt = "2026-03-01T00:01:00Z";
        return jsonResponse({
          requestId: "req-dataset-complete-001",
          dataset,
        });
      }

      if (url.pathname === "/v1/datasets/dataset-001/validate" && method === "POST") {
        dataset.status = "validating";
        dataset.updatedAt = "2026-03-01T00:02:00Z";
        return jsonResponse({
          requestId: "req-dataset-validate-001",
          dataset,
        });
      }

      if (url.pathname === "/v1/datasets/dataset-001/transform/candles" && method === "POST") {
        dataset.status = "ready";
        dataset.updatedAt = "2026-03-01T00:03:00Z";
        dataset.providerDataId = "provider-dataset-001";
        return jsonResponse({
          requestId: "req-dataset-transform-001",
          dataset,
        });
      }

      if (url.pathname === "/v1/datasets/dataset-001/publish/lona" && method === "POST") {
        dataset.status = "published_lona";
        dataset.updatedAt = "2026-03-01T00:04:00Z";
        return jsonResponse({
          requestId: "req-dataset-publish-001",
          dataset,
        });
      }

      if (url.pathname === "/v1/datasets/dataset-001" && method === "GET") {
        return jsonResponse({
          requestId: "req-dataset-get-001",
          dataset,
        });
      }

      if (url.pathname === "/v1/datasets/dataset-001/quality-report" && method === "GET") {
        return jsonResponse({
          requestId: "req-dataset-quality-001",
          qualityReport: {
            datasetId: "dataset-001",
            status: "published_lona",
            summary: "No data quality issues detected.",
            issues: [],
          },
        });
      }

      if (url.pathname === "/v1/datasets" && method === "GET") {
        return jsonResponse({
          requestId: "req-dataset-list-001",
          items: [dataset],
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
          "dataset",
          "upload",
          "init",
          "--filename",
          "btc-1h.csv",
          "--content-type",
          "text/csv",
          "--size-bytes",
          "1024",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "dataset",
          "upload",
          "complete",
          "--dataset-id",
          "dataset-001",
          "--upload-token",
          "upload-token-001",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "dataset",
          "validate",
          "--dataset-id",
          "dataset-001",
          "--column-mapping-json",
          "{\"timestamp\":\"ts\"}",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "dataset",
          "transform",
          "--dataset-id",
          "dataset-001",
          "--frequency",
          "1h",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        [
          "bun",
          "src/cli.ts",
          "dataset",
          "publish",
          "--dataset-id",
          "dataset-001",
          "--mode",
          "explicit",
        ],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "dataset", "get", "--dataset-id", "dataset-001"],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "dataset", "status", "--dataset-id", "dataset-001"],
        fetchMock,
      ),
    ).toBe(0);
    expect(
      await run(
        ["bun", "src/cli.ts", "dataset", "quality-report", "--dataset-id", "dataset-001"],
        fetchMock,
      ),
    ).toBe(0);
    expect(await run(["bun", "src/cli.ts", "dataset", "list"], fetchMock)).toBe(0);

    expect(requests.map((request) => `${request.method} ${request.path}`)).toEqual([
      "POST /v1/datasets/uploads:init",
      "POST /v1/datasets/dataset-001/uploads:complete",
      "POST /v1/datasets/dataset-001/validate",
      "POST /v1/datasets/dataset-001/transform/candles",
      "POST /v1/datasets/dataset-001/publish/lona",
      "GET /v1/datasets/dataset-001",
      "GET /v1/datasets/dataset-001",
      "GET /v1/datasets/dataset-001/quality-report",
      "GET /v1/datasets",
    ]);

    for (const request of requests) {
      expect(request.headers.get("X-Request-Id") ?? "").toContain("req-dataset-");
    }

    const initPayload = JSON.parse(logs[0] ?? "{}") as { command: string; status: string };
    const statusPayload = JSON.parse(logs[6] ?? "{}") as { command: string; dataset: { status: string } };
    const qualityPayload = JSON.parse(logs[7] ?? "{}") as { command: string; qualityReport: { datasetId: string } };
    expect(initPayload.command).toBe("dataset upload init");
    expect(initPayload.status).toBe("ok");
    expect(statusPayload.command).toBe("dataset status");
    expect(statusPayload.dataset.status).toBe("published_lona");
    expect(qualityPayload.command).toBe("dataset quality-report");
    expect(qualityPayload.qualityReport.datasetId).toBe("dataset-001");
  });

  test("validates required args pre-flight", async () => {
    const errors: string[] = [];
    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    process.env.PLATFORM_API_BEARER_TOKEN = "token-dataset-002";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    const exitCode = await run(["bun", "src/cli.ts", "dataset", "transform", "--dataset-id", "dataset-001"]);
    expect(exitCode).toBe(1);

    const envelope = JSON.parse(errors.at(-1) ?? "{}") as { status: string; message: string };
    expect(envelope.status).toBe("error");
    expect(envelope.message).toContain("--frequency is required");
  });
});

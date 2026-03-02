import { afterEach, describe, expect, test } from "bun:test";

import { runDatasetCommand } from "../../src/dataset-command";
import type { CommandContext } from "../../src/command-utils";

type RecordedRequest = {
  path: string;
  method: string;
  headers: Headers;
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

function createContext(fetchImpl: typeof fetch): { context: CommandContext; emitted: unknown[] } {
  const emitted: unknown[] = [];
  return {
    emitted,
    context: {
      baseUrl: "http://localhost:3000",
      env: { PLATFORM_API_BEARER_TOKEN: "token-unit-dataset-001" },
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

describe("runDatasetCommand unit parsing/output", () => {
  test("quality-report usage appears in dataset help output", async () => {
    const fetchMock = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const { context, emitted } = createContext(fetchMock);

    await runDatasetCommand(["--help"], context);

    const helpPayload = emitted[0] as { command: string; usage: string[] };
    expect(helpPayload.command).toBe("dataset");
    expect(helpPayload.usage).toContain(
      "trading-cli dataset quality-report --dataset-id <id> [--output json|table]",
    );
  });

  test("quality-report validates required dataset id", async () => {
    const fetchMock = (async () => {
      throw new Error("fetch should not be called");
    }) as typeof fetch;
    const { context } = createContext(fetchMock);

    await expect(runDatasetCommand(["quality-report"], context)).rejects.toThrow(
      "--dataset-id is required.",
    );
  });

  test("quality-report table output is deterministic", async () => {
    const logs: string[] = [];
    const requests: RecordedRequest[] = [];
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";
      const headers = new Headers(init?.headers);
      requests.push({ path: url.pathname, method, headers });

      if (url.pathname === "/v1/datasets/dataset-001/quality-report" && method === "GET") {
        return jsonResponse({
          requestId: "req-dataset-quality-unit-001",
          qualityReport: {
            datasetId: "dataset-001",
            status: "ready",
            summary: "Two issues found",
            issues: [{ field: "timestamp" }, { field: "close" }],
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

    const { context } = createContext(fetchMock);
    await runDatasetCommand(
      [
        "quality-report",
        "--dataset-id",
        "dataset-001",
        "--request-id",
        "req-dataset-fixed-unit-001",
        "--output",
        "table",
      ],
      context,
    );

    expect(requests.length).toBe(1);
    expect(requests[0]?.path).toBe("/v1/datasets/dataset-001/quality-report");
    expect(requests[0]?.headers.get("X-Request-Id")).toBe("req-dataset-fixed-unit-001");
    expect(logs.at(-1) ?? "").toContain("dataset quality-report");
    expect(logs.at(-1) ?? "").toContain("issuesCount");
    expect(logs.at(-1) ?? "").toContain("2");
  });

  test("quality-report emits json payload by default", async () => {
    const fetchMock = (async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      const method = init?.method ?? "GET";

      if (url.pathname === "/v1/datasets/dataset-001/quality-report" && method === "GET") {
        return jsonResponse({
          requestId: "req-dataset-quality-unit-002",
          qualityReport: {
            datasetId: "dataset-001",
            status: "published_lona",
            summary: "No data quality issues detected.",
            issues: [],
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

    const { context, emitted } = createContext(fetchMock);
    await runDatasetCommand(["quality-report", "--dataset-id", "dataset-001"], context);

    expect(emitted).toEqual([
      {
        status: "ok",
        command: "dataset quality-report",
        requestId: "req-dataset-quality-unit-002",
        qualityReport: {
          datasetId: "dataset-001",
          status: "published_lona",
          summary: "No data quality issues detected.",
          issues: [],
        },
      },
    ]);
  });
});

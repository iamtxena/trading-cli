import { describe, expect, test } from "bun:test";

import { run } from "../../src/cli";

describe("CLI smoke", () => {
  test("executes non-review-run command path and emits machine-readable output", async () => {
    const originalBaseUrl = process.env.PLATFORM_API_BASE_URL;
    const originalLog = console.log;

    const logs: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.log = (value: unknown) => {
      logs.push(String(value));
    };

    try {
      const exitCode = await run(["bun", "src/cli.ts", "positions", "list"]);
      expect(exitCode).toBe(0);
      expect(logs.length).toBe(1);

      const payload = JSON.parse(logs[0]) as {
        status: string;
        command: string[];
        target: string;
      };

      expect(payload.status).toBe("ok");
      expect(payload.command).toEqual(["positions", "list"]);
      expect(payload.target).toBe("http://localhost:3000");
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.PLATFORM_API_BASE_URL;
      } else {
        process.env.PLATFORM_API_BASE_URL = originalBaseUrl;
      }
      console.log = originalLog;
    }
  });
});

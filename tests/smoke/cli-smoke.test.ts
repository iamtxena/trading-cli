import { describe, expect, test } from "bun:test";

import { run } from "../../src/cli";

describe("CLI smoke", () => {
  test("fails unknown command path with structured machine-readable error", async () => {
    const originalBaseUrl = process.env.PLATFORM_API_BASE_URL;
    const originalLog = console.log;
    const originalError = console.error;

    const errors: string[] = [];

    process.env.PLATFORM_API_BASE_URL = "http://localhost:3000";
    console.error = (value: unknown) => {
      errors.push(String(value));
    };

    try {
      const exitCode = await run(["bun", "src/cli.ts", "positions", "list"]);
      expect(exitCode).toBe(1);
      expect(errors.length).toBe(1);

      const payload = JSON.parse(errors[0]) as {
        status: "error";
        message: string;
        command: string[];
        target: string;
      };

      expect(payload.status).toBe("error");
      expect(payload.message).toContain("Unknown command");
      expect(payload.command).toEqual(["positions", "list"]);
      expect(payload.target).toBe("http://localhost:3000");
    } finally {
      if (originalBaseUrl === undefined) {
        delete process.env.PLATFORM_API_BASE_URL;
      } else {
        process.env.PLATFORM_API_BASE_URL = originalBaseUrl;
      }
      console.log = originalLog;
      console.error = originalError;
    }
  });
});

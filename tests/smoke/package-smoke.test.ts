import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const createdPaths: string[] = [];

function runCommand(command: string, args: string[], cwd = ROOT, env: NodeJS.ProcessEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...env,
    },
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    throw new Error(
      `Command failed: ${command} ${args.join(" ")}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }

  return result.stdout.trim();
}

function extractJsonFromOutput(output: string): Record<string, unknown> {
  const first = output.indexOf("{");
  const last = output.lastIndexOf("}");
  if (first < 0 || last < first) {
    throw new Error(`Expected JSON object in output:\n${output}`);
  }
  return JSON.parse(output.slice(first, last + 1)) as Record<string, unknown>;
}

function packTarball(): string {
  const output = runCommand("npm", ["pack", "--silent"]);
  const lines = output.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const tarball = lines.at(-1);
  if (!tarball || !tarball.endsWith(".tgz")) {
    throw new Error(`Unable to find packed tarball in output:\n${output}`);
  }
  const tarballPath = resolve(ROOT, tarball);
  createdPaths.push(tarballPath);
  return tarballPath;
}

afterEach(() => {
  while (createdPaths.length > 0) {
    const path = createdPaths.pop();
    if (path) {
      rmSync(path, { recursive: true, force: true });
    }
  }
});

describe("packaging smoke", () => {
  test("package metadata is publish-safe and bin-ready", () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf-8")) as {
      private?: boolean;
      bin?: Record<string, string>;
      scripts?: Record<string, string>;
      publishConfig?: Record<string, string>;
    };

    expect(packageJson.private).toBe(false);
    expect(packageJson.bin?.["trading-cli"]).toBe("dist/cli.js");
    expect(packageJson.scripts?.build).toContain("bun build");
    expect(packageJson.publishConfig?.access).toBe("public");
  });

  test("npm exec runs the packed CLI entrypoint", () => {
    const tarballPath = packTarball();
    const output = runCommand(
      "npm",
      ["exec", "--yes", `--package=${tarballPath}`, "--", "trading-cli"],
      ROOT,
      {
        PLATFORM_API_BASE_URL: "http://localhost:3000",
      },
    );

    const payload = extractJsonFromOutput(output);
    expect(payload.status).toBe("ok");
    expect(payload.target).toBe("http://localhost:3000");
  });

  test("bunx --no-install runs the locally installed packed CLI", () => {
    const tarballPath = packTarball();
    const tempDir = mkdtempSync(join(tmpdir(), "trading-cli-bunx-smoke-"));
    createdPaths.push(tempDir);
    writeFileSync(resolve(tempDir, "package.json"), JSON.stringify({ name: "tmp-smoke", version: "1.0.0" }));

    runCommand("bun", ["add", tarballPath, "--silent"], tempDir);
    const output = runCommand(
      "bunx",
      ["--bun", "--no-install", "trading-cli"],
      tempDir,
      {
        PLATFORM_API_BASE_URL: "http://localhost:3000",
      },
    );

    const payload = extractJsonFromOutput(output);
    expect(payload.status).toBe("ok");
    expect(payload.target).toBe("http://localhost:3000");
  });
});

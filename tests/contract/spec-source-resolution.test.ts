import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function run(command: string, args: string[], cwd: string): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function git(cwd: string, ...args: string[]): string {
  return run("git", args, cwd);
}

describe("authoritative spec resolution", () => {
  test("resolves spec content from origin/main revision, not working tree edits", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "trading-cli-spec-resolve-"));

    try {
      const repoRoot = join(sandbox, "trade-nexus");
      const specDir = join(repoRoot, "docs/architecture/specs");
      const specPath = join(specDir, "platform-api.openapi.yaml");
      const resolvedOutPath = join(sandbox, "resolved.openapi.yaml");
      const resolverPath = resolve(process.cwd(), "scripts/resolve-authoritative-spec.sh");

      mkdirSync(specDir, { recursive: true });
      git(sandbox, "init", "trade-nexus");
      git(repoRoot, "config", "user.email", "spec-test@example.com");
      git(repoRoot, "config", "user.name", "Spec Test");

      writeFileSync(
        specPath,
        "openapi: 3.0.3\npaths:\n  /v2/test:\n    get:\n      operationId: fromOriginMain\n",
      );
      git(repoRoot, "add", ".");
      git(repoRoot, "commit", "-m", "seed authoritative spec");
      git(repoRoot, "branch", "-M", "main");
      git(repoRoot, "update-ref", "refs/remotes/origin/main", "HEAD");

      writeFileSync(
        specPath,
        "openapi: 3.0.3\npaths:\n  /v2/test:\n    get:\n      operationId: fromWorkingTree\n",
      );

      run(
        "bash",
        [resolverPath, "--spec", specPath, "--revision", "origin/main", "--out", resolvedOutPath],
        process.cwd(),
      );

      const resolvedText = readFileSync(resolvedOutPath, "utf8");
      expect(resolvedText).toContain("operationId: fromOriginMain");
      expect(resolvedText).not.toContain("operationId: fromWorkingTree");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

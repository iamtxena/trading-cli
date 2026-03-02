import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { nonEmpty } from "./command-utils";

const SECURE_STORE_SERVICE = "trading-cli.platform-api";
const FALLBACK_FILE_SCHEMA_VERSION = 1;

export type StoredCliCredential = {
  accessToken: string;
  sessionId?: string;
  tenantId?: string;
  userId?: string;
  createdByUserId?: string;
  scopes?: string[];
  createdAt?: string;
  expiresAt?: string;
};

export type CredentialStoreBackend = "macos_keychain" | "linux_libsecret" | "fallback_file" | "disabled";

type PersistedCredentialMap = {
  version: number;
  targets: Record<string, StoredCliCredential>;
};

type CommandResult = {
  ok: boolean;
  notFound: boolean;
  stdout: string;
  stderr: string;
};

function parseBooleanEnv(raw: string | undefined): boolean | undefined {
  const normalized = nonEmpty(raw)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function isCredentialStoreEnabled(env: NodeJS.ProcessEnv): boolean {
  const override = parseBooleanEnv(env.TRADING_CLI_ENABLE_AUTH_STORE);
  if (override !== undefined) {
    return override;
  }
  return env.NODE_ENV !== "test";
}

function isSecureStoreEnabled(env: NodeJS.ProcessEnv): boolean {
  const override = parseBooleanEnv(env.TRADING_CLI_AUTH_SECURE_STORE);
  return override ?? true;
}

function toSerializableTimestamp(value: string | undefined): string | undefined {
  const normalized = nonEmpty(value);
  if (!normalized) {
    return undefined;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function sanitizeScopes(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const scopes = value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0);
  return scopes.length > 0 ? scopes : undefined;
}

function normalizeCredential(input: unknown): StoredCliCredential | undefined {
  if (typeof input === "string") {
    const accessToken = nonEmpty(input);
    return accessToken ? { accessToken } : undefined;
  }

  if (!input || typeof input !== "object") {
    return undefined;
  }

  const asRecord = input as Record<string, unknown>;
  const accessToken = nonEmpty(asRecord.accessToken);
  if (!accessToken) {
    return undefined;
  }

  const sessionId = nonEmpty(asRecord.sessionId);
  const tenantId = nonEmpty(asRecord.tenantId);
  const userId = nonEmpty(asRecord.userId);
  const createdByUserId = nonEmpty(asRecord.createdByUserId);
  const createdAt = toSerializableTimestamp(nonEmpty(asRecord.createdAt));
  const expiresAt = toSerializableTimestamp(nonEmpty(asRecord.expiresAt));
  const scopes = sanitizeScopes(asRecord.scopes);

  return {
    accessToken,
    sessionId,
    tenantId,
    userId,
    createdByUserId,
    scopes,
    createdAt,
    expiresAt,
  };
}

function parseStoredSecret(secret: string): StoredCliCredential | undefined {
  const trimmed = secret.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    return normalizeCredential(JSON.parse(trimmed));
  } catch {
    return normalizeCredential(trimmed);
  }
}

function resolveCredentialTarget(baseUrl: string): string {
  return new URL(baseUrl).origin;
}

function resolveFallbackCredentialPath(env: NodeJS.ProcessEnv): string {
  const override = nonEmpty(env.TRADING_CLI_AUTH_FALLBACK_PATH);
  if (override) {
    return resolve(override);
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "trading-cli", "auth.json");
  }

  if (process.platform === "win32") {
    const appData = nonEmpty(env.APPDATA) ?? join(homedir(), "AppData", "Roaming");
    return join(appData, "trading-cli", "auth.json");
  }

  const xdgConfigHome = nonEmpty(env.XDG_CONFIG_HOME) ?? join(homedir(), ".config");
  return join(xdgConfigHome, "trading-cli", "auth.json");
}

function runCommand(command: string, args: string[], input?: string): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    input,
  });

  if (result.error) {
    const error = result.error as NodeJS.ErrnoException;
    if (error.code === "ENOENT") {
      return {
        ok: false,
        notFound: true,
        stdout: "",
        stderr: "",
      };
    }
    return {
      ok: false,
      notFound: false,
      stdout: String(result.stdout ?? ""),
      stderr: String(result.stderr ?? ""),
    };
  }

  return {
    ok: result.status === 0,
    notFound: false,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function readFromMacosKeychain(target: string): StoredCliCredential | undefined {
  const response = runCommand("security", [
    "find-generic-password",
    "-s",
    SECURE_STORE_SERVICE,
    "-a",
    target,
    "-w",
  ]);
  if (!response.ok) {
    return undefined;
  }
  return parseStoredSecret(response.stdout);
}

function writeToMacosKeychain(target: string, credential: StoredCliCredential): boolean {
  const payload = JSON.stringify(credential);
  const response = runCommand("security", [
    "add-generic-password",
    "-U",
    "-s",
    SECURE_STORE_SERVICE,
    "-a",
    target,
    "-w",
    payload,
  ]);
  return response.ok;
}

function clearMacosKeychain(target: string): void {
  runCommand("security", [
    "delete-generic-password",
    "-s",
    SECURE_STORE_SERVICE,
    "-a",
    target,
  ]);
}

function readFromLinuxLibsecret(target: string): StoredCliCredential | undefined {
  const response = runCommand("secret-tool", [
    "lookup",
    "service",
    SECURE_STORE_SERVICE,
    "account",
    target,
  ]);
  if (!response.ok) {
    return undefined;
  }
  return parseStoredSecret(response.stdout);
}

function writeToLinuxLibsecret(target: string, credential: StoredCliCredential): boolean {
  const payload = JSON.stringify(credential);
  const response = runCommand(
    "secret-tool",
    [
      "store",
      "--label",
      `trading-cli token (${target})`,
      "service",
      SECURE_STORE_SERVICE,
      "account",
      target,
    ],
    payload,
  );
  return response.ok;
}

function clearLinuxLibsecret(target: string): void {
  runCommand("secret-tool", ["clear", "service", SECURE_STORE_SERVICE, "account", target]);
}

function readFromSecureStore(
  target: string,
  env: NodeJS.ProcessEnv,
): { credential?: StoredCliCredential; backend?: CredentialStoreBackend } {
  if (!isSecureStoreEnabled(env)) {
    return {};
  }

  if (process.platform === "darwin") {
    return {
      credential: readFromMacosKeychain(target),
      backend: "macos_keychain",
    };
  }

  if (process.platform === "linux") {
    return {
      credential: readFromLinuxLibsecret(target),
      backend: "linux_libsecret",
    };
  }

  return {};
}

function writeToSecureStore(
  target: string,
  credential: StoredCliCredential,
  env: NodeJS.ProcessEnv,
): CredentialStoreBackend | undefined {
  if (!isSecureStoreEnabled(env)) {
    return undefined;
  }

  if (process.platform === "darwin") {
    return writeToMacosKeychain(target, credential) ? "macos_keychain" : undefined;
  }

  if (process.platform === "linux") {
    return writeToLinuxLibsecret(target, credential) ? "linux_libsecret" : undefined;
  }

  return undefined;
}

function clearSecureStore(target: string): void {
  if (process.platform === "darwin") {
    clearMacosKeychain(target);
    return;
  }

  if (process.platform === "linux") {
    clearLinuxLibsecret(target);
  }
}

function readFallbackCredentialMap(path: string): PersistedCredentialMap {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      version?: unknown;
      targets?: unknown;
    };
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === FALLBACK_FILE_SCHEMA_VERSION &&
      parsed.targets &&
      typeof parsed.targets === "object"
    ) {
      const normalizedTargets: Record<string, StoredCliCredential> = {};
      for (const [target, credential] of Object.entries(parsed.targets as Record<string, unknown>)) {
        const normalized = normalizeCredential(credential);
        if (normalized) {
          normalizedTargets[target] = normalized;
        }
      }
      return {
        version: FALLBACK_FILE_SCHEMA_VERSION,
        targets: normalizedTargets,
      };
    }
  } catch {
    // ignore malformed files and treat as empty.
  }

  return {
    version: FALLBACK_FILE_SCHEMA_VERSION,
    targets: {},
  };
}

function writeFallbackCredentialMap(path: string, payload: PersistedCredentialMap): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  if (process.platform !== "win32") {
    chmodSync(path, 0o600);
  }
}

function readFromFallbackFile(target: string, env: NodeJS.ProcessEnv): StoredCliCredential | undefined {
  const filePath = resolveFallbackCredentialPath(env);
  const map = readFallbackCredentialMap(filePath);
  return map.targets[target];
}

function writeToFallbackFile(target: string, credential: StoredCliCredential, env: NodeJS.ProcessEnv): void {
  const filePath = resolveFallbackCredentialPath(env);
  const map = readFallbackCredentialMap(filePath);
  map.targets[target] = credential;
  writeFallbackCredentialMap(filePath, map);
}

function clearFallbackFile(target: string, env: NodeJS.ProcessEnv): void {
  const filePath = resolveFallbackCredentialPath(env);
  const map = readFallbackCredentialMap(filePath);
  if (!map.targets[target]) {
    return;
  }
  delete map.targets[target];
  if (Object.keys(map.targets).length === 0) {
    rmSync(filePath, { force: true });
    return;
  }
  writeFallbackCredentialMap(filePath, map);
}

export function loadStoredCliCredential(
  baseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): StoredCliCredential | undefined {
  if (!isCredentialStoreEnabled(env)) {
    return undefined;
  }

  const target = resolveCredentialTarget(baseUrl);
  const secure = readFromSecureStore(target, env);
  if (secure.credential) {
    return secure.credential;
  }

  return readFromFallbackFile(target, env);
}

export function saveStoredCliCredential(
  baseUrl: string,
  credential: StoredCliCredential,
  env: NodeJS.ProcessEnv = process.env,
): CredentialStoreBackend {
  const normalized = normalizeCredential(credential);
  if (!normalized) {
    throw new Error("Unable to persist credential: missing access token.");
  }

  if (!isCredentialStoreEnabled(env)) {
    return "disabled";
  }

  const target = resolveCredentialTarget(baseUrl);
  const secureBackend = writeToSecureStore(target, normalized, env);
  if (secureBackend) {
    return secureBackend;
  }

  writeToFallbackFile(target, normalized, env);
  return "fallback_file";
}

export function clearStoredCliCredential(
  baseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const target = resolveCredentialTarget(baseUrl);
  clearSecureStore(target);
  clearFallbackFile(target, env);
}

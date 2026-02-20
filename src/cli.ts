import { formatReviewRunError, runReviewRunCommand } from "./review-run-command";

const BLOCKED_PROVIDER_HOST_HINTS = [
  "lona",
  "live-engine",
  "binance",
  "alpaca",
  "kraken",
  "coinbase",
] as const;

const ALLOWED_LOCAL_LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

function emitJson(payload: unknown): void {
  console.log(JSON.stringify(payload, null, 2));
}

function emitError(payload: unknown): void {
  console.error(JSON.stringify(payload, null, 2));
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return String(error);
}

export function assertPlatformApiBaseUrl(url: string): void {
  const normalized = url.trim();

  if (!normalized) {
    throw new Error("PLATFORM_API_BASE_URL is required.");
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error("PLATFORM_API_BASE_URL must be an absolute http(s) URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("PLATFORM_API_BASE_URL must be an absolute http(s) URL.");
  }

  const hostname = parsed.hostname.toLowerCase();

  const isPlatformHost =
    hostname === "api.trade-nexus.io" || ALLOWED_LOCAL_LOOPBACK_HOSTS.has(hostname);

  const pointsToProvider = BLOCKED_PROVIDER_HOST_HINTS.some((hint) =>
    hostname.includes(hint),
  );

  if (pointsToProvider) {
    throw new Error(
      "Boundary violation: CLI must target Platform API only (no direct provider hosts).",
    );
  }

  if (!isPlatformHost) {
    throw new Error(
      "PLATFORM_API_BASE_URL host must be api.trade-nexus.io or a local loopback host.",
    );
  }
}

export async function run(argv: string[], fetchImpl: typeof fetch = fetch): Promise<number> {
  const baseUrl = process.env.PLATFORM_API_BASE_URL ?? "http://localhost:3000";

  try {
    assertPlatformApiBaseUrl(baseUrl);
  } catch (error) {
    emitError({
      status: "error",
      message: toErrorMessage(error),
    });
    return 1;
  }

  const args = argv.slice(2);
  if (args.length === 0) {
    emitJson({
      status: "ok",
      message: "trading-cli ready",
      target: baseUrl,
      commands: ["review-run trigger", "review-run retrieve"],
    });
    return 0;
  }

  if (args[0] !== "review-run") {
    emitJson({
      status: "ok",
      command: args,
      target: baseUrl,
    });
    return 0;
  }

  try {
    await runReviewRunCommand(args.slice(1), {
      baseUrl,
      env: process.env,
      fetchImpl,
      emit: emitJson,
    });
    return 0;
  } catch (error) {
    try {
      emitError(await formatReviewRunError(error));
    } catch {
      emitError({
        status: "error",
        message: toErrorMessage(error),
      });
    }
    return 1;
  }
}

if (import.meta.main) {
  run(process.argv)
    .then((exitCode) => {
      process.exit(exitCode);
    })
    .catch((error) => {
      emitError({
        status: "error",
        message: toErrorMessage(error),
      });
      process.exit(1);
    });
}

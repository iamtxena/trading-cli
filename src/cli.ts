const BLOCKED_PROVIDER_HOST_HINTS = [
  "lona",
  "live-engine",
  "binance",
  "alpaca",
  "kraken",
  "coinbase"
] as const;

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
    hostname === "api.trade-nexus.io" || hostname === "localhost";

  const pointsToProvider = BLOCKED_PROVIDER_HOST_HINTS.some((hint) =>
    hostname.includes(hint)
  );

  if (!isPlatformHost || pointsToProvider) {
    throw new Error(
      "Boundary violation: CLI must target Platform API only (no direct provider hosts)."
    );
  }
}

export function run(argv: string[]): number {
  const baseUrl = process.env.PLATFORM_API_BASE_URL ?? "http://localhost:3000";
  assertPlatformApiBaseUrl(baseUrl);

  const args = argv.slice(2);
  if (args.length === 0) {
    console.log("trading-cli bootstrap: Platform API boundary checks enabled.");
    return 0;
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        command: args,
        target: baseUrl
      },
      null,
      2
    )
  );
  return 0;
}

if (import.meta.main) {
  process.exit(run(process.argv));
}

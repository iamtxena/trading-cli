type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const DEFAULT_TIMEOUT_MS = 15000;

export type ConsumerRequestOptions = {
  headers?: Record<string, string>;
};

function withTrailingSlashTrimmed(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function requestJson(
  baseUrl: string,
  path: string,
  method: "GET" | "POST",
  body: unknown | null,
  fetchImpl: FetchLike,
  options: ConsumerRequestOptions
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const requestHeaders: Record<string, string> = {
      "X-Request-Id": "req-cli-consumer-mock-001",
      ...(options.headers ?? {})
    };
    if (body !== null) {
      requestHeaders["Content-Type"] = "application/json";
    }
    const response = await fetchImpl(`${withTrailingSlashTrimmed(baseUrl)}${path}`, {
      method,
      signal: controller.signal,
      headers: requestHeaders,
      body: body === null ? undefined : JSON.stringify(body)
    });

    const rawPayload = await response.text();
    if (!response.ok) {
      const suffix = rawPayload.trim() ? ` body=${rawPayload.slice(0, 256)}` : "";
      throw new Error(`Platform API request failed (${method} ${path}): HTTP ${response.status}${suffix}`);
    }

    if (!rawPayload.trim()) {
      return {};
    }

    try {
      return JSON.parse(rawPayload) as unknown;
    } catch {
      throw new Error(`Platform API response was not valid JSON (${method} ${path}).`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(payload: unknown, operation: string): Record<string, unknown> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`${operation} expected JSON object response.`);
  }
  return payload as Record<string, unknown>;
}

function requiredString(payload: Record<string, unknown>, field: string, operation: string): string {
  const value = payload[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${operation} expected non-empty string field '${field}'.`);
  }
  return value;
}

export async function fetchMarketScanEnvelope(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  options: ConsumerRequestOptions = {}
): Promise<{ requestId: string; strategyIdeas: unknown[] }> {
  const payload = asRecord(
    await requestJson(
      baseUrl,
      "/v1/research/market-scan",
      "POST",
      {
        assetClasses: ["crypto"],
        capital: 25000,
        constraints: {
          maxPositionPct: 20,
          maxDrawdownPct: 12
        }
      },
      fetchImpl,
      options
    ),
    "market-scan"
  );
  const strategyIdeas = payload.strategyIdeas;
  if (!Array.isArray(strategyIdeas)) {
    throw new Error("market-scan expected array field 'strategyIdeas'.");
  }
  return {
    requestId: requiredString(payload, "requestId", "market-scan"),
    strategyIdeas
  };
}

export async function fetchStrategiesEnvelope(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  options: ConsumerRequestOptions = {}
): Promise<{ requestId: string; items: unknown[] }> {
  const payload = asRecord(
    await requestJson(
      baseUrl,
      "/v1/strategies",
      "GET",
      null,
      fetchImpl,
      options
    ),
    "list-strategies"
  );
  const items = payload.items;
  if (!Array.isArray(items)) {
    throw new Error("list-strategies expected array field 'items'.");
  }
  return {
    requestId: requiredString(payload, "requestId", "list-strategies"),
    items
  };
}

export async function createConversationSessionEnvelope(
  baseUrl: string,
  fetchImpl: FetchLike = fetch,
  options: ConsumerRequestOptions = {}
): Promise<{ requestId: string; sessionId: string }> {
  const payload = asRecord(
    await requestJson(
      baseUrl,
      "/v2/conversations/sessions",
      "POST",
      {
        channel: "openclaw",
        topic: "cli consumer contract test",
        metadata: {
          source: "trading-cli-consumer-test"
        }
      },
      fetchImpl,
      options
    ),
    "create-conversation-session"
  );
  const session = asRecord(payload.session, "create-conversation-session.session");
  return {
    requestId: requiredString(payload, "requestId", "create-conversation-session"),
    sessionId: requiredString(session, "id", "create-conversation-session.session")
  };
}

export async function createConversationTurnEnvelope(
  baseUrl: string,
  sessionId: string,
  fetchImpl: FetchLike = fetch,
  options: ConsumerRequestOptions = {}
): Promise<{ requestId: string; turnId: string; sessionId: string }> {
  const payload = asRecord(
    await requestJson(
      baseUrl,
      `/v2/conversations/sessions/${encodeURIComponent(sessionId)}/turns`,
      "POST",
      {
        role: "user",
        message: "scan and deploy",
        metadata: {
          source: "trading-cli-consumer-test"
        }
      },
      fetchImpl,
      options
    ),
    "create-conversation-turn"
  );
  const responseSessionId = requiredString(payload, "sessionId", "create-conversation-turn");
  if (responseSessionId !== sessionId) {
    throw new Error(
      `create-conversation-turn expected sessionId '${sessionId}' but received '${responseSessionId}'.`
    );
  }
  const turn = asRecord(payload.turn, "create-conversation-turn.turn");
  const turnSessionId = requiredString(turn, "sessionId", "create-conversation-turn.turn");
  if (turnSessionId !== sessionId) {
    throw new Error(
      `create-conversation-turn.turn expected sessionId '${sessionId}' but received '${turnSessionId}'.`
    );
  }
  return {
    requestId: requiredString(payload, "requestId", "create-conversation-turn"),
    sessionId: responseSessionId,
    turnId: requiredString(turn, "id", "create-conversation-turn.turn")
  };
}

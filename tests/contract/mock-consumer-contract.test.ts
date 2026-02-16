import { describe, expect, test } from "bun:test";

import { assertPlatformApiBaseUrl } from "../../src/cli";
import {
  createConversationSessionEnvelope,
  createConversationTurnEnvelope,
  fetchMarketScanEnvelope,
  fetchStrategiesEnvelope
} from "../../src/platform-api-consumer";

const RUN_MOCK_CONSUMER_TESTS = process.env.RUN_MOCK_CONSUMER_TESTS === "1";
const mockTest = RUN_MOCK_CONSUMER_TESTS ? test : test.skip;
const BASE_URL = process.env.MOCK_API_BASE_URL ?? "http://127.0.0.1:4010";
const REQUEST_OPTIONS = {
  headers: {
    Authorization: "Bearer mock-token",
    "X-API-Key": "mock-api-key",
    "X-Request-Id": "req-cli-consumer-mock-001"
  }
} as const;

describe("consumer-driven Platform API mock contracts", () => {
  mockTest("validates research and strategy payload envelopes", async () => {
    assertPlatformApiBaseUrl(BASE_URL);

    const marketScan = await fetchMarketScanEnvelope(BASE_URL, fetch, REQUEST_OPTIONS);
    expect(typeof marketScan.requestId).toBe("string");
    expect(Array.isArray(marketScan.strategyIdeas)).toBe(true);

    const strategies = await fetchStrategiesEnvelope(BASE_URL, fetch, REQUEST_OPTIONS);
    expect(typeof strategies.requestId).toBe("string");
    expect(Array.isArray(strategies.items)).toBe(true);
  });

  mockTest("validates conversation session and turn payload envelopes", async () => {
    assertPlatformApiBaseUrl(BASE_URL);

    const session = await createConversationSessionEnvelope(BASE_URL, fetch, REQUEST_OPTIONS);
    expect(typeof session.requestId).toBe("string");
    expect(session.sessionId.length).toBeGreaterThan(0);

    const turn = await createConversationTurnEnvelope(BASE_URL, session.sessionId, fetch, REQUEST_OPTIONS);
    expect(typeof turn.requestId).toBe("string");
    expect(turn.sessionId.length).toBeGreaterThan(0);
    expect(turn.turnId.length).toBeGreaterThan(0);
  });
});

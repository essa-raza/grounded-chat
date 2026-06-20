import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/model", () => ({
  getChatModel: () => ({
    model: {} as never,
    providerLabel: "mock-provider:test-model",
  }),
}));

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof import("ai")>("ai");

  async function* mockedFullStream() {
    yield {
      type: "start-step",
      request: {},
      warnings: [],
    };
    yield {
      type: "tool-input-start",
      id: "tool-1",
      toolName: "searchListings",
    };
    yield {
      type: "tool-result",
      toolCallId: "tool-1",
      toolName: "searchListings",
      input: { query: "brookline cafe" },
      output: {
        results: [
          {
            id: "din-001",
            name: "The Mill House Cafe",
            category: "dining",
            city: "Brookline",
            tags: ["breakfast", "coffee", "vegetarian-friendly"],
            priceTier: "$",
            blurb: "Small-batch coffee and all-day breakfast in a restored grain mill.",
            externalUrl: "https://example.com/mill-house-cafe",
          },
        ],
      },
    };
    yield {
      type: "text-start",
      id: "text-1",
    };
    yield {
      type: "text-delta",
      id: "text-1",
      text: "The Mill House Cafe is a good fit for breakfast and coffee.",
    };
    yield {
      type: "text-end",
      id: "text-1",
    };
    yield {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    };
  }

  return {
    ...actual,
    convertToModelMessages: vi.fn(async () => []),
    streamText: vi.fn(() => ({
      fullStream: mockedFullStream(),
    })),
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("chat route contract", () => {
  it("streams refusal-safe parts for out-of-scope requests", async () => {
    const { POST } = await import("../src/app/api/chat/route");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Can you book a flight for me?" }],
            },
          ],
        }),
      }),
    );

    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"data-notice"');
    expect(body).toContain('"type":"data-status"');
    expect(body).toContain('"type":"data-listingReferences"');
    expect(body).toContain('"type":"data-audit"');
    expect(body).toContain("Request refused safely");
  });

  it("streams success contract parts for an in-scope request", async () => {
    const { POST } = await import("../src/app/api/chat/route");

    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [
            {
              id: "user-2",
              role: "user",
              parts: [
                {
                  type: "text",
                  text: "Find a Brookline breakfast spot from the dataset.",
                },
              ],
            },
          ],
        }),
      }),
    );

    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain('"type":"data-notice"');
    expect(body).toContain('"type":"data-status"');
    expect(body).toContain('"type":"data-listingReferences"');
    expect(body).toContain('"type":"data-audit"');
    expect(body).toContain("Validated results ready");
  });
});

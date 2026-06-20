import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";

type ResolvedModel = {
  model: ReturnType<ReturnType<typeof createOpenAI>>;
  providerLabel: string;
};

export function getChatModel(): ResolvedModel {
  const provider = process.env.AI_PROVIDER?.toLowerCase() ?? "openai";

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const modelName =
      process.env.ANTHROPIC_MODEL ?? "claude-3-5-sonnet-latest";

    if (!apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY for AI_PROVIDER=anthropic.");
    }

    const client = createAnthropic({ apiKey });
    return {
      model: client(modelName) as ReturnType<ReturnType<typeof createOpenAI>>,
      providerLabel: `anthropic:${modelName}`,
    };
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
  const baseURL = process.env.OPENAI_BASE_URL;

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY for AI_PROVIDER=openai.");
  }

  const usesOpenRouter = baseURL?.includes("openrouter.ai");

  const client = createOpenAI({
    apiKey,
    baseURL,
    headers: usesOpenRouter
      ? {
          "HTTP-Referer":
            process.env.OPENAI_SITE_URL ?? "http://localhost:3000",
          "X-Title": process.env.OPENAI_APP_NAME ?? "Grounded Chat Trial",
        }
      : undefined,
  });

  return {
    model: client(modelName),
    providerLabel: usesOpenRouter
      ? `openrouter:${modelName}`
      : `openai-compatible:${modelName}`,
  };
}

import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";

import { DISCLAIMER_TEXT, SCOPE_NOTE } from "@/lib/constants";
import { buildRefusalMessage, buildScopedPromptMessage, detectOutOfScope, detectPromptInjection, detectSmallTalk } from "@/lib/guardrails";
import { hasRecommendationIntent, recoverListingsForQuery } from "@/lib/listings";
import { logGuardrailEvent } from "@/lib/logger";
import { getChatModel } from "@/lib/model";
import { createListingTools } from "@/lib/tools";
import type { ChatMessage } from "@/lib/types";
import {
  createApprovalTracker,
  finalizeAssistantTurn,
  registerApprovedListings,
} from "@/lib/validation";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function writeStaticAssistantText(
  writer: Parameters<Parameters<typeof createUIMessageStream<ChatMessage>>[0]["execute"]>[0]["writer"],
  text: string,
) {
  const textId = `text-${crypto.randomUUID()}`;

  writer.write({
    type: "text-start",
    id: textId,
  });
  writer.write({
    type: "text-delta",
    id: textId,
    delta: text,
  });
  writer.write({
    type: "text-end",
    id: textId,
  });
}

function buildSystemPrompt() {
  return [
    "You are a strictly grounded listings assistant.",
    "You may recommend only listings returned by the provided tools in this turn.",
    "Never answer from open-web or pretrained knowledge.",
    "Never invent listings, prices, availability, hours, bookings, or facts.",
    "Never expose raw destination URLs in prose and never mention listing IDs in prose.",
    "If a listing has externalUrl null, say the official external link is unavailable in the dataset.",
    "If the request is out of scope, refuse briefly and redirect to supported listing questions.",
    `End every answer with this exact sentence: ${DISCLAIMER_TEXT}`,
  ].join(" ");
}

function writeAssistantText(
  writer: Parameters<Parameters<typeof createUIMessageStream<ChatMessage>>[0]["execute"]>[0]["writer"],
  text: string,
) {
  const textId = `assistant-${crypto.randomUUID()}`;

  writer.write({
    type: "text-start",
    id: textId,
  });
  writer.write({
    type: "text-delta",
    id: textId,
    delta: text,
  });
  writer.write({
    type: "text-end",
    id: textId,
  });
}

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestUserText =
    latestUserMessage?.parts
      .filter((part): part is Extract<(typeof latestUserMessage.parts)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim() ?? "";

  const refusalReason =
    detectPromptInjection(latestUserText) ?? detectOutOfScope(latestUserText);
  const smallTalkResponse = detectSmallTalk(latestUserText);
  const scopedPromptResponse =
    !smallTalkResponse &&
    !refusalReason &&
    !hasRecommendationIntent(latestUserText)
      ? buildScopedPromptMessage()
      : null;

  return createUIMessageStreamResponse({
    stream: createUIMessageStream<ChatMessage>({
      execute: async ({ writer }) => {
        writer.write({
          type: "data-notice",
          data: {
            disclaimer: DISCLAIMER_TEXT,
            scope: SCOPE_NOTE,
          },
        });
        writer.write({
          type: "data-status",
          data: {
            phase: "thinking",
            label: "Reading your request",
            detail: "Preparing a grounded tool-only response.",
          },
        });

        if (smallTalkResponse || scopedPromptResponse || refusalReason) {
          const refusalText =
            smallTalkResponse ??
            scopedPromptResponse ??
            buildRefusalMessage(refusalReason ?? "");

          writeStaticAssistantText(writer, refusalText);
          writer.write({
            type: "data-listingReferences",
            data: {
              listingIds: [],
              listings: [],
              validationStatus: "approved",
              note: "No listings were returned because the request was refused before any tool call.",
            },
          });
          writer.write({
            type: "data-audit",
            data: {
              referencedIds: [],
              referencedUrls: [],
              invalidIds: [],
              invalidUrls: [],
              approvedIds: [],
              approvedUrls: [],
              logged: false,
              sanitized: false,
            },
          });
          writer.write({
            type: "data-status",
            data: {
              phase: smallTalkResponse || scopedPromptResponse ? "ready" : "refused",
              label:
                smallTalkResponse || scopedPromptResponse
                  ? "Ready for a grounded request"
                  : "Request refused safely",
              detail: smallTalkResponse
                ? "Handled a general greeting without drifting outside the dataset scope."
                : scopedPromptResponse
                  ? "Handled a vague or random input without drifting into retrieval."
                : "The request was outside scope or attempted to override guardrails.",
            },
          });
          return;
        }

        const tracker = createApprovalTracker();
        const { model, providerLabel } = getChatModel();
        const modelMessages = await convertToModelMessages(messages);
        const result = streamText({
          model,
          system: buildSystemPrompt(),
          messages: modelMessages,
          tools: createListingTools(tracker),
          toolChoice: "auto",
          temperature: 0.2,
          stopWhen: stepCountIs(4),
          providerOptions: {
            openai: {
              parallelToolCalls: false,
            },
          },
        });
        let draftText = "";

        for await (const part of result.fullStream) {
          switch (part.type) {
            case "start-step":
              writer.write({
                type: "data-status",
                data: {
                  phase: "searching",
                  label: "Searching the approved dataset",
                  detail: "The assistant is using typed tools only.",
                },
              });
              break;
            case "tool-input-start":
              writer.write({
                type: "data-status",
                data: {
                  phase: "searching",
                  label: "Running typed tool",
                  detail: `Using ${part.toolName} against the local listings fixture.`,
                },
              });
              break;
            case "tool-result":
              writer.write({
                type: "data-status",
                data: {
                  phase: "drafting",
                  label: "Tool results approved",
                  detail: "Composing the final answer from approved entries only.",
                },
              });
              break;
            case "text-start":
              writer.write({
                type: "data-status",
                data: {
                  phase: "drafting",
                  label: "Drafting response",
                  detail: "Buffering the answer before final safety validation.",
                },
              });
              break;
            case "text-delta":
              draftText += part.text;
              break;
            default:
              break;
          }
        }

        if (hasRecommendationIntent(latestUserText)) {
          const recoveredListings = recoverListingsForQuery(latestUserText);
          if (recoveredListings.length > 0) {
            registerApprovedListings(tracker, recoveredListings);
          }
        }

        const finalizedTurn = finalizeAssistantTurn(draftText, tracker, latestUserText);

        if (finalizedTurn.audit.logged) {
          logGuardrailEvent({
            timestamp: new Date().toISOString(),
            invalidIds: finalizedTurn.audit.invalidIds,
            invalidUrls: finalizedTurn.audit.invalidUrls,
            message: latestUserText,
          });
        }

        writer.write({
          type: "data-status",
          data: {
            phase: "validating",
            label: "Validating final answer",
            detail: "Checking prose and structured references against approved tool results.",
          },
        });
        writeAssistantText(writer, finalizedTurn.assistantText);
        writer.write({
          type: "data-listingReferences",
          data: finalizedTurn.listingReferences,
        });
        writer.write({
          type: "data-audit",
          data: finalizedTurn.audit,
        });
        writer.write({
          type: "data-notice",
          data: {
            disclaimer: DISCLAIMER_TEXT,
            scope: `${SCOPE_NOTE} Active model: ${providerLabel}.`,
          },
        });
        writer.write({
          type: "data-status",
          data: finalizedTurn.wasRefused
            ? {
                phase: "refused",
                label: "Unsafe draft blocked",
                detail: "A safe fallback was returned instead of exposing unapproved content.",
              }
            : {
                phase: "ready",
                label: "Validated results ready",
                detail: "Cards and answer were checked against approved tool output.",
              },
        });
      },
      onError: (error) => {
        console.error(error);
        return "The assistant hit an unexpected server error.";
      },
    }),
  });
}

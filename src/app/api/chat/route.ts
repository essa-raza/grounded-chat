import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";

import { DISCLAIMER_TEXT, SCOPE_NOTE } from "@/lib/constants";
import {
  buildRefusalMessage,
  buildScopedPromptMessage,
  detectOutOfScope,
  detectPromptInjection,
  detectSmallTalk,
} from "@/lib/guardrails";
import { hasRecommendationIntent } from "@/lib/listings";
import { getChatModel } from "@/lib/model";
import { resolveUserQuery } from "@/lib/query-resolver";
import { createListingTools } from "@/lib/tools";
import type { ChatMessage, Listing } from "@/lib/types";
import {
  createApprovalTracker,
  finalizeAssistantTurn,
  registerApprovedListings,
} from "@/lib/validation";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

const SYSTEM_PROMPT = [
  "You are a grounded local listings assistant.",
  "You may only answer using information returned by the provided tools.",
  "Never use training data, world knowledge, or web knowledge for listing facts or recommendations.",
  "Always call searchListings before recommending any place or answering any factual question about a place.",
  "If the dataset does not include a requested detail such as live availability, hours, bookings, raw destination URLs, Google Maps links, phone numbers, or pricing beyond the listed price tier, say that the dataset does not include it.",
  "If the user asks for flights, bookings, live availability, open-web comparisons, or anything outside the dataset scope, refuse briefly and redirect to supported dataset queries.",
  "Recommend only listings returned by tool results for this turn.",
  "Do not invent listings, ids, links, or facts.",
  "Do not print raw listing ids or raw URLs in assistant prose.",
  "Keep answers concise and customer-facing.",
].join(" ");

function getMessageText(message: UIMessage): string {
  return (
    message.parts
      .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim() ?? ""
  );
}

function hasConversationHistory(messages: UIMessage[]): boolean {
  return messages.filter((message) => message.role === "user").length > 1;
}

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

function buildImmediateTurn(text: string, label: string, detail: string, phase: "ready" | "refused") {
  return {
    assistantText: text,
    listings: [],
    status: {
      phase,
      label,
      detail,
    },
    note: "No structured listing references were returned for this turn.",
    logged: phase === "refused",
    sanitized: false,
  };
}

function isListing(value: unknown): value is Listing {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Listing>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.city === "string" &&
    typeof candidate.blurb === "string" &&
    Array.isArray(candidate.tags)
  );
}

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
  const latestUserText = latestUserMessage ? getMessageText(latestUserMessage) : "";
  const hasHistory = hasConversationHistory(messages);

  const smallTalk = detectSmallTalk(latestUserText);
  if (smallTalk) {
    const resolution = buildImmediateTurn(
      smallTalk,
      "Ready for a grounded request",
      "Handled a general greeting without drifting outside the dataset scope.",
      "ready",
    );

    return createUIMessageStreamResponse({
      stream: createUIMessageStream<ChatMessage>({
        execute: async ({ writer }) => {
          writer.write({
            type: "data-notice",
            data: { disclaimer: DISCLAIMER_TEXT, scope: SCOPE_NOTE },
          });
          writer.write({ type: "data-status", data: resolution.status });
          writeStaticAssistantText(writer, resolution.assistantText);
          writer.write({
            type: "data-listingReferences",
            data: {
              listingIds: [],
              listings: [],
              validationStatus: "approved",
              note: resolution.note,
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
        },
      }),
    });
  }

  const promptInjection = detectPromptInjection(latestUserText);
  if (promptInjection) {
    const resolution = buildImmediateTurn(
      buildRefusalMessage(promptInjection),
      "Request refused safely",
      "The request attempted to override guardrails or reveal unsupported data.",
      "refused",
    );

    return createUIMessageStreamResponse({
      stream: createUIMessageStream<ChatMessage>({
        execute: async ({ writer }) => {
          writer.write({
            type: "data-notice",
            data: { disclaimer: DISCLAIMER_TEXT, scope: SCOPE_NOTE },
          });
          writer.write({ type: "data-status", data: resolution.status });
          writeStaticAssistantText(writer, resolution.assistantText);
          writer.write({
            type: "data-listingReferences",
            data: {
              listingIds: [],
              listings: [],
              validationStatus: "approved",
              note: resolution.note,
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
              logged: true,
              sanitized: false,
            },
          });
        },
      }),
    });
  }

  const outOfScope = detectOutOfScope(latestUserText);
  if (outOfScope) {
    const resolution = buildImmediateTurn(
      buildRefusalMessage(outOfScope),
      "Request refused safely",
      "The request was outside the supported dataset scope.",
      "refused",
    );

    return createUIMessageStreamResponse({
      stream: createUIMessageStream<ChatMessage>({
        execute: async ({ writer }) => {
          writer.write({
            type: "data-notice",
            data: { disclaimer: DISCLAIMER_TEXT, scope: SCOPE_NOTE },
          });
          writer.write({ type: "data-status", data: resolution.status });
          writeStaticAssistantText(writer, resolution.assistantText);
          writer.write({
            type: "data-listingReferences",
            data: {
              listingIds: [],
              listings: [],
              validationStatus: "approved",
              note: resolution.note,
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
              logged: true,
              sanitized: false,
            },
          });
        },
      }),
    });
  }

  if (!hasHistory && !hasRecommendationIntent(latestUserText)) {
    const resolution = buildImmediateTurn(
      buildScopedPromptMessage(),
      "Ready for a grounded request",
      "Handled a vague prompt without drifting into unrelated results.",
      "ready",
    );

    return createUIMessageStreamResponse({
      stream: createUIMessageStream<ChatMessage>({
        execute: async ({ writer }) => {
          writer.write({
            type: "data-notice",
            data: { disclaimer: DISCLAIMER_TEXT, scope: SCOPE_NOTE },
          });
          writer.write({ type: "data-status", data: resolution.status });
          writeStaticAssistantText(writer, resolution.assistantText);
          writer.write({
            type: "data-listingReferences",
            data: {
              listingIds: [],
              listings: [],
              validationStatus: "approved",
              note: resolution.note,
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
        },
      }),
    });
  }

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
            detail: "Preparing a grounded dataset-only response.",
          },
        });

        const tracker = createApprovalTracker();
        const tools = createListingTools(tracker);
        const { model, providerLabel } = getChatModel();
        const modelMessages = await convertToModelMessages(messages, { tools });

        writer.write({
          type: "data-status",
          data: {
            phase: "searching",
            label: "Planning tool use",
            detail: `Using ${providerLabel} with typed dataset tools only.`,
          },
        });

        const result = streamText({
          model,
          system: SYSTEM_PROMPT,
          messages: modelMessages,
          tools,
          stopWhen: stepCountIs(4),
          temperature: 0,
        });

        let draftText = "";

        for await (const part of result.fullStream) {
          if (part.type === "tool-input-start") {
            writer.write({
              type: "data-status",
              data: {
                phase: "searching",
                label: "Searching approved listings",
                detail: `Running ${part.toolName} against the fixed dataset.`,
              },
            });
          }

          if (part.type === "tool-result") {
            if (
              part.toolName === "searchListings" &&
              part.output &&
              typeof part.output === "object" &&
              "results" in part.output &&
              Array.isArray(part.output.results)
            ) {
              registerApprovedListings(tracker, part.output.results);
            }

            if (
              part.toolName === "getListingById" &&
              part.output &&
              typeof part.output === "object" &&
              "listing" in part.output &&
              isListing(part.output.listing)
            ) {
              registerApprovedListings(tracker, [part.output.listing]);
            }

            writer.write({
              type: "data-status",
              data: {
                phase: "drafting",
                label: "Drafting grounded answer",
                detail: `Tool results received from ${part.toolName}.`,
              },
            });
          }

          if (part.type === "text-delta") {
            draftText += part.text;
          }
        }

        writer.write({
          type: "data-status",
          data: {
            phase: "validating",
            label: "Validating output",
            detail: "Checking that the final answer only references approved results.",
          },
        });

        const finalized = finalizeAssistantTurn(draftText, tracker, latestUserText);
        const deterministicResolution = resolveUserQuery(latestUserText);
        const shouldForceNoMatch =
          deterministicResolution.listings.length === 0 &&
          finalized.listingReferences.listingIds.length > 0;
        const shouldRegenerateFromDeterministicFallback =
          deterministicResolution.listings.length > 0 &&
          finalized.listingReferences.listingIds.length === 0;

        if (shouldRegenerateFromDeterministicFallback) {
          registerApprovedListings(tracker, deterministicResolution.listings);
        }

        const finalTurn = shouldForceNoMatch
          ? {
              assistantText: deterministicResolution.assistantText,
              listingReferences: {
                listingIds: [],
                listings: [],
                validationStatus: "sanitized" as const,
                note: "The model found a partial match, but the final result was reduced to a deterministic no-match response because the full query constraints were not satisfied.",
              },
              audit: {
                ...finalized.audit,
                logged: true,
                sanitized: true,
              },
              wasRefused: true,
            }
          : shouldRegenerateFromDeterministicFallback
            ? {
                assistantText: deterministicResolution.assistantText,
                listingReferences: {
                  listingIds: deterministicResolution.listings.map((listing) => listing.id),
                  listings: deterministicResolution.listings,
                  validationStatus: "sanitized" as const,
                  note: "The model/tool draft produced no usable references, so the server regenerated a grounded fallback from the fixed dataset.",
                },
                audit: {
                  ...finalized.audit,
                  approvedIds: [...tracker.approvedIds],
                  approvedUrls: [...tracker.approvedUrls],
                  logged: true,
                  sanitized: true,
                },
                wasRefused: false,
              }
            : finalized;

        writer.write({
          type: "data-status",
          data: finalTurn.wasRefused
            ? {
                phase: "refused",
                label: "Request refused safely",
                detail: "The final answer could not be safely grounded to approved tool results.",
              }
            : {
                phase: "ready",
                label: "Validated results ready",
                detail: "The answer and cards were derived from approved tool results only.",
              },
        });

        writeStaticAssistantText(writer, finalTurn.assistantText);
        writer.write({
          type: "data-listingReferences",
          data: finalTurn.listingReferences,
        });
        writer.write({
          type: "data-audit",
          data: finalTurn.audit,
        });
      },
      onError: (error) => {
        console.error(error);
        return "The assistant hit an unexpected server error.";
      },
    }),
  });
}

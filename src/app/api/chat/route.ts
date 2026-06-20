import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";

import { DISCLAIMER_TEXT, SCOPE_NOTE } from "@/lib/constants";
import { resolveUserQuery, type ResolverContext } from "@/lib/query-resolver";
import type { ChatMessage } from "@/lib/types";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

function getMessageText(message: UIMessage): string {
  return (
    message.parts
      .filter((part): part is Extract<(typeof message.parts)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join(" ")
      .trim() ?? ""
  );
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

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const userMessages = messages.filter((message) => message.role === "user");
  const latestUserText = getMessageText(userMessages[userMessages.length - 1] as UIMessage);
  let context: ResolverContext = {};

  for (const message of userMessages.slice(0, -1)) {
    const userText = getMessageText(message);

    if (!userText) {
      continue;
    }

    const priorResolution = resolveUserQuery(userText, context);
    context = {
      previousListings:
        priorResolution.listings.length > 0 ? priorResolution.listings : context.previousListings,
      previousQuery: userText,
    };
  }

  const resolution = resolveUserQuery(latestUserText, context);

  return createUIMessageStreamResponse({
    stream: createUIMessageStream<ChatMessage>({
      execute: async ({ writer }) => {
        const approvedIds = resolution.listings.map((listing) => listing.id);
        const approvedUrls = resolution.listings
          .map((listing) => listing.externalUrl)
          .filter((url): url is string => Boolean(url));

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
        writer.write({
          type: "data-status",
          data: resolution.status,
        });
        writeStaticAssistantText(writer, resolution.assistantText);
        writer.write({
          type: "data-listingReferences",
          data: {
            listingIds: approvedIds,
            listings: resolution.listings,
            validationStatus: resolution.sanitized ? "sanitized" : "approved",
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
            approvedIds,
            approvedUrls,
            logged: resolution.logged,
            sanitized: resolution.sanitized,
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

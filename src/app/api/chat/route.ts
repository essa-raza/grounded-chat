import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
} from "ai";

import { DISCLAIMER_TEXT, SCOPE_NOTE } from "@/lib/constants";
import { resolveUserQuery } from "@/lib/query-resolver";
import type { ChatMessage } from "@/lib/types";

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

export async function POST(request: Request) {
  const { messages } = (await request.json()) as { messages: UIMessage[] };
  const latestUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === "user");
  const latestUserText =
    latestUserMessage?.parts
      .filter(
        (
          part,
        ): part is Extract<(typeof latestUserMessage.parts)[number], { type: "text" }> =>
          part.type === "text",
      )
      .map((part) => part.text)
      .join(" ")
      .trim() ?? "";

  const resolution = resolveUserQuery(latestUserText);

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

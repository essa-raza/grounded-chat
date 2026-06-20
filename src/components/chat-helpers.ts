import type { AuditPayload, ChatMessage, Listing, StatusPayload } from "@/lib/types";

export const starterPrompts = [
  "Find two budget-friendly Brookline dining options for a family.",
  "What are the best Cape Vernon attractions in this dataset?",
  "Show me a good Ridgeway evening activity with nearby lodging.",
  "Show me two venue options for events in Cape Vernon.",
];

export function getLatestListings(messages: ChatMessage[]): Listing[] {
  const assistantMessages = [...messages]
    .reverse()
    .filter((message) => message.role === "assistant");

  for (const message of assistantMessages) {
    const dataPart = [...message.parts]
      .reverse()
      .find((part) => part.type === "data-listingReferences");

    if (dataPart?.type === "data-listingReferences") {
      return dataPart.data.listings;
    }
  }

  return [];
}

export function getLatestNotice(messages: ChatMessage[]): string | null {
  const assistantMessages = [...messages]
    .reverse()
    .filter((message) => message.role === "assistant");

  for (const message of assistantMessages) {
    const dataPart = [...message.parts]
      .reverse()
      .find((part) => part.type === "data-notice");

    if (dataPart?.type === "data-notice") {
      return dataPart.data.disclaimer;
    }
  }

  return null;
}

export function getLatestAudit(messages: ChatMessage[]): AuditPayload | null {
  const assistantMessages = [...messages]
    .reverse()
    .filter((message) => message.role === "assistant");

  for (const message of assistantMessages) {
    const dataPart = [...message.parts]
      .reverse()
      .find((part) => part.type === "data-audit");

    if (dataPart?.type === "data-audit") {
      return dataPart.data;
    }
  }

  return null;
}

export function getLatestStatus(messages: ChatMessage[]): StatusPayload | null {
  const assistantMessages = [...messages]
    .reverse()
    .filter((message) => message.role === "assistant");

  for (const message of assistantMessages) {
    const dataPart = [...message.parts]
      .reverse()
      .find((part) => part.type === "data-status");

    if (dataPart?.type === "data-status") {
      return dataPart.data;
    }
  }

  return null;
}

export function getMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

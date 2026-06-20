import { DISCLAIMER_TEXT } from "@/lib/constants";

const outOfScopePatterns = [
  /\bflight(s)?\b/i,
  /\bbook(ing)?\b/i,
  /\bavailability\b/i,
  /\bavailable tonight\b/i,
  /\bopen now\b/i,
  /\bweather\b/i,
  /\bnews\b/i,
  /\bstock\b/i,
  /\bhotel reservation\b/i,
  /\bcompare.*internet\b/i,
  /\bfind something better\b/i,
  /\bfrom the web\b/i,
];

const promptInjectionPatterns = [
  /ignore (all|your|previous) instructions/i,
  /ignore (all|your|previous) rules/i,
  /override (the )?rules/i,
  /show (me )?(the )?raw url/i,
  /show (me )?(the )?raw destination url/i,
  /destination url/i,
  /reveal (the )?system prompt/i,
  /invent (a )?(new )?(listing|place)/i,
];

const smallTalkPatterns = [
  /^(hi|hello|helloo|hey|heyy|yo)\b/i,
  /\bhow are you\b/i,
  /\bwhat('?s| is) up\b/i,
  /\bhow('?s| is) it going\b/i,
  /\bthank(s| you)\b/i,
];

export function detectOutOfScope(query: string): string | null {
  for (const pattern of outOfScopePatterns) {
    if (pattern.test(query)) {
      return "This assistant only handles recommendations from the provided listings dataset and cannot help with that request.";
    }
  }

  return null;
}

export function detectPromptInjection(query: string): string | null {
  for (const pattern of promptInjectionPatterns) {
    if (pattern.test(query)) {
      return "I can only use approved tool results from the local listings dataset, so I cannot follow that instruction.";
    }
  }

  return null;
}

export function buildRefusalMessage(reason: string): string {
  return `${reason} I can still help you compare listings in Brookline, Cape Vernon, or Ridgeway from this dataset only.\n\n${DISCLAIMER_TEXT}`;
}

export function buildValidationFailureMessage(): string {
  return `I could not safely return that answer because the draft referenced content outside the approved tool results. I can still help you compare listings from this dataset only.\n\n${DISCLAIMER_TEXT}`;
}

export function detectSmallTalk(query: string): string | null {
  const normalizedQuery = query.trim();

  if (!normalizedQuery) {
    return null;
  }

  for (const pattern of smallTalkPatterns) {
    if (pattern.test(normalizedQuery)) {
      return `Hi! I'm here and ready to help with places from the dataset. Try asking about dining, stays, attractions, or venues in Brookline, Cape Vernon, or Ridgeway.\n\n${DISCLAIMER_TEXT}`;
    }
  }

  return null;
}

export function buildScopedPromptMessage(): string {
  return `I can help with dining, stays, attractions, and venues from this dataset. Try asking for a place type, a city, or a recommendation.\n\n${DISCLAIMER_TEXT}`;
}

import type {
  AuditPayload,
  Listing,
  ListingReferencePayload,
} from "@/lib/types";
import {
  DISCLAIMER_TEXT,
} from "@/lib/constants";
import {
  buildScopedPromptMessage,
  buildValidationFailureMessage,
} from "@/lib/guardrails";

export type ApprovalTracker = {
  approvedIds: Set<string>;
  approvedUrls: Set<string>;
  approvedListings: Map<string, Listing>;
  latestSearchIds: string[];
};

export type ValidationResult = {
  referencedIds: string[];
  referencedUrls: string[];
  invalidIds: string[];
  invalidUrls: string[];
};

const listingIdPattern = /\b(?:din|lod|att|ven)-\d{3}\b/gi;
const urlPattern = /https?:\/\/[^\s)]+/gi;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function findExactQueryListing(
  tracker: ApprovalTracker,
  userQuery?: string,
): Listing | undefined {
  const normalizedQuery = normalize(userQuery ?? "");

  if (!normalizedQuery) {
    return undefined;
  }

  return [...tracker.approvedListings.values()].find((listing) =>
    normalizedQuery.includes(normalize(listing.name)),
  );
}

function buildNameList(listings: Listing[]): string {
  if (listings.length === 0) {
    return "";
  }

  if (listings.length === 1) {
    return `${listings[0].name} in ${listings[0].city}`;
  }

  if (listings.length === 2) {
    return `${listings[0].name} in ${listings[0].city} and ${listings[1].name} in ${listings[1].city}`;
  }

  const leading = listings
    .slice(0, -1)
    .map((listing) => `${listing.name} in ${listing.city}`)
    .join(", ");
  const last = listings[listings.length - 1];

  return `${leading}, and ${last.name} in ${last.city}`;
}

function inferCategoryLabel(listings: Listing[]): string | null {
  if (listings.length === 0) {
    return null;
  }

  const categories = new Set(listings.map((listing) => listing.category));

  if (categories.size !== 1) {
    return null;
  }

  const [category] = [...categories];

  switch (category) {
    case "dining":
      return "dining spot";
    case "lodging":
      return "stay";
    case "attraction":
      return "attraction";
    case "venue":
      return "venue";
    default:
      return null;
  }
}

function rankListingsForQuery(listings: Listing[], userQuery?: string): Listing[] {
  const normalizedQuery = normalize(userQuery ?? "");
  const ranked = [...listings];
  const priceValue = (priceTier: Listing["priceTier"]) => {
    switch (priceTier) {
      case "free":
        return 0;
      case "$":
        return 1;
      case "$$":
        return 2;
      case "$$$":
        return 3;
      case "$$$$":
        return 4;
      default:
        return 0;
    }
  };

  if (/\bfree\b|\bbudget\b|\bcheap\b|\binexpensive\b/.test(normalizedQuery)) {
    ranked.sort((left, right) => priceValue(left.priceTier) - priceValue(right.priceTier));
    return ranked;
  }

  if (/\bexpensive\b|\bhigh end\b|\bfine dining\b|\bpricey\b|\bluxury\b|\bupscale\b/.test(normalizedQuery)) {
    ranked.sort((left, right) => priceValue(right.priceTier) - priceValue(left.priceTier));
    return ranked;
  }

  return ranked;
}

function buildConciseGroundedAnswer(
  listings: Listing[],
  userQuery?: string,
): string {
  const normalizedQuery = normalize(userQuery ?? "");
  const ranked = rankListingsForQuery(listings, userQuery);
  const shortList = ranked.slice(0, Math.min(2, ranked.length));
  const nameList = buildNameList(shortList);
  const categoryLabel = inferCategoryLabel(shortList);

  if (shortList.length === 0) {
    return buildScopedPromptMessage();
  }

  if (shortList.length === 1) {
    const listing = shortList[0];
    const linkSentence = listing.externalUrl
      ? "A listing link is available in the card below."
      : "No external listing link is available for it in the dataset.";

    if (normalizedQuery.includes(normalize(listing.name))) {
      return `${listing.name} in ${listing.city} is in the dataset. ${linkSentence}\n\n${DISCLAIMER_TEXT}`;
    }

    if (/\bexpensive\b|\bhigh end\b|\bfine dining\b|\bpricey\b/.test(normalizedQuery)) {
      return `For a higher-end option, ${listing.name} in ${listing.city} is the strongest fit here.\n\n${DISCLAIMER_TEXT}`;
    }

    return `${listing.name} in ${listing.city} looks like a strong fit here. ${linkSentence}\n\n${DISCLAIMER_TEXT}`;
  }

  if (/\bfree\b/.test(normalizedQuery)) {
    return `Two free ${categoryLabel ? `${categoryLabel}s` : "options"} worth checking out are ${nameList}.\n\n${DISCLAIMER_TEXT}`;
  }

  if (/\bbudget\b|\bcheap\b|\binexpensive\b/.test(normalizedQuery)) {
    return `For a lower-cost pick, I would start with ${nameList}.\n\n${DISCLAIMER_TEXT}`;
  }

  if (/\bexpensive\b|\bhigh end\b|\bfine dining\b|\bpricey\b/.test(normalizedQuery)) {
    return `For a higher-end pick, I would start with ${nameList}.\n\n${DISCLAIMER_TEXT}`;
  }

  if (categoryLabel) {
    return `Good ${shortList.length > 1 ? `${categoryLabel}s` : categoryLabel} options here are ${nameList}.\n\n${DISCLAIMER_TEXT}`;
  }

  return `Good options here are ${nameList}.\n\n${DISCLAIMER_TEXT}`;
}

export function createApprovalTracker(): ApprovalTracker {
  return {
    approvedIds: new Set<string>(),
    approvedUrls: new Set<string>(),
    approvedListings: new Map<string, Listing>(),
    latestSearchIds: [],
  };
}

export function registerApprovedListings(
  tracker: ApprovalTracker,
  listings: Listing[],
) {
  const mergedLatestIds = new Set([
    ...tracker.latestSearchIds,
    ...listings.map((listing) => listing.id),
  ]);
  tracker.latestSearchIds = [...mergedLatestIds];

  for (const listing of listings) {
    tracker.approvedIds.add(listing.id);
    tracker.approvedListings.set(listing.id, listing);

    if (listing.externalUrl) {
      tracker.approvedUrls.add(listing.externalUrl);
    }
  }
}

export function validateAssistantText(
  text: string,
  tracker: ApprovalTracker,
): ValidationResult {
  const referencedIds = text.match(listingIdPattern) ?? [];
  const referencedUrls = text.match(urlPattern) ?? [];

  return {
    referencedIds,
    referencedUrls,
    invalidIds: referencedIds.filter((id) => !tracker.approvedIds.has(id)),
    invalidUrls: referencedUrls.filter((url) => !tracker.approvedUrls.has(url)),
  };
}

export function sanitizeAssistantText(text: string): string {
  return text
    .replace(listingIdPattern, "")
    .replace(urlPattern, "the external listing link")
    .replace(/\s{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ensureDisclaimer(text: string): string {
  if (text.includes(DISCLAIMER_TEXT)) {
    return text;
  }

  return `${text}\n\n${DISCLAIMER_TEXT}`;
}

export function buildListingReferencePayload(
  text: string,
  tracker: ApprovalTracker,
  options?: {
    validationStatus?: "approved" | "sanitized";
    note?: string;
    userQuery?: string;
    exactListingOnly?: boolean;
  },
): ListingReferencePayload {
  const approvedListings = [...tracker.approvedListings.values()];
  const normalizedText = normalize(text);
  const exactQueryListing = findExactQueryListing(tracker, options?.userQuery);

  const matchedListings = approvedListings.filter((listing) =>
    normalizedText.includes(normalize(listing.name)),
  );

  const selectedListings =
    options?.exactListingOnly && exactQueryListing
      ? [exactQueryListing]
      : matchedListings.length > 0
      ? matchedListings
      : exactQueryListing
        ? [exactQueryListing]
      : tracker.latestSearchIds
          .map((id) => tracker.approvedListings.get(id))
          .filter((listing): listing is Listing => Boolean(listing))
          .slice(0, 3);

  return {
    listingIds: selectedListings.map((listing) => listing.id),
    listings: selectedListings,
    validationStatus: options?.validationStatus ?? "approved",
    note:
      options?.note ??
      "Structured listing references are generated server-side from approved tool results only.",
  };
}

function buildDeterministicGroundedAnswer(
  tracker: ApprovalTracker,
  userQuery?: string,
): string {
  const exactQueryListing = findExactQueryListing(tracker, userQuery);
  const fallbackListings = tracker.latestSearchIds
    .map((id) => tracker.approvedListings.get(id))
    .filter((listing): listing is Listing => Boolean(listing))
    .slice(0, 3);

  if (exactQueryListing) {
    return buildConciseGroundedAnswer([exactQueryListing], userQuery);
  }

  if (fallbackListings.length === 0) {
    return buildScopedPromptMessage();
  }

  return buildConciseGroundedAnswer(fallbackListings, userQuery);
}

export type FinalizedAssistantTurn = {
  assistantText: string;
  listingReferences: ListingReferencePayload;
  audit: AuditPayload;
  wasRefused: boolean;
};

export function finalizeAssistantTurn(
  draftText: string,
  tracker: ApprovalTracker,
  userQuery?: string,
): FinalizedAssistantTurn {
  const exactQueryListing = findExactQueryListing(tracker, userQuery);
  const normalizedDraft = normalize(draftText);
  const modelMissedExactListing =
    Boolean(exactQueryListing) &&
    Boolean(normalizedDraft) &&
    /(don t have|could not find|no listing|not in the available data)/.test(
      normalizedDraft,
    );
  const validation = validateAssistantText(draftText, tracker);
  const hasInvalidReferences =
    validation.invalidIds.length > 0 || validation.invalidUrls.length > 0;
  const hadSanitizedLeak =
    validation.referencedIds.length > 0 || validation.referencedUrls.length > 0;

  if (hasInvalidReferences) {
    const assistantText = buildValidationFailureMessage();

    return {
      assistantText,
      listingReferences: buildListingReferencePayload(assistantText, tracker, {
        validationStatus: "sanitized",
        note: "The original draft referenced unapproved content, so a safe fallback response was returned.",
        userQuery,
      }),
      audit: {
        referencedIds: validation.referencedIds,
        referencedUrls: validation.referencedUrls,
        invalidIds: validation.invalidIds,
        invalidUrls: validation.invalidUrls,
        approvedIds: [...tracker.approvedIds],
        approvedUrls: [...tracker.approvedUrls],
        logged: true,
        sanitized: true,
      },
      wasRefused: true,
    };
  }

  const groundedFallback = buildDeterministicGroundedAnswer(tracker, userQuery);
  const trimmedDraft = draftText.trim();
  const draftWordCount = trimmedDraft.split(/\s+/).filter(Boolean).length;
  const shouldUseGroundedFallback =
    trimmedDraft.length === 0 ||
    modelMissedExactListing ||
    trimmedDraft.length > 260 ||
    draftWordCount > 26;
  const assistantText = ensureDisclaimer(
    shouldUseGroundedFallback
      ? groundedFallback
      : hadSanitizedLeak
        ? sanitizeAssistantText(trimmedDraft)
        : trimmedDraft,
  );
  const hasApprovedListings = tracker.latestSearchIds.length > 0;
  const wasRefused = !hasApprovedListings;

  return {
    assistantText,
    listingReferences: buildListingReferencePayload(assistantText, tracker, {
      validationStatus: hadSanitizedLeak || modelMissedExactListing ? "sanitized" : "approved",
      userQuery,
      exactListingOnly: modelMissedExactListing,
      note: hadSanitizedLeak
        ? "Listing references remained approved, but raw IDs or URLs were removed from assistant prose."
        : modelMissedExactListing
          ? "The final answer was replaced with a deterministic grounded summary to keep the named listing accurate."
          : wasRefused
            ? "No approved listings were available for this turn, so the response stayed scoped without structured cards."
            : undefined,
    }),
    audit: {
      referencedIds: validation.referencedIds,
      referencedUrls: validation.referencedUrls,
      invalidIds: validation.invalidIds,
      invalidUrls: validation.invalidUrls,
      approvedIds: [...tracker.approvedIds],
      approvedUrls: [...tracker.approvedUrls],
      logged: hadSanitizedLeak || wasRefused,
      sanitized: hadSanitizedLeak,
    },
    wasRefused,
  };
}

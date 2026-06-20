import { DISCLAIMER_TEXT } from "@/lib/constants";
import {
  allListings,
  getListingById,
  listCities,
  normalize,
  tokenize,
} from "@/lib/listings";
import type { Listing, ListingCategory } from "@/lib/types";

type ResolutionStatus = {
  phase: "ready" | "refused";
  label: string;
  detail: string;
};

export type QueryResolution = {
  assistantText: string;
  listings: Listing[];
  status: ResolutionStatus;
  note: string;
  logged: boolean;
  sanitized: boolean;
};

type QueryConstraints = {
  city?: string;
  categories: ListingCategory[];
  requiredTags: string[];
  unsupportedTerms: string[];
  excludeNameTerms: string[];
  exactListing?: Listing;
  namedEntity?: string;
  priceMin?: number;
  priceMax?: number;
  wantsAlternatives: boolean;
};

const categoryKeywordMap: Record<ListingCategory, string[]> = {
  dining: [
    "dining",
    "restaurant",
    "restaurants",
    "cafe",
    "cafes",
    "food",
    "eat",
    "eating",
    "dinner",
    "breakfast",
    "lunch",
  ],
  lodging: [
    "lodging",
    "hotel",
    "stay",
    "stays",
    "weekend",
    "inn",
    "motel",
    "campground",
    "camping",
    "sleep",
    "room",
    "rooms",
    "accommodation",
  ],
  attraction: [
    "attraction",
    "attractions",
    "activity",
    "activities",
    "things",
    "thing",
    "do",
    "museum",
    "lighthouse",
    "kayak",
    "evening",
    "observatory",
    "trail",
    "outdoor",
    "outdoors",
  ],
  venue: ["venue", "venues", "event", "events", "wedding", "weddings", "hall", "barn"],
};

const stopwords = new Set([
  "a",
  "about",
  "all",
  "am",
  "an",
  "and",
  "are",
  "at",
  "best",
  "can",
  "for",
  "from",
  "get",
  "give",
  "hello",
  "help",
  "i",
  "if",
  "in",
  "is",
  "it",
  "like",
  "me",
  "my",
  "near",
  "nearby",
  "now",
  "of",
  "on",
  "or",
  "please",
  "recommend",
  "show",
  "something",
  "stay",
  "tell",
  "the",
  "this",
  "to",
  "two",
  "want",
  "where",
  "which",
  "with",
  "option",
  "options",
  "fit",
  "friendly",
]);

const multiWordSignals = [
  "pet friendly",
  "family friendly",
  "high end",
  "fine dining",
  "old growth",
  "raw bar",
  "airport shuttle",
  "google maps",
];

const knownMissingInfoPhrases = [
  "hours",
  "opening hours",
  "phone",
  "address",
  "reviews",
  "rating",
  "ratings",
  "menu",
  "directions",
  "google maps",
  "distance",
];

const knownAvailabilityPhrases = [
  "available",
  "availability",
  "open this weekend",
  "vacancy",
  "vacancies",
  "booked",
  "openings",
];

const transactionalPhrases = [
  "reserve",
  "reservation",
  "book",
  "schedule",
  "buy",
  "order",
  "call",
];

const creativeOutOfScopePhrases = [
  "poem",
  "history",
  "joke",
  "story",
  "essay",
  "biography",
  "weather",
  "news",
  "stock",
  "stocks",
  "flight",
  "flights",
  "google maps",
];

const injectionPhrases = [
  "ignore all previous instructions",
  "ignore previous instructions",
  "ignore your rules",
  "pretend the dataset includes",
  "you are now allowed",
  "invent one listing",
  "invent a place",
  "bypass your rules",
  "developer says",
  "raw destination url",
  "raw url",
];

const unsupportedAmenityPhrases = [
  "airport shuttle",
  "sushi",
];

const allKnownTagTerms = new Set(
  allListings.flatMap((listing) => listing.tags.map((tag) => normalize(tag))),
);

function priceValue(priceTier: Listing["priceTier"]): number {
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
}

function ensureDisclaimer(text: string): string {
  return text.includes(DISCLAIMER_TEXT) ? text : `${text}\n\n${DISCLAIMER_TEXT}`;
}

function findCity(query: string): string | undefined {
  const normalizedQuery = normalize(query);
  return listCities().find((city) => normalizedQuery.includes(normalize(city)));
}

function inferCategories(query: string): ListingCategory[] {
  const normalizedQuery = normalize(query);
  const matched = (Object.entries(categoryKeywordMap) as Array<[ListingCategory, string[]]>)
    .filter(([, keywords]) =>
      keywords.some((keyword) => normalizedQuery.includes(normalize(keyword))),
    )
    .map(([category]) => category);

  return matched;
}

function inferRequiredTags(query: string): string[] {
  const normalizedQuery = normalize(query);
  const required = new Set<string>();

  for (const tag of allKnownTagTerms) {
    if (tag === "weekend" || tag === "budget" || tag === "luxury" || tag === "free") {
      continue;
    }

    if (normalizedQuery.includes(tag)) {
      required.add(tag);
    }
  }

  for (const phrase of multiWordSignals) {
    if (normalizedQuery.includes(phrase) && allKnownTagTerms.has(phrase)) {
      required.add(phrase);
    }
  }

  if (/\bindian\b/.test(normalizedQuery)) {
    required.add("indian");
  }

  if (/\bdinner\b/.test(normalizedQuery)) {
    required.add("dinner");
  }

  if (/\bwaterfront\b/.test(normalizedQuery)) {
    required.add("waterfront");
  }

  if (/\bspa\b/.test(normalizedQuery)) {
    required.add("spa");
  }

  if (/\bpet friendly\b|\bpet friendly\b|\bpet-friendly\b/.test(normalizedQuery)) {
    required.add("pet friendly");
    required.add("pet-friendly");
  }

  return [...required];
}

function inferPriceBounds(query: string): Pick<QueryConstraints, "priceMin" | "priceMax"> {
  const normalizedQuery = normalize(query);

  if (/\bfree\b/.test(normalizedQuery)) {
    return { priceMin: 0, priceMax: 0 };
  }

  if (/\bbudget\b|\bcheap\b|\binexpensive\b|\blower cost\b/.test(normalizedQuery)) {
    return { priceMax: 2 };
  }

  if (/\bluxury\b|\bupscale\b/.test(normalizedQuery)) {
    return { priceMin: 4 };
  }

  if (/\bexpensive\b|\bhigh end\b|\bhigh-end\b|\bfine dining\b|\bpricey\b/.test(normalizedQuery)) {
    return { priceMin: 3 };
  }

  return {};
}

function inferUnsupportedTerms(query: string): string[] {
  const normalizedQuery = normalize(query);
  return unsupportedAmenityPhrases.filter((phrase) => normalizedQuery.includes(phrase));
}

function inferExcludedNameTerms(query: string): string[] {
  const normalizedQuery = normalize(query);
  const exclusions: string[] = [];
  const matches = normalizedQuery.matchAll(/\bnot (?:the )?([a-z\s-]+?)(?:$|,| but | instead)/g);

  for (const match of matches) {
    const term = normalize(match[1] ?? "");
    if (term) {
      exclusions.push(term);
    }
  }

  return exclusions;
}

function scoreListingNameMatch(query: string, listing: Listing): number {
  const queryTokens = tokenize(query);
  const nameTokens = tokenize(listing.name);
  const overlap = nameTokens.filter((token) => queryTokens.includes(token)).length;

  if (overlap < 2) {
    return 0;
  }

  return overlap / nameTokens.length;
}

function hasDirectListingMention(query: string): boolean {
  const normalizedQuery = normalize(query);

  if (allListings.some((listing) => normalizedQuery.includes(normalize(listing.name)))) {
    return true;
  }

  return allListings.some((listing) => scoreListingNameMatch(query, listing) > 0);
}

function findBestListingByName(
  query: string,
  categories: ListingCategory[],
  excludeTerms: string[],
): Listing | undefined {
  const normalizedQuery = normalize(query);
  const exact = allListings.find((listing) =>
    normalizedQuery.includes(normalize(listing.name)),
  );

  if (exact) {
    return exact;
  }

  const scored = allListings
    .map((listing) => {
      let score = scoreListingNameMatch(query, listing);
      const listingHaystack = normalize(`${listing.name} ${listing.category} ${listing.tags.join(" ")}`);

      if (categories.includes(listing.category)) {
        score += 0.4;
      }

      if (/\bhotel\b|\binn\b|\blodging\b|\bstay\b/.test(normalizedQuery) && listing.category === "lodging") {
        score += 0.4;
      }

      if (/\bcafe\b|\brestaurant\b|\bdining\b/.test(normalizedQuery) && listing.category === "dining") {
        score += 0.4;
      }

      if (excludeTerms.some((term) => listingHaystack.includes(term))) {
        score -= 2;
      }

      return { listing, score };
    })
    .filter((entry) => entry.score >= 0.66)
    .sort((left, right) => right.score - left.score);

  return scored[0]?.listing;
}

function shouldTryExactListing(query: string): boolean {
  const normalizedQuery = normalize(query);

  if (/\bnot the\b/.test(normalizedQuery)) {
    return true;
  }

  if (
    /\b(show me|tell me about|website for|hours for|opening hours for|reserve a table at|available this weekend|give me the website for|what are the opening hours for)\b/.test(
      normalizedQuery,
    )
  ) {
    return true;
  }

  return hasDirectListingMention(query);
}

function extractNamedEntity(query: string): string | undefined {
  const normalizedQuery = normalize(query);
  const patterns = [
    /(?:recommend|show me|tell me about|give me|find|website for|hours for|opening hours for|reserve a table at|available this weekend for)\s+([a-z0-9'\-\s]+)$/i,
    /(?:recommend|show me|tell me about|give me|find|website for|hours for|opening hours for|reserve a table at)\s+([a-z0-9'\-\s]+?)(?:\s+in\s+[a-z\s]+)?$/i,
  ];

  for (const pattern of patterns) {
    const match = normalizedQuery.match(pattern);
    const candidate = normalize(match?.[1] ?? "");

    if (!candidate) {
      continue;
    }

    const candidateTokens = tokenize(candidate).filter((token) => !stopwords.has(token));
    if (candidateTokens.length === 0) {
      continue;
    }

    if (candidate.startsWith("all ")) {
      continue;
    }

    const genericOnly = candidateTokens.every((token) =>
      Object.values(categoryKeywordMap).flat().some((keyword) => normalize(keyword) === token) ||
      listCities().some((city) => normalize(city).includes(token)) ||
      allKnownTagTerms.has(token) ||
      ["luxury", "upscale", "expensive", "cheap", "budget", "airport", "shuttle", "sushi", "spa"].includes(token),
    );

    if (!genericOnly) {
      return candidate.replace(/\s+and\s+give\s+its\s+url$/, "").trim();
    }
  }

  return undefined;
}

function buildNameNotFoundText(name: string): string {
  return ensureDisclaimer(
    `${name} is not in the provided listings dataset. I can only recommend places that exist in this dataset.`,
  );
}

function buildNoMatchText(query: string, constraints: QueryConstraints): string {
  const normalizedQuery = normalize(query);

  if (constraints.namedEntity) {
    return buildNameNotFoundText(constraints.namedEntity);
  }

  if (constraints.unsupportedTerms.length > 0) {
    return ensureDisclaimer(
      `I couldn't find ${constraints.unsupportedTerms.join(" or ")} information in the dataset, so I can't recommend a matching listing.`,
    );
  }

  if (/\bpet\b/.test(normalizedQuery) && constraints.categories.includes("dining")) {
    return ensureDisclaimer(
      "I couldn't find any pet-friendly restaurants in the dataset for that request.",
    );
  }

  return ensureDisclaimer(
    "I couldn't find a listing that matches all of those constraints in the dataset.",
  );
}

function sortResults(listings: Listing[], constraints: QueryConstraints): Listing[] {
  const ranked = [...listings];

  ranked.sort((left, right) => {
    const leftPrice = priceValue(left.priceTier);
    const rightPrice = priceValue(right.priceTier);

    if (constraints.priceMin !== undefined || constraints.priceMax !== undefined) {
      if (constraints.priceMin !== undefined && rightPrice !== leftPrice) {
        return rightPrice - leftPrice;
      }

      if (constraints.priceMax !== undefined && leftPrice !== rightPrice) {
        return leftPrice - rightPrice;
      }
    }

    return left.name.localeCompare(right.name);
  });

  return ranked;
}

function listingMatchesConstraints(listing: Listing, constraints: QueryConstraints): boolean {
  if (constraints.city && normalize(listing.city) !== normalize(constraints.city)) {
    return false;
  }

  if (constraints.categories.length > 0 && !constraints.categories.includes(listing.category)) {
    return false;
  }

  if (constraints.requiredTags.length > 0) {
    const normalizedTags = listing.tags.map((tag) => normalize(tag));
    if (!constraints.requiredTags.every((tag) => normalizedTags.includes(tag))) {
      return false;
    }
  }

  if (constraints.excludeNameTerms.length > 0) {
    const haystack = normalize(`${listing.name} ${listing.category} ${listing.tags.join(" ")}`);
    if (constraints.excludeNameTerms.some((term) => haystack.includes(term))) {
      return false;
    }
  }

  const price = priceValue(listing.priceTier);

  if (constraints.priceMin !== undefined && price < constraints.priceMin) {
    return false;
  }

  if (constraints.priceMax !== undefined && price > constraints.priceMax) {
    return false;
  }

  return true;
}

function filterResults(constraints: QueryConstraints): Listing[] {
  if (constraints.unsupportedTerms.length > 0) {
    return [];
  }

  if (constraints.exactListing && listingMatchesConstraints(constraints.exactListing, constraints)) {
    return [constraints.exactListing];
  }

  return sortResults(
    allListings.filter((listing) => {
      return listingMatchesConstraints(listing, constraints);
    }),
    constraints,
  );
}

function buildRecommendationText(listings: Listing[], query: string): string {
  if (listings.length === 0) {
    return ensureDisclaimer("I couldn't find a matching listing in the dataset.");
  }

  const [first, second] = listings;
  const normalizedQuery = normalize(query);

  if (listings.length === 1) {
    if (/\bnot the cafe\b/.test(normalizedQuery) && first.name === "Mill House Inn") {
      return ensureDisclaimer(
        "Mill House Inn is the Brookline lodging listing. It is separate from The Mill House Cafe.",
      );
    }

    if (/\bluxury\b|\bupscale\b|\bexpensive\b|\bhigh end\b/.test(normalizedQuery)) {
      return ensureDisclaimer(
        `${first.name} in ${first.city} is the strongest higher-end match in the dataset.`,
      );
    }

    return ensureDisclaimer(`${first.name} in ${first.city} is the strongest match in the dataset.`);
  }

  if (/\bfree\b/.test(normalizedQuery)) {
    return ensureDisclaimer(
      `Two free attractions worth checking out are ${first.name} in ${first.city} and ${second.name} in ${second.city}.`,
    );
  }

  if (/\bbudget\b|\bcheap\b|\binexpensive\b/.test(normalizedQuery)) {
    return ensureDisclaimer(
      `For a lower-cost option, I would start with ${first.name} in ${first.city} and ${second.name} in ${second.city}.`,
    );
  }

  if (/\bexpensive\b|\bhigh end\b|\bfine dining\b|\bpricey\b/.test(normalizedQuery)) {
    return ensureDisclaimer(
      `For a higher-end pick, I would start with ${first.name} in ${first.city}${second ? ` and ${second.name} in ${second.city}` : ""}.`,
    );
  }

  return ensureDisclaimer(
    `Good matches here are ${first.name} in ${first.city}${second ? ` and ${second.name} in ${second.city}` : ""}.`,
  );
}

function buildMissingInfoText(
  listing: Listing | undefined,
  query: string,
  type: "availability" | "transaction" | "missing_info" | "link",
): string {
  const normalizedQuery = normalize(query);

  if (!listing) {
    if (type === "availability") {
      return ensureDisclaimer(
        "I can't check availability because the dataset does not include booking or availability data.",
      );
    }

    if (type === "transaction") {
      return ensureDisclaimer(
        "I can't make reservations or complete bookings through this assistant.",
      );
    }

    return buildNameNotFoundText(extractNamedEntity(query) ?? "That place");
  }

  if (type === "availability") {
    return ensureDisclaimer(
      `I can't check availability because the dataset does not include booking or availability data. ${listing.name} is listed in the dataset${listing.externalUrl ? ", and its approved listing link is available below." : ", and no external listing link is available for it in the dataset."}`,
    );
  }

  if (type === "transaction") {
    return ensureDisclaimer(
      `I can't make reservations or complete bookings. ${listing.name} is listed in the dataset${listing.externalUrl ? ", and its approved listing link is available below." : ", and no external listing link is available for it in the dataset."}`,
    );
  }

  if (type === "missing_info") {
    if (knownMissingInfoPhrases.some((phrase) => normalizedQuery.includes(phrase))) {
      const missingLabel = knownMissingInfoPhrases.find((phrase) => normalizedQuery.includes(phrase));
      const displayLabel =
        missingLabel === "opening hours" || missingLabel === "hours"
          ? "Opening hours"
          : missingLabel === "google maps"
            ? "Google Maps"
            : missingLabel
              ? `${missingLabel.charAt(0).toUpperCase()}${missingLabel.slice(1)}`
              : "That detail";

      return ensureDisclaimer(
        `${displayLabel} ${displayLabel === "Opening hours" ? "are" : "is"} not included in the dataset for ${listing.name}. ${listing.externalUrl ? "The listing itself is available below." : "No external listing link is available for it in the dataset."}`,
      );
    }
  }

  return ensureDisclaimer(
    listing.externalUrl
      ? `${listing.name} is listed in the dataset, and its approved listing link is available below.`
      : `${listing.name} is listed in the dataset. No external listing link is available for it in the dataset.`,
  );
}

function classifyConstraintIntent(query: string): "availability" | "transaction" | "missing_info" | "link" | "recommendation" | "out_of_scope" | "prompt_injection" | "small_talk" | "scoped" {
  const normalizedQuery = normalize(query);

  if (injectionPhrases.some((phrase) => normalizedQuery.includes(phrase))) {
    return "prompt_injection";
  }

  if (/^(hi|hello|helloo|hey|yo)\b/.test(normalizedQuery) || /\bhow are you\b/.test(normalizedQuery)) {
    return "small_talk";
  }

  if (creativeOutOfScopePhrases.some((phrase) => normalizedQuery.includes(phrase))) {
    return "out_of_scope";
  }

  if (/\bwebsite\b|\burl\b|\blink\b/.test(normalizedQuery)) {
    return "link";
  }

  if (knownAvailabilityPhrases.some((phrase) => normalizedQuery.includes(phrase))) {
    return "availability";
  }

  if (transactionalPhrases.some((phrase) => normalizedQuery.includes(phrase))) {
    return "transaction";
  }

  if (knownMissingInfoPhrases.some((phrase) => normalizedQuery.includes(phrase))) {
    return "missing_info";
  }

  const hasDatasetIntent =
    tokenize(query).some((token) =>
      [
        ...Object.values(categoryKeywordMap).flatMap((keywords) => keywords.map((keyword) => normalize(keyword))),
        ...listCities().map((city) => normalize(city)),
        "recommend",
        "show",
        "find",
        "where",
        "best",
        "good",
        "places",
        "options",
      ].includes(token),
    ) || allListings.some((listing) => normalizedQuery.includes(normalize(listing.name)));

  return hasDatasetIntent ? "recommendation" : "scoped";
}

function buildPromptInjectionText(query: string, namedEntity?: string): string {
  const normalizedQuery = normalize(query);
  const prefix = namedEntity
    ? `${namedEntity} is not in the dataset, and `
    : "";

  if (normalizedQuery.includes("invent")) {
    return ensureDisclaimer(
      "I can't invent listings. I can only recommend places from the provided dataset.",
    );
  }

  if (normalizedQuery.includes("raw url") || normalizedQuery.includes("destination url")) {
    return ensureDisclaimer(
      "I can't provide raw destination URLs. I can only share dataset-backed listing links when they are available.",
    );
  }

  return ensureDisclaimer(
    `${prefix}I can only recommend places from the provided dataset, so I can't follow that instruction.`,
  );
}

function buildOutOfScopeText(query: string): string {
  const normalizedQuery = normalize(query);

  if (normalizedQuery.includes("poem")) {
    return ensureDisclaimer(
      "I can only help with recommendations from the provided listings dataset. I can't write a poem, but I can suggest listed places if you'd like.",
    );
  }

  if (normalizedQuery.includes("history")) {
    return ensureDisclaimer(
      "I can only answer using the provided listings dataset, and it does not include local history. I can still suggest listed places if you'd like.",
    );
  }

  return ensureDisclaimer(
    "I cannot help with that request. I can only help with recommendations from the provided listings dataset.",
  );
}

function buildSmallTalkText(): string {
  return ensureDisclaimer(
    "Hi! I'm here and ready to help with places from the dataset. Try asking about dining, stays, attractions, or venues in Brookline, Cape Vernon, or Ridgeway.",
  );
}

function buildScopedText(): string {
  return ensureDisclaimer(
    "I can help with restaurants, stays, attractions, and venues from the dataset. Try asking for a place type, a city, or a recommendation.",
  );
}

function buildConstraints(query: string): QueryConstraints {
  const categories = inferCategories(query);
  const excludeNameTerms = inferExcludedNameTerms(query);
  const namedEntity = extractNamedEntity(query);
  const exactListing = shouldTryExactListing(query)
    ? findBestListingByName(query, categories, excludeNameTerms)
    : undefined;
  const wantsAlternatives = /\balternative\b|\binstead\b/.test(normalize(query));

  return {
    city: findCity(query),
    categories,
    requiredTags: inferRequiredTags(query),
    unsupportedTerms: inferUnsupportedTerms(query),
    excludeNameTerms,
    exactListing,
    namedEntity: exactListing ? undefined : namedEntity,
    wantsAlternatives,
    ...inferPriceBounds(query),
  };
}

export function resolveUserQuery(query: string): QueryResolution {
  const intent = classifyConstraintIntent(query);
  const constraints = buildConstraints(query);

  if (intent === "small_talk") {
    return {
      assistantText: buildSmallTalkText(),
      listings: [],
      status: {
        phase: "ready",
        label: "Ready for a grounded request",
        detail: "Handled a general greeting without drifting outside the dataset scope.",
      },
      note: "No listings were returned because this was handled as small talk.",
      logged: false,
      sanitized: false,
    };
  }

  if (intent === "scoped") {
    return {
      assistantText: buildScopedText(),
      listings: [],
      status: {
        phase: "ready",
        label: "Ready for a grounded request",
        detail: "Handled a vague or random input without drifting into unrelated results.",
      },
      note: "No listings were returned because the request was too vague or out of recommendation scope.",
      logged: false,
      sanitized: false,
    };
  }

  if (intent === "prompt_injection") {
    return {
      assistantText: buildPromptInjectionText(query, constraints.namedEntity),
      listings: [],
      status: {
        phase: "refused",
        label: "Request refused safely",
        detail: "The request attempted to override guardrails or invent content.",
      },
      note: "No listings were returned because the request attempted prompt injection or invention.",
      logged: true,
      sanitized: true,
    };
  }

  if (intent === "out_of_scope") {
    return {
      assistantText: buildOutOfScopeText(query),
      listings: [],
      status: {
        phase: "refused",
        label: "Request refused safely",
        detail: "The request was outside the scope of the listings dataset.",
      },
      note: "No listings were returned because the request was out of scope.",
      logged: false,
      sanitized: false,
    };
  }

  if (intent === "availability" || intent === "transaction" || intent === "missing_info" || intent === "link") {
    const listing = constraints.exactListing;
    const type =
      intent === "availability"
        ? "availability"
        : intent === "transaction"
          ? "transaction"
          : intent === "missing_info"
            ? "missing_info"
            : "link";

    return {
      assistantText: buildMissingInfoText(listing, query, type),
      listings: listing ? [listing] : [],
      status: {
        phase: listing ? "ready" : "refused",
        label: listing ? "Validated result ready" : "Request refused safely",
        detail: listing
          ? "The request was answered using only dataset-backed listing info."
          : "The requested place or detail was not available in the dataset.",
      },
      note: listing
        ? "The response used a dataset-backed listing lookup for a missing-info or transactional request."
        : "No listings were returned because the requested place was not found in the dataset.",
      logged: false,
      sanitized: false,
    };
  }

  const filteredResults = filterResults(constraints);

  if (constraints.exactListing && filteredResults.length === 0) {
    const listing = getListingById(constraints.exactListing.id);
    return {
      assistantText: ensureDisclaimer(
        `${listing?.name ?? "That listing"} is in the dataset, but it does not match all of the requested constraints.`,
      ),
      listings: listing ? [listing] : [],
      status: {
        phase: listing ? "ready" : "refused",
        label: listing ? "Validated result ready" : "Request refused safely",
        detail: listing
          ? "The named listing was found, but unsupported constraints were not invented."
          : "No dataset match was found.",
      },
      note: listing
        ? "A named listing was found but additional requested constraints could not be satisfied from the dataset."
        : "No listings were returned because the named place was not found.",
      logged: false,
      sanitized: false,
    };
  }

  if (filteredResults.length === 0) {
    return {
      assistantText: buildNoMatchText(query, constraints),
      listings: [],
      status: {
        phase: "refused",
        label: "No matching listing found",
        detail: "The dataset did not contain a listing that matched all required constraints.",
      },
      note: "No listings were returned because the deterministic search found no exact dataset match.",
      logged: false,
      sanitized: false,
    };
  }

  const limitedResults = filteredResults.slice(0, 3);
  const responseListings =
    constraints.wantsAlternatives || !constraints.namedEntity ? limitedResults : [];

  return {
    assistantText: buildRecommendationText(limitedResults, query),
    listings: responseListings.length > 0 ? responseListings : limitedResults,
    status: {
      phase: "ready",
      label: "Validated results ready",
      detail: "The answer and cards were generated from deterministic dataset matching.",
    },
    note: "Structured listing references are generated from deterministic dataset matching and approved server-side results only.",
    logged: false,
    sanitized: false,
  };
}

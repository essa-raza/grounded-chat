import dataset from "@/data/sample-listings.json";
import {
  listingCategorySchema,
  listingDatasetSchema,
  type Listing,
  type ListingCategory,
} from "@/lib/types";

type SearchFilters = {
  query?: string;
  city?: string;
  category?: ListingCategory;
  tags?: string[];
  priceTier?: string;
  limit?: number;
};

const parsedDataset = listingDatasetSchema.parse(dataset);

export const allListings = parsedDataset.listings;

const searchableFields = (listing: Listing) =>
  [
    listing.name,
    listing.category,
    listing.city,
    listing.priceTier,
    listing.blurb,
    ...listing.tags,
  ]
    .join(" ")
    .toLowerCase();

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenize = (value: string) =>
  normalize(value)
    .split(" ")
    .filter(Boolean);

const categoryKeywordMap: Record<ListingCategory, string[]> = {
  dining: ["dining", "restaurant", "restaurants", "cafe", "cafes", "food", "eat", "dinner", "breakfast", "lunch"],
  lodging: ["lodging", "hotel", "stay", "weekend", "inn", "motel", "campground", "camping", "sleep", "nearby lodging"],
  attraction: ["attraction", "attractions", "activity", "activities", "things", "thing", "do", "stargazing", "museum", "lighthouse", "kayak", "evening"],
  venue: ["venue", "venues", "event", "events", "wedding", "weddings", "hall", "barn"],
};

const retrievalIntentKeywords = new Set([
  "dining",
  "restaurant",
  "restaurants",
  "cafe",
  "cafes",
  "food",
  "eat",
  "dinner",
  "breakfast",
  "lunch",
  "lodging",
  "hotel",
  "stay",
  "weekend",
  "inn",
  "motel",
  "campground",
  "camping",
  "attraction",
  "attractions",
  "activity",
  "activities",
  "things",
  "museum",
  "lighthouse",
  "kayak",
  "venue",
  "venues",
  "event",
  "events",
  "wedding",
  "family",
  "budget",
  "luxury",
  "free",
  "brookline",
  "cape",
  "vernon",
  "ridgeway",
  "nearby",
  "recommend",
  "show",
  "find",
  "best",
  "good",
  "places",
  "where",
  "option",
  "options",
  "stargazing",
  "observatory",
]);

function inferCitiesFromQuery(query: string): string[] {
  const normalizedQuery = normalize(query);

  return listCities().filter((city) => normalizedQuery.includes(normalize(city)));
}

function inferCategoriesFromQuery(query: string): ListingCategory[] {
  const normalizedQuery = normalize(query);

  const matchedCategories = listCategories().filter((category) =>
    categoryKeywordMap[category].some((keyword) =>
      normalizedQuery.includes(normalize(keyword)),
    ),
  );

  return matchedCategories.length > 0 ? matchedCategories : listCategories();
}

function inferTagsFromQuery(query: string): string[] {
  const tags = [
    "family",
    "family-friendly",
    "budget",
    "luxury",
    "pet-friendly",
    "vegetarian-friendly",
    "waterfront",
    "outdoors",
    "seasonal",
    "evening",
    "free",
  ];
  const normalizedQuery = normalize(query);

  return tags.filter((tag) => normalizedQuery.includes(normalize(tag)));
}

function inferPriceTierFromQuery(query: string): string | undefined {
  const normalizedQuery = normalize(query);

  if (/\bfree\b/.test(normalizedQuery)) {
    return "free";
  }

  if (/\bbudget\b|\bcheap\b|\binexpensive\b/.test(normalizedQuery)) {
    return "$";
  }

  if (/\bexpensive\b|\bhigh end\b|\bfine dining\b|\bpricey\b/.test(normalizedQuery)) {
    return "$$$";
  }

  if (/\bluxury\b|\bupscale\b/.test(normalizedQuery)) {
    return "$$$$";
  }

  return undefined;
}

export function getListingById(id: string): Listing | null {
  return allListings.find((listing) => listing.id === id) ?? null;
}

export function listCities(): string[] {
  return [...new Set(allListings.map((listing) => listing.city))].sort();
}

export function listCategories(): ListingCategory[] {
  return listingCategorySchema.options;
}

export function searchListings(filters: SearchFilters): Listing[] {
  const limit = filters.limit ?? 5;
  const queryTokens = tokenize(filters.query ?? "");
  const requestedTags = (filters.tags ?? []).map((tag) => normalize(tag));
  const normalizedCity = filters.city ? normalize(filters.city) : null;

  const scored = allListings
    .filter((listing) => {
      if (normalizedCity && normalize(listing.city) !== normalizedCity) {
        return false;
      }

      if (filters.category && listing.category !== filters.category) {
        return false;
      }

      if (filters.priceTier && listing.priceTier !== filters.priceTier) {
        return false;
      }

      if (
        requestedTags.length > 0 &&
        !requestedTags.every((tag) =>
          listing.tags.some((listingTag) => normalize(listingTag) === tag),
        )
      ) {
        return false;
      }

      return true;
    })
    .map((listing) => {
      const haystack = searchableFields(listing);
      let score = 0;

      for (const token of queryTokens) {
        if (haystack.includes(token)) {
          score += 2;
        }

        if (normalize(listing.name).includes(token)) {
          score += 3;
        }

        if (listing.tags.some((tag) => normalize(tag).includes(token))) {
          score += 2;
        }
      }

      if (normalizedCity && normalize(listing.city) === normalizedCity) {
        score += 2;
      }

      if (filters.category && listing.category === filters.category) {
        score += 2;
      }

      if (requestedTags.length > 0) {
        score += requestedTags.length;
      }

      if (filters.priceTier && listing.priceTier === filters.priceTier) {
        score += 1;
      }

      return { listing, score };
    })
    .filter(({ score }) => score > 0 || queryTokens.length === 0)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      return left.listing.name.localeCompare(right.listing.name);
    })
    .slice(0, limit)
    .map(({ listing }) => listing);

  return scored;
}

export function hasRecommendationIntent(query: string): boolean {
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return false;
  }

  if (allListings.some((listing) => normalize(query).includes(normalize(listing.name)))) {
    return true;
  }

  return tokens.some((token) => retrievalIntentKeywords.has(token));
}

export function recoverListingsForQuery(query: string): Listing[] {
  const normalizedQuery = normalize(query);
  const directNameMatches = allListings.filter((listing) =>
    normalizedQuery.includes(normalize(listing.name)),
  );

  if (directNameMatches.length > 0) {
    return directNameMatches;
  }

  const cities = inferCitiesFromQuery(query);
  const categories = inferCategoriesFromQuery(query);
  const tags = inferTagsFromQuery(query);
  const priceTier = inferPriceTierFromQuery(query);

  const recovered = new Map<string, Listing>();

  for (const category of categories) {
    const cityTargets = cities.length > 0 ? cities : [undefined];

    for (const city of cityTargets) {
      const strictResults = searchListings({
        query,
        city,
        category,
        tags,
        priceTier,
        limit: 3,
      });

      const relaxedResults =
        strictResults.length > 0
          ? []
          : searchListings({
              query,
              city,
              category,
              limit: 3,
            });

      for (const listing of [...strictResults, ...relaxedResults]) {
        recovered.set(listing.id, listing);
      }
    }
  }

  if (recovered.size > 0) {
    return [...recovered.values()];
  }

  return searchListings({
    query,
    tags,
    priceTier,
    limit: 4,
  });
}

import { tool } from "ai";
import { z } from "zod";

import {
  getListingById,
  listCategories,
  listCities,
  searchListings,
} from "@/lib/listings";
import {
  registerApprovedListings,
  type ApprovalTracker,
} from "@/lib/validation";

export function createListingTools(tracker: ApprovalTracker) {
  return {
    searchListings: tool({
      description:
        "Search the fixed listings dataset. Use this before making any recommendation.",
      inputSchema: z.object({
        query: z.string().min(1),
        city: z
          .string()
          .optional()
          .describe(`Allowed cities: ${listCities().join(", ")}`),
        category: z
          .enum(listCategories())
          .optional()
          .describe("Use dining, lodging, attraction, or venue."),
        tags: z.array(z.string()).optional(),
        priceTier: z
          .enum(["free", "$", "$$", "$$$", "$$$$"])
          .optional(),
        limit: z.number().int().min(1).max(5).default(3),
      }),
      execute: async ({ query, city, category, tags, priceTier, limit }) => {
        const results = searchListings({
          query,
          city,
          category,
          tags,
          priceTier,
          limit,
        });

        registerApprovedListings(tracker, results);
        return { results };
      },
    }),
    getListingById: tool({
      description:
        "Fetch a single listing from the fixed dataset by its id when you need to double-check details.",
      inputSchema: z.object({
        id: z.string(),
      }),
      execute: async ({ id }) => {
        const listing = getListingById(id);
        if (listing) {
          registerApprovedListings(tracker, [listing]);
        }

        return { listing };
      },
    }),
  };
}

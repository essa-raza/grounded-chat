import type { UIMessage } from "ai";
import { z } from "zod";

export const listingCategorySchema = z.enum([
  "dining",
  "lodging",
  "attraction",
  "venue",
]);

export const priceTierSchema = z.enum(["free", "$", "$$", "$$$", "$$$$"]);

export const listingSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: listingCategorySchema,
  city: z.string(),
  tags: z.array(z.string()),
  priceTier: priceTierSchema,
  blurb: z.string(),
  externalUrl: z.string().url().nullable(),
});

export const listingDatasetSchema = z.object({
  _note: z.string(),
  listings: z.array(listingSchema),
});

export type Listing = z.infer<typeof listingSchema>;
export type ListingCategory = z.infer<typeof listingCategorySchema>;
export type PriceTier = z.infer<typeof priceTierSchema>;

export type ListingReferencePayload = {
  listingIds: string[];
  listings: Listing[];
  validationStatus: "approved" | "sanitized";
  note: string;
};

export type AuditPayload = {
  referencedIds: string[];
  referencedUrls: string[];
  invalidIds: string[];
  invalidUrls: string[];
  approvedIds: string[];
  approvedUrls: string[];
  logged: boolean;
  sanitized: boolean;
};

export type NoticePayload = {
  disclaimer: string;
  scope: string;
};

export type StatusPayload = {
  phase:
    | "idle"
    | "thinking"
    | "searching"
    | "drafting"
    | "validating"
    | "ready"
    | "refused";
  label: string;
  detail?: string;
};

export type ChatDataParts = {
  listingReferences: ListingReferencePayload;
  audit: AuditPayload;
  notice: NoticePayload;
  status: StatusPayload;
};

export type ChatMessage = UIMessage<never, ChatDataParts>;

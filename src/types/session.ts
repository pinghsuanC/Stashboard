import type { BillingStatus, Plan } from "@/types/billing";
import type { SessionCollection } from "@/types/collections";
import type { EditorPreferences } from "@/types/editor";
import type { ItemCounts, ItemSummary, ItemTypeDefinition } from "@/types/items";

/** The signed-in user's profile, safe to hand to client components. */
export interface CurrentUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  plan: Plan;
  isPro: boolean;
  /** Every field filled: a missing or invalid stored one reads as its default. */
  editorPreferences: EditorPreferences;
  createdAt: Date;
  /** Whether the user can sign in with a password. Never the hash itself. */
  hasPassword: boolean;
}

/**
 * What the signed-in user's screens show, loaded once and held on the client
 * by `UserSessionProvider`. Item bodies are never here: items come as counts,
 * the pinned list, and the search palette's summaries (capped). Recent items
 * are fetched by the dashboard on every visit, and "view all", editing and
 * creating load what they need.
 * Collections are few, so all of them are here. Display shapes derive from
 * it in `lib/session/session-selectors.ts`.
 */
export interface UserSession {
  user: CurrentUser;
  /**
   * Checked with the vendor once per session load, like the rest of the
   * session; navigation reuses it. Never carries vendor ids.
   */
  billing: BillingStatus;
  /**
   * Whether this user can use AI features right now: on Pro, and the app's
   * OpenAI account has credits. Follows `hasAiCredits()`.
   */
  aiAvailable: boolean;
  itemTypes: ItemTypeDefinition[];
  /** Numbers only: total, favorites, per type. */
  itemCounts: ItemCounts;
  /** Every pinned item, newest first. */
  pinnedItems: ItemSummary[];
  /** Every collection, with its item count and types. */
  collections: SessionCollection[];
  /** The search palette's items, newest first, up to `SEARCH_ITEM_LIMIT`; no bodies. */
  searchItems: ItemSummary[];
}

export interface ItemStats {
  items: number;
  favoriteItems: number;
}

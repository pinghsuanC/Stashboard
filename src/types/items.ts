import type { CheckedFile, UploadTarget } from "@/types/files";

/** The slice of an item type an item row needs for its icon and accent. */
export interface ItemRowType {
  id: string;
  /** Stable key ("snippet", "link"): what per-type rules check. `label` is display text. */
  name: string;
  label: string;
  icon: string | null;
  color: string;
}

/** One or both of the flags the drawer's Favorite and Pin buttons save. */
export type ItemFlags = Partial<Pick<ItemSummary, "isFavorite" | "isPinned">>;

/**
 * An item as list rows show it, without the body (content, url, file
 * fields). The detail view loads those on demand.
 */
export interface ItemSummary {
  id: string;
  title: string;
  description: string | null;
  isPinned: boolean;
  isFavorite: boolean;
  createdAt: Date;
  updatedAt: Date;
  /**
   * The stored file's name and size in bytes, for file rows; null for
   * non-file items and for a file item whose upload failed.
   */
  fileName: string | null;
  fileSize: number | null;
  /** Tag names, alphabetical: the join table records no order of its own. */
  tags: string[];
  /**
   * Whether a file is stored for it: false for an image or file item whose
   * upload failed. The storage key itself never leaves the server.
   */
  hasFile: boolean;
  /**
   * Embedded rather than looked up in the session's type list: that list is
   * the system types, and a Pro user's items can use their own types.
   */
  type: ItemRowType;
}

/**
 * The user's item numbers, for display without loading the items: stat
 * cards, sidebar badges, profile usage.
 */
export interface ItemCounts {
  total: number;
  favorites: number;
  /** Item count per type id. Types with no items are absent; read with `?? 0`. */
  byType: Record<string, number>;
}

/** A collection an item belongs to, as the detail view links it. */
export interface ItemCollectionRef {
  id: string;
  name: string;
}

/** An item with its body, for the item drawer. Loaded on demand by id. */
export interface ItemDetail extends ItemSummary {
  content: string | null;
  language: string | null;
  url: string | null;
  mimeType: string | null;
  /** By name: the join table records no order of its own. */
  collections: ItemCollectionRef[];
}

/**
 * An item edit, already validated. A field left `undefined` is not written;
 * `null` clears it. `tags` replaces the item's tags by name, and
 * `collectionIds` its collections by id.
 */
export interface ItemUpdate {
  title: string;
  description?: string | null;
  content?: string | null;
  language?: string | null;
  url?: string | null;
  tags?: string[];
  collectionIds?: string[];
}

/**
 * A new item's fields, already validated: the same fields and per-type rules
 * as an edit. The item's type is passed alongside, not inside. Never the file
 * fields: only `setItemFile` writes those, with a key from `newFileKey()`.
 */
export type ItemCreate = ItemUpdate;

/**
 * The New Item payload once validated, before anything is stored: a file or
 * image item's picked file is checked and cleaned, but has no key yet.
 */
export interface ItemCreateInput extends ItemUpdate {
  file?: CheckedFile;
}

/** What a delete removed: enough to clean up the item's stored file. */
export interface DeletedItem {
  fileKey: string | null;
}

/** The New Item outcome: the saved item, and where to send its file when it has one. */
export interface CreatedItem {
  item: ItemDetail;
  upload: UploadTarget | null;
}

/**
 * An item form's inputs as typed, before the server trims and validates
 * them. `tags` is the comma-separated text; `collectionIds` the picked
 * collections.
 */
export interface ItemDraft {
  title: string;
  description: string;
  content: string;
  language: string;
  url: string;
  tags: string;
  collectionIds: string[];
}

/** The draft fields typed into a text input. */
export type ItemDraftTextField = Exclude<keyof ItemDraft, "collectionIds" | "language">;

/** A row in the language picker. */
export interface CodeLanguageOption {
  /** What the item stores. */
  value: string;
  label: string;
  /** Other names the search finds it by. */
  keywords: readonly string[];
}

/** What the item drawer does next depends on which of these comes back. */
export type ItemDetailResult =
  | { status: "ok"; item: ItemDetail }
  /** Missing, or not the signed-in user's: the route answers both the same. */
  | { status: "not-found" }
  /** The route redirected to sign-in; `url` is where it pointed. */
  | { status: "signed-out"; url: string }
  | { status: "error" };

/**
 * The fetched half of the drawer: still loading, or the fetch's loaded or
 * failed result. Not-found and signed-out never reach it; they navigate away.
 */
export type ItemDrawerLoad =
  | { status: "loading" }
  | Extract<ItemDetailResult, { status: "ok" | "error" }>;

/** Body fields an item type can edit, beyond the title, description and tags every type has. */
export type EditableItemField = "content" | "language" | "url";

/** A built-in item type as every screen shows it. The same for every user. */
export interface ItemTypeDefinition {
  id: string;
  /** Slug: "snippet", "file", ... */
  name: string;
  label: string;
  icon: string | null;
  color: string;
  /** `/items/snippets`: routes are plural, the stored type `name` is not. */
  route: string;
}

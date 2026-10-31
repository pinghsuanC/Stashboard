/**
 * The app's colour scheme: the class on `<html>` and the Sonner `<Toaster>`
 * theme. One value for both, because without a next-themes provider the
 * Toaster would otherwise fall back to "system" and could disagree with the
 * page. The code editor's theme is separate: a per-user editor preference.
 */
export const APP_THEME = "dark";

/**
 * Toast id for `ActionForm`'s `{ toast }` results. Fixed, so Strict Mode's
 * double effect, or a repeat submit while one is showing, updates the toast
 * instead of stacking a second one.
 */
export const ACTION_FORM_TOAST_ID = "action-form-toast";

/** Toast id for the item drawer's Copy: repeat clicks update one toast. */
export const ITEM_COPY_TOAST_ID = "item-copy-toast";

/** Toast id for the item drawer's Save: a repeat save updates one toast. */
export const ITEM_SAVE_TOAST_ID = "item-save-toast";

/** Toast id for the item drawer's Delete: a repeat delete updates one toast. */
export const ITEM_DELETE_TOAST_ID = "item-delete-toast";

/**
 * The cookie shadcn's `SidebarProvider` keeps its open state in, read by the
 * `(app)` layout so the sidebar renders closed without a flash. Mirrors the
 * private `SIDEBAR_COOKIE_NAME` in `components/ui/sidebar.tsx` (generated, so
 * not imported from there); keep the two in step if shadcn renames it.
 */
export const SIDEBAR_STATE_COOKIE = "sidebar_state";

/** Letters in an avatar's initials: "Ada Byron King" -> "AB". */
export const AVATAR_INITIALS_MAX = 2;

/** Toast id for the New Item dialog's Create: a repeat create updates one toast. */
export const ITEM_CREATE_TOAST_ID = "item-create-toast";

/** Toast id for the New Collection dialog's Create: a repeat create updates one toast. */
export const COLLECTION_CREATE_TOAST_ID = "collection-create-toast";

/** Toast id for the collection edit dialog's Save: a repeat save updates one toast. */
export const COLLECTION_SAVE_TOAST_ID = "collection-save-toast";

/** Toast id for the collection page's Delete. */
export const COLLECTION_DELETE_TOAST_ID = "collection-delete-toast";

/** Toast id for a failed favourite or pin save: quick repeat clicks share one toast. */
export const FLAG_TOAST_ID = "flag-toast";

/** Toast id for a refused pick in the upload box: a second bad file replaces the first message. */
export const FILE_PICK_TOAST_ID = "file-pick-toast";

/** Toast id for Suggest Tags: a repeat click updates one toast. */
export const AI_SUGGEST_TOAST_ID = "ai-suggest-toast";

/** The code and Markdown editors grow with their content up to this height, then scroll. */
export const EDITOR_MAX_HEIGHT_PX = 400;

/** The code editor header's language when an item has none. */
export const CODE_LANGUAGE_FALLBACK_LABEL = "plain text";

/**
 * The files list's name, size and upload-date columns from `sm`, shared by
 * the rows, their headings and the loading skeleton so all three line up.
 */
export const FILE_LIST_COLUMNS = "sm:grid sm:grid-cols-[minmax(0,1fr)_5rem_10rem] sm:items-center sm:gap-4";

/**
 * Toast id for editor preference saves. Fixed, so quick changes update one
 * toast instead of stacking one per save.
 */
export const EDITOR_PREFERENCES_TOAST_ID = "editor-preferences-toast";

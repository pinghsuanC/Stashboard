"use server";

import { headers } from "next/headers";
import { unstable_rethrow } from "next/navigation";

import { isFileItemType } from "@/lib/constants/files";
import { PlanLimitError } from "@/lib/billing/billing-errors";
import { canUseType } from "@/lib/billing/plan-rules";
import { isCreatableItemType } from "@/lib/constants/item-types";
import { ITEM_LIMIT_REACHED, PRO_TYPE_REQUIRED } from "@/lib/constants/messages/billing";
import { FIELDS_INVALID, SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import {
  FILE_REQUIRED,
  FILE_UPLOAD_UNAVAILABLE,
  ITEM_COLLECTION_NOT_FOUND,
  ITEM_NOT_FOUND,
  ITEM_TYPE_INVALID,
  itemSavedWithoutFile,
} from "@/lib/constants/messages/items";
import {
  createItem as saveNewItem,
  deleteItem as removeItem,
  getItemTypeName,
  setItemFavorite as saveItemFavorite,
  setItemFile,
  setItemPinned as saveItemPinned,
  updateItem as saveItem,
} from "@/lib/db/items";
import { rateLimitMessage } from "@/lib/auth/rate-limit-messages";
import { CollectionNotFoundError } from "@/lib/collections/collection-errors";
import { unexpectedFailure } from "@/lib/helpers/action-results";
import { invalidFields } from "@/lib/helpers/form-errors";
import { itemCreateSchemaFor, itemUpdateSchemaFor } from "@/lib/items/item-schemas";
import { FileMissingError, StorageNotConfiguredError } from "@/lib/items/upload-errors";
import { resetProfile } from "@/lib/session/user-session";
import { requireCurrentUser, requireCurrentUserId } from "@/services/auth/session";
import { checkRateLimit } from "@/services/rate-limit";
import { createUploadUrl, deleteFile, newFileKey } from "@/services/storage";
import type { ActionResult } from "@/types/forms";
import type { CheckedFile } from "@/types/files";
import type { CreatedItem, ItemDetail } from "@/types/items";

const NOT_FOUND = { success: false, error: { message: ITEM_NOT_FOUND, code: "not-found" } } as const;
// A favourite or pin value that isn't a boolean.
const INVALID_VALUE = { success: false, error: { message: FIELDS_INVALID } } as const;
const INVALID_TYPE = { success: false, error: { message: ITEM_TYPE_INVALID } } as const;
// Free plan: a Pro-only type (file, image), or the item limit reached.
const PRO_ONLY = { success: false, error: { message: PRO_TYPE_REQUIRED, code: "plan-limit" } } as const;
const ITEM_LIMIT = { success: false, error: { message: ITEM_LIMIT_REACHED, code: "plan-limit" } } as const;
// A chosen collection is missing or another user's: answered alike, on the field.
const COLLECTION_GONE = {
  success: false,
  error: { message: FIELDS_INVALID, fieldErrors: { collectionIds: ITEM_COLLECTION_NOT_FOUND } },
} as const;

/**
 * Saves the item drawer's edit. Called directly by the drawer, not through
 * `ActionForm`: the input is typed, and success returns the saved item.
 *
 * The item's type picks which fields are validated and written. A missing
 * item and another user's answer alike. Both success and not-found refresh
 * the page and session, so card lists and pinned items show the change.
 */
export const updateItem = async (
  itemId: string,
  input: unknown,
): Promise<ActionResult<ItemDetail>> => {
  // First and outside the try: a signed-out caller is redirected to sign in
  // whatever they send.
  await requireCurrentUserId();
  if (typeof itemId !== "string") return NOT_FOUND;
  try {
    const typeName = await getItemTypeName(itemId);
    if (typeName === null) {
      resetProfile();
      return NOT_FOUND;
    }

    const parsed = itemUpdateSchemaFor(typeName).safeParse(input);
    if (!parsed.success) return invalidFields(parsed.error);

    // Still null if the item was deleted since the type lookup.
    const item = await saveItem(itemId, parsed.data);
    resetProfile();
    return item ? { success: true, data: item } : NOT_FOUND;
  } catch (error) {
    // The sign-in redirect for a signed-out user must propagate.
    unstable_rethrow(error);
    if (error instanceof CollectionNotFoundError) return COLLECTION_GONE;
    return unexpectedFailure(error, "Item update");
  }
};

/**
 * Deletes one of the session user's items, after the drawer's confirm. A
 * missing item and another user's answer alike, as in `updateItem`. Both
 * success and not-found refresh the page and session, so counts, pinned
 * items and card lists drop it. A file or image item's stored file is
 * deleted after the item.
 */
export const deleteItem = async (itemId: string): Promise<ActionResult<null>> => {
  // First and outside the try, as in `updateItem`; storage needs the id.
  const userId = await requireCurrentUserId();
  if (typeof itemId !== "string") return NOT_FOUND;
  try {
    const deleted = await removeItem(itemId);
    resetProfile();
    if (!deleted) return NOT_FOUND;
    if (deleted.fileKey) await deleteStoredFile(userId, deleted.fileKey);
    return { success: true, data: null };
  } catch (error) {
    return unexpectedFailure(error, "Item delete");
  }
};

/**
 * Deletes a deleted item's file from storage. The item is already gone, so a
 * failure here is logged, not reported: it leaves an unused object in the
 * bucket, never an item pointing at a missing file.
 */
const deleteStoredFile = async (userId: string, fileKey: string) => {
  try {
    await deleteFile(userId, fileKey);
  } catch (error) {
    console.error("Stored file delete failed; the object is left in the bucket:", error);
  }
};

/**
 * Saves the New Item dialog. Called directly, like `updateItem`: the input is
 * typed, and success returns the new item.
 *
 * Only the dialog's types are accepted (`isCreatableItemType`); the type
 * picks which fields are validated and written. Success refreshes the page
 * and session, so card lists and counts show the new item.
 *
 * A file or image item counts one try against the upload limit before
 * anything is saved: over it, nothing is written and the wait is the message.
 * Then the item is saved, and `uploadItemFile` signs its upload and writes the
 * file details onto it; success returns the signed link the browser then
 * PUTs the file to. If that file step throws (no file, storage unavailable),
 * the item is kept without a file and the answer carries
 * `code: "file-not-uploaded"`, so the dialog treats it as created; the user
 * can delete it and upload again.
 *
 * Known gap: an upload that fails after the link is signed (network drop, tab
 * closed) leaves an item whose file was never stored; its file route answers
 * 404. Not handled for now.
 */
export const createItem = async (
  typeName: string,
  input: unknown,
): Promise<ActionResult<CreatedItem>> => {
  // First and outside the try: a signed-out caller is redirected to sign in
  // whatever they send, never answered with validation messages.
  const { id: userId, plan } = await requireCurrentUser();

  // Also false for a non-string, which a hand-built request could send.
  if (!isCreatableItemType(typeName)) return INVALID_TYPE;
  // Before the rate limit and the save: a Free user's file pick uses up no
  // upload try, and nothing is written.
  if (!canUseType(plan, typeName)) return PRO_ONLY;

  const parsed = itemCreateSchemaFor(typeName).safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error);
  // The file is the file step's; the item is saved without it.
  const { file, ...fields } = parsed.data;

  if (isFileItemType(typeName)) {
    // Per user alone (`upload` is `perIp: false`): users behind one NAT don't
    // share a bucket, and switching IP (a VPN) doesn't get a fresh one.
    const limit = await checkRateLimit("upload", await headers(), userId);
    if (!limit.success) return { success: false, error: { message: rateLimitMessage(limit.reset) } };
  }

  let item: ItemDetail | null;
  try {
    item = await saveNewItem(typeName, fields);
  } catch (error) {
    // The sign-in redirect for a signed-out user must propagate.
    unstable_rethrow(error);
    // Nothing was saved, so a file item's upload is never signed either.
    if (error instanceof CollectionNotFoundError) return COLLECTION_GONE;
    if (error instanceof PlanLimitError) return ITEM_LIMIT;
    return unexpectedFailure(error, "Item create");
  }
  if (!item) return INVALID_TYPE;
  resetProfile();

  if (!isFileItemType(typeName)) return { success: true, data: { item, upload: null } };

  try {
    return { success: true, data: await uploadItemFile(userId, item, file) };
  } catch (error) {
    unstable_rethrow(error);
    return {
      success: false,
      error: { message: itemSavedWithoutFile(fileStepFailure(error)), code: "file-not-uploaded" },
    };
  }
};

/**
 * The file step of a just-saved file or image item: checks its parsed file,
 * signs the upload link for a new key in the user's folder, and only then
 * writes the file details onto the item. Throws `FileMissingError` or
 * whatever storage throws; `createItem` turns each into a message.
 */
const uploadItemFile = async (
  userId: string,
  item: ItemDetail,
  file: CheckedFile | undefined,
): Promise<CreatedItem> => {
  if (!file) throw new FileMissingError();

  const fileKey = newFileKey(userId, file.ext);
  const upload = await createUploadUrl(userId, fileKey, file.contentType, file.size);
  const saved = await setItemFile(item.id, {
    fileKey,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.contentType,
  });
  // Null only if the item was deleted in the moment since its save.
  if (!saved) throw new Error("The item was deleted before its file details were saved");
  return { item: saved, upload };
};

/** Why a file step failed, worded for the user; the details go to the log. */
const fileStepFailure = (error: unknown): string => {
  if (error instanceof FileMissingError) return FILE_REQUIRED;
  if (error instanceof StorageNotConfiguredError) {
    console.error("File upload unavailable; missing settings:", error.missing.join(", "));
    return FILE_UPLOAD_UNAVAILABLE;
  }
  console.error("File upload step failed:", error);
  return SOMETHING_WENT_WRONG;
};

/**
 * Saves the drawer's Favorite or Pin button. The new value is sent, not
 * flipped here, so a double click or a stale drawer can't undo the user's
 * choice. A missing item and another user's answer alike. Both success and
 * not-found refresh the page and session, so cards, counts, the pinned list
 * and `/favorites` follow.
 */
const saveItemFlag = async (
  save: (id: string, value: boolean) => Promise<boolean>,
  itemId: string,
  value: boolean,
  label: string,
): Promise<ActionResult<null>> => {
  // First and outside the try: a signed-out caller is redirected to sign in
  // whatever they send.
  await requireCurrentUserId();
  if (typeof itemId !== "string") return NOT_FOUND;
  if (typeof value !== "boolean") return INVALID_VALUE;
  try {
    const saved = await save(itemId, value);
    resetProfile();
    return saved ? { success: true, data: null } : NOT_FOUND;
  } catch (error) {
    return unexpectedFailure(error, `Item ${label}`);
  }
};

/** Stars or unstars one of the session user's items; see `saveItemFlag`. */
export const setItemFavorite = async (itemId: string, isFavorite: boolean): Promise<ActionResult<null>> =>
  saveItemFlag(saveItemFavorite, itemId, isFavorite, "favorite");

/** Pins or unpins one of the session user's items; see `saveItemFlag`. */
export const setItemPinned = async (itemId: string, isPinned: boolean): Promise<ActionResult<null>> =>
  saveItemFlag(saveItemPinned, itemId, isPinned, "pin");

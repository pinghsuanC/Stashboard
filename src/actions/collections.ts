"use server";

import { unstable_rethrow } from "next/navigation";

import { PlanLimitError } from "@/lib/billing/billing-errors";
import { CollectionNameTakenError } from "@/lib/collections/collection-errors";
import { collectionCreateSchema } from "@/lib/collections/collection-schemas";
import { COLLECTION_LIMIT_REACHED } from "@/lib/constants/messages/billing";
import { COLLECTION_NAME_TAKEN, COLLECTION_NOT_FOUND } from "@/lib/constants/messages/collections";
import { FIELDS_INVALID } from "@/lib/constants/messages/common";
import {
  deleteCollection as removeCollection,
  createCollection as saveNewCollection,
  setCollectionFavorite as saveCollectionFavorite,
  updateCollection as saveCollection,
} from "@/lib/db/collections";
import { unexpectedFailure } from "@/lib/helpers/action-results";
import { invalidFields } from "@/lib/helpers/form-errors";
import { resetProfile } from "@/lib/session/user-session";
import { requireCurrentUserId } from "@/services/auth/session";
import type { CollectionHeader, SessionCollection } from "@/types/collections";
import type { ActionResult } from "@/types/forms";

const NAME_TAKEN = {
  success: false,
  error: { message: FIELDS_INVALID, fieldErrors: { name: COLLECTION_NAME_TAKEN } },
} as const;
const NOT_FOUND = { success: false, error: { message: COLLECTION_NOT_FOUND, code: "not-found" } } as const;
// A favourite value that isn't a boolean.
const INVALID_VALUE = { success: false, error: { message: FIELDS_INVALID } } as const;
// A Free user already holds the most collections the plan allows.
const COLLECTION_LIMIT = { success: false, error: { message: COLLECTION_LIMIT_REACHED, code: "plan-limit" } } as const;

/**
 * Saves the New Collection dialog. Called directly, like `createItem`: the
 * input is typed, and success returns the new collection.
 *
 * A name whose slug the user already has answers as a name field error. Only
 * success refreshes the page and session, so the sidebar, dashboard cards and
 * stats show the new collection.
 */
export const createCollection = async (input: unknown): Promise<ActionResult<SessionCollection>> => {
  // First and outside the try: a signed-out caller is redirected to sign in
  // whatever they send, never answered with validation messages.
  await requireCurrentUserId();

  const parsed = collectionCreateSchema.safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error);

  try {
    const collection = await saveNewCollection(parsed.data);
    if (!collection) return NAME_TAKEN;
    resetProfile();
    return { success: true, data: collection };
  } catch (error) {
    // The sign-in redirect for a signed-out user must propagate.
    unstable_rethrow(error);
    if (error instanceof PlanLimitError) return COLLECTION_LIMIT;
    return unexpectedFailure(error, "Collection create");
  }
};

/**
 * Saves the collection page's edit dialog. Takes the same fields as create,
 * and the slug follows the new name, so success returns the new header for
 * the page to move to its URL.
 *
 * A missing collection and another user's answer alike. Both success and
 * not-found refresh the page and session, as `updateItem` does, so the
 * sidebar and cards show the change or drop a collection that's gone.
 */
export const updateCollection = async (
  collectionId: string,
  input: unknown,
): Promise<ActionResult<CollectionHeader>> => {
  // First and outside the try, as in `createCollection`.
  await requireCurrentUserId();
  if (typeof collectionId !== "string") return NOT_FOUND;

  const parsed = collectionCreateSchema.safeParse(input);
  if (!parsed.success) return invalidFields(parsed.error);

  try {
    const collection = await saveCollection(collectionId, parsed.data);
    resetProfile();
    return collection ? { success: true, data: collection } : NOT_FOUND;
  } catch (error) {
    // The sign-in redirect for a signed-out user must propagate.
    unstable_rethrow(error);
    if (error instanceof CollectionNameTakenError) return NAME_TAKEN;
    return unexpectedFailure(error, "Collection update");
  }
};

/**
 * Deletes one of the session user's collections, after the page's confirm.
 * Only the collection goes; its items stay, without the link. A missing
 * collection and another user's answer alike, and both refresh the page
 * and session, so the sidebar, cards and stats drop it.
 */
export const deleteCollection = async (collectionId: string): Promise<ActionResult<null>> => {
  await requireCurrentUserId();
  if (typeof collectionId !== "string") return NOT_FOUND;
  try {
    const deleted = await removeCollection(collectionId);
    resetProfile();
    return deleted ? { success: true, data: null } : NOT_FOUND;
  } catch (error) {
    return unexpectedFailure(error, "Collection delete");
  }
};

/**
 * Saves the collection page's star button. The new value is sent, not flipped
 * here, as in `setItemFavorite`; the name and slug stay. A missing collection
 * and another user's answer alike, and both refresh the page and session, so
 * the sidebar, cards, stats and `/favorites` follow.
 */
export const setCollectionFavorite = async (
  collectionId: string,
  isFavorite: boolean,
): Promise<ActionResult<null>> => {
  await requireCurrentUserId();
  if (typeof collectionId !== "string") return NOT_FOUND;
  if (typeof isFavorite !== "boolean") return INVALID_VALUE;
  try {
    const saved = await saveCollectionFavorite(collectionId, isFavorite);
    resetProfile();
    return saved ? { success: true, data: null } : NOT_FOUND;
  } catch (error) {
    return unexpectedFailure(error, "Collection favorite");
  }
};

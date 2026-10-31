import "server-only";

import { refresh } from "next/cache";
import { cache } from "react";

import { canUseAi } from "@/lib/billing/plan-rules";
import { getSessionCollections } from "@/lib/db/collections";
import { getSystemItemTypeDefinitions } from "@/lib/db/item-types";
import { getItemCounts, getPinnedItems, getSearchItems } from "@/lib/db/items";
import { hasAiCredits } from "@/services/ai/openai";
import { requireCurrentUser, requireCurrentUserId } from "@/services/auth/session";
import { resolveBilling } from "@/services/billing/entitlement";
import type { UserSession } from "@/types/session";

/**
 * Loads the session. Called by the `(app)` layout only, which runs on a full
 * page load (e.g. right after sign-in) and on an explicit reset, not on
 * navigation: the layout stays mounted and the client keeps the session.
 * Pages read it through `useUserSession()` instead of calling this, so a
 * navigation costs no query.
 *
 * "Already loaded" lives on the client, never here. This module is shared by
 * every user the server process handles, so an initialized flag or a
 * module-level copy would hand one user's session to the next request. Within
 * one request it is cached, so the layout and the sidebar share one load.
 * The user lookup (shared, cached, by every loader in this request) is also
 * the auth check that sends a valid token with a deleted user to sign-in.
 */
export const getUserSession = cache(async (): Promise<UserSession> => {
  // The one place billing is checked with the vendor (see `resolveBilling`).
  const billingCheck = requireCurrentUserId().then(resolveBilling);
  const [user, billing, aiAvailable, itemTypes, itemCounts, pinnedItems, collections, searchItems] = await Promise.all([
    requireCurrentUser(),
    billingCheck,
    // Alongside the rest, so the check slows the load as little as it can; a
    // Free user can't use AI, so never costs one.
    billingCheck.then(({ plan }) => canUseAi(plan) && hasAiCredits()),
    getSystemItemTypeDefinitions(),
    getItemCounts(),
    getPinnedItems(),
    getSessionCollections(),
    getSearchItems(),
  ]);
  // The profile's plan was read alongside the check, so a payment the check
  // just settled isn't in it yet: the check's answer wins. The next request's
  // `getCurrentUser()` reads the settled row itself.
  const plan = billing.plan;
  return { user: { ...user, plan, isPro: plan === "PRO" }, billing, aiAvailable, itemTypes, itemCounts, pinnedItems, collections, searchItems };
});

/**
 * Server-side reset: call at the end of a server action that changed session
 * data. It re-renders the current route, so the layout loads a fresh session
 * and the provider replaces its copy. Server actions only; client code uses
 * `resetProfile()` from `useUserSession()`.
 */
export const resetProfile = () => {
  refresh();
};

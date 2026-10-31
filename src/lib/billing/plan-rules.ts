import { BILLING_GRACE_MS } from "@/lib/constants/billing";
import { PRO_TYPE_NAMES } from "@/lib/constants/item-types";
import { PRICING } from "@/lib/constants/pricing";
import type { Plan, SubscriptionState } from "@/types/billing";

/** Periods ending at or after this instant are live. */
export const liveSince = (now: Date = new Date()): Date => new Date(now.getTime() - BILLING_GRACE_MS);

/**
 * Where a `PAID` period stands: active while live by the same rule as
 * `getCurrentUser()` (see `liveSince()`), else ended.
 */
export const subscriptionState = (
  { periodEnd }: { periodEnd: Date | null },
  now: Date = new Date(),
): SubscriptionState => (periodEnd && periodEnd >= liveSince(now) ? "active" : "ended");

/** Whether a user with `itemCount` items may create one more. Pro has no limit. */
export const canCreateItem = (plan: Plan, itemCount: number): boolean =>
  plan === "PRO" || itemCount < PRICING.free.itemLimit;

/** Whether a user with `collectionCount` collections may create one more. Pro has no limit. */
export const canCreateCollection = (plan: Plan, collectionCount: number): boolean =>
  plan === "PRO" || collectionCount < PRICING.free.collectionLimit;

/** Whether the plan may create items of this type: file and image are Pro. */
export const canUseType = (plan: Plan, typeName: string): boolean => plan === "PRO" || !PRO_TYPE_NAMES.has(typeName);

/** Whether the plan may use the AI features. */
export const canUseAi = (plan: Plan): boolean => plan === "PRO";

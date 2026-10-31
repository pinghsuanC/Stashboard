import { PRICING } from "@/lib/constants/pricing";

/** Free plan limits (plan-rules.ts): the numbers come from `PRICING`, never typed. */
export const ITEM_LIMIT_REACHED = `Free accounts hold up to ${PRICING.free.itemLimit} items. Upgrade to Pro for unlimited items.`;
export const COLLECTION_LIMIT_REACHED = `Free accounts hold up to ${PRICING.free.collectionLimit} collections. Upgrade to Pro for unlimited collections.`;
export const PRO_TYPE_REQUIRED = "File and image uploads are a Pro feature. Upgrade to Pro to upload.";
export const AI_PRO_REQUIRED = "AI suggestions are a Pro feature. Upgrade to Pro to use them.";
/** The upgrade dialog's line when it opens without a refusal (the billing page's Upgrade). */
export const UPGRADE_PITCH =
  "Subscribe to Pro for unlimited items and collections, file and image uploads, and AI tag suggestions.";

/** Checkout and the billing portal. */
export const BILLING_UNAVAILABLE = "Billing is unavailable right now. Please try again later.";
export const BILLING_ALREADY_SUBSCRIBED =
  "You already have an active subscription. Manage it from the Billing page, or try again in a few minutes if you just paid.";
export const BILLING_NO_PORTAL = "There's no billing account to manage yet.";

/**
 * Checkout's returns to `/billings` (`FLAGS.billingSuccess` / `billingCanceled`).
 * Success doesn't promise Pro: a payment that settles later leaves the plan Free until it does.
 */
export const BILLING_SUCCESS_TOAST = {
  id: "billing-success",
  title: "Payment received",
  description: "Pro unlocks as soon as the payment clears.",
} as const;
export const BILLING_CANCELED_TOAST = {
  id: "billing-canceled",
  title: "Checkout canceled",
  description: "You weren't charged.",
} as const;

/** Webhook route answers, read only by the vendor's delivery logs. */
export const WEBHOOK_SIGNATURE_INVALID = "Invalid signature";
export const WEBHOOK_FAILED = "Webhook handling failed";

/** Account deletion: open subscriptions are cancelled first, and that failed. */
export const BILLING_CANCEL_FAILED =
  "We couldn't cancel your subscription, so your account was kept. Please try again.";

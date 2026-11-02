import { DAY_MS, SECOND_MS } from "@/lib/constants/time";
import type { VendorCallLimits } from "@/types/billing";

/** A period stays live this long past its end, so a renewal charged at the end has time to be recorded. */
export const BILLING_GRACE_MS = 1 * DAY_MS;

/** Every vendor call's limit unless the caller sets a shorter one: the webhook and checkout paths use this. */
export const BILLING_CLIENT_TIMEOUT_MS = 20 * SECOND_MS;

/**
 * The session load's vendor calls. Every full page load waits on them outside
 * any Suspense, so a hung vendor costs this long once, then the stored rows answer.
 */
export const SESSION_VENDOR_LIMITS: VendorCallLimits = { timeoutMs: 3 * SECOND_MS, maxRetries: 0 };

/** Stripe subscription statuses that count as paid for: a renewal is recorded from one. */
export const STRIPE_ACTIVE_STATUSES: ReadonlySet<string> = new Set(["active", "trialing"]);

/**
 * Statuses that block a second checkout and that account deletion cancels:
 * the active ones, plus a renewal still being retried (`past_due`) and a
 * first payment still in progress (`incomplete`).
 */
export const STRIPE_OPEN_STATUSES: ReadonlySet<string> = new Set([...STRIPE_ACTIVE_STATUSES, "past_due", "incomplete"]);

/**
 * The webhook events the app acts on; every other type is answered 200 and
 * ignored. The Dashboard endpoint and `stripe listen --events` list these.
 */
export const STRIPE_WEBHOOK_EVENTS = {
  checkoutCompleted: "checkout.session.completed",
  checkoutExpired: "checkout.session.expired",
} as const;

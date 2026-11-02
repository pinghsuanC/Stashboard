import type { BillingInterval, BillingVendor } from "@/generated/prisma/client";

/** Derived from the user's subscription periods in `getCurrentUser()`; never stored. */
export type Plan = "FREE" | "PRO";

/** One paid period as a vendor reports it: what a `PAID` row is written from. */
export interface PaidPeriod {
  vendor: BillingVendor;
  customerId: string;
  subscriptionId: string;
  /** Stripe periods only. */
  stripePriceId: string | null;
  interval: BillingInterval;
  periodStart: Date;
  periodEnd: Date;
}

/** What a new checkout is started with. Ids only; the vendor never sees our rows. */
export interface CheckoutRequest {
  /** The `PENDING` period's id: sent as the vendor's reference and in the idempotency key. */
  periodId: string;
  userId: string;
  /** Used only when `customerId` is null: the vendor creates the customer on payment. */
  email: string;
  /** A returning customer's id (from their latest paid row), so no second customer is made. */
  customerId: string | null;
  interval: BillingInterval;
  /** Absolute; carry no ids. */
  successUrl: string;
  cancelUrl: string;
}

/** A checkout as the vendor sees it now. */
export type CheckoutState =
  | { state: "open"; url: string | null }
  | { state: "paid"; period: PaidPeriod }
  | { state: "expired" };

/**
 * What settling a checkout did to its `PENDING` period: `paid` / `expired`
 * moved it there; `unchanged` found it already moved on (a duplicate event, or
 * the other of webhook and session load got there first); `open` left it as
 * it is; `no-period` found no row with that id and checkout id.
 */
export type SettleOutcome = "paid" | "expired" | "unchanged" | "open" | "no-period";

/** How starting a checkout ended: where to send the browser, or why not. */
export type CheckoutStart = { kind: "redirect"; url: string } | { kind: "already-subscribed" };

/** A verified webhook event, reduced to what the app acts on. */
export type BillingWebhookEvent =
  | {
      type: "checkout.completed";
      checkoutId: string;
      /** Our period id, as the checkout carried it (`client_reference_id`); null if missing. */
      periodId: string | null;
      /** False while an asynchronous payment is still pending: nothing to settle yet. */
      paid: boolean;
    }
  | { type: "checkout.expired"; checkoutId: string; periodId: string | null }
  | { type: "ignored"; vendorType: string };

/** What the signed-in user's billing card and Pro checks need. Never vendor ids. */
export interface BillingStatus {
  plan: Plan;
  interval: BillingInterval | null;
  /** End of the live period; null when Free. */
  periodEnd: Date | null;
  /** A vendor customer exists, so a portal link is possible. */
  isCustomer: boolean;
}

/** Where a past subscription stands now. */
export type SubscriptionState = "active" | "ended";

/** One row of the billing page's past subscriptions. Never vendor ids. */
export interface PastSubscription {
  id: string;
  interval: BillingInterval;
  /** Paid through a vendor, or granted without one (a trial, the seed, a comped account). */
  source: "paid" | "granted";
  periodStart: Date | null;
  periodEnd: Date | null;
  state: SubscriptionState;
}

/** One vendor customer the user has paid through (account deletion, the portal). */
export interface BillingCustomer {
  vendor: BillingVendor;
  customerId: string;
}

/** How long one vendor call may take, for a caller that can't wait the client's default. */
export interface VendorCallLimits {
  timeoutMs: number;
  maxRetries: number;
}

/**
 * One payment vendor. Every method talks to the vendor with the server's
 * secret; nothing the browser sends reaches it except through our own rows.
 */
export interface BillingAdapter {
  vendor: BillingVendor;
  /**
   * Throws `BillingNotConfiguredError` naming any missing setting. Called
   * before a checkout writes its `PENDING` row, so missing config writes nothing.
   */
  assertConfigured(): void;
  /** Starts a checkout tied to a pending period; returns where to send the browser and the vendor's checkout id. */
  createCheckout(request: CheckoutRequest): Promise<{ url: string; checkoutId: string }>;
  /** Fetches a checkout by the id `createCheckout` returned. */
  fetchCheckout(checkoutId: string, limits?: VendorCallLimits): Promise<CheckoutState>;
  /** The customer's current paid period, or null when nothing is active (renewals). */
  fetchActivePeriod(customerId: string, limits?: VendorCallLimits): Promise<PaidPeriod | null>;
  /** Whether the customer already has a live or pending subscription (no second checkout). */
  hasOpenSubscription(customerId: string): Promise<boolean>;
  /** Verifies a webhook's signature on the raw body; throws `WebhookSignatureError` if it doesn't. */
  parseWebhook(rawBody: string, headers: Headers): BillingWebhookEvent;
  /** The vendor's hosted page for payment methods, invoices and cancelling. */
  createPortalLink(customerId: string, returnUrl: string): Promise<string>;
  /** Cancels every open subscription of the customer now (account deletion). */
  cancelAll(customerId: string): Promise<void>;
  /** Cancels one subscription now (a paid checkout no period claims). */
  cancelSubscription(subscriptionId: string): Promise<void>;
}

import "server-only";

import Stripe from "stripe";

import { BillingNotConfiguredError, WebhookSignatureError } from "@/lib/billing/billing-errors";
import {
  BILLING_CLIENT_TIMEOUT_MS,
  STRIPE_ACTIVE_STATUSES,
  STRIPE_OPEN_STATUSES,
  STRIPE_WEBHOOK_EVENTS,
} from "@/lib/constants/billing";
import type { BillingAdapter, BillingWebhookEvent, PaidPeriod, VendorCallLimits } from "@/types/billing";

// The Stripe billing adapter: the only module that imports `stripe`. It turns
// Stripe's objects into vendor-neutral periods and events; what counts as Pro,
// and what a Free user may do, live in `@/lib/billing/`. Period writes live in
// `entitlement.ts`, never here.

/** The settings, read fresh on each call; any missing one throws, naming it. */
const required = <Name extends string>(settings: Record<Name, string | undefined>): Record<Name, string> => {
  const missing = Object.entries(settings)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new BillingNotConfiguredError(missing);
  return settings as Record<Name, string>;
};

const config = () =>
  required({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_PRICE_ID_MONTHLY: process.env.STRIPE_PRICE_ID_MONTHLY,
    STRIPE_PRICE_ID_YEARLY: process.env.STRIPE_PRICE_ID_YEARLY,
  });

// Built on first use, so importing the module never needs the env. Holds no
// per-user state, so sharing it across requests is fine. The API version is
// pinned so response shapes can't shift under us.
let client: Stripe | undefined;

/** The client; throws `BillingNotConfiguredError` first if a setting is missing. */
const stripe = (): Stripe => {
  const { STRIPE_SECRET_KEY } = config();
  client ??= new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: "2026-09-30.endive",
    maxNetworkRetries: 2,
    timeout: BILLING_CLIENT_TIMEOUT_MS,
  });
  return client;
};

/** A caller's limits as one request's options; none keeps the client's own. */
const requestOptions = (limits?: VendorCallLimits): Stripe.RequestOptions | undefined =>
  limits && { timeout: limits.timeoutMs, maxNetworkRetries: limits.maxRetries };

const idOf = (value: string | { id: string } | null): string | null =>
  value === null ? null : typeof value === "string" ? value : value.id;

/** A subscription as a period; null if it has no item or customer to record. */
const toPeriod = (subscription: Stripe.Subscription): PaidPeriod | null => {
  const item = subscription.items.data[0];
  const customerId = idOf(subscription.customer);
  if (!item || !customerId) return null;
  return {
    vendor: "STRIPE",
    customerId,
    subscriptionId: subscription.id,
    stripePriceId: item.price.id,
    interval: item.price.recurring?.interval === "year" ? "YEAR" : "MONTH",
    // Since API 2025-03-31 the period lives on the subscription item.
    periodStart: new Date(item.current_period_start * 1000),
    periodEnd: new Date(item.current_period_end * 1000),
  };
};

// One subscription per customer is the rule ("limit customers to one
// subscription" in Checkout settings), so a short page covers every one.
const listSubscriptions = async (customerId: string, limits?: VendorCallLimits): Promise<Stripe.Subscription[]> =>
  (await stripe().subscriptions.list({ customer: customerId, status: "all", limit: 20 }, requestOptions(limits))).data;

export const stripeBilling: BillingAdapter = {
  vendor: "STRIPE",

  assertConfigured() {
    config();
  },

  async createCheckout({ periodId, userId, email, customerId, interval, successUrl, cancelUrl }) {
    const { STRIPE_PRICE_ID_MONTHLY, STRIPE_PRICE_ID_YEARLY } = config();
    const session = await stripe().checkout.sessions.create(
      {
        mode: "subscription",
        // A returning customer is reused; a new one is created by Checkout
        // only when the payment completes, so abandoned checkouts leave none.
        ...(customerId ? { customer: customerId } : { customer_email: email }),
        // The pending period's id: how the webhook finds the row, and
        // readable in the Dashboard.
        client_reference_id: periodId,
        metadata: { periodId, userId },
        subscription_data: { metadata: { periodId, userId } },
        line_items: [{ price: interval === "YEAR" ? STRIPE_PRICE_ID_YEARLY : STRIPE_PRICE_ID_MONTHLY, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
      },
      // A retried call for the same pending period gets the same session back.
      { idempotencyKey: `checkout-${periodId}` },
    );
    if (!session.url) throw new Error("Stripe returned a Checkout session without a URL");
    return { url: session.url, checkoutId: session.id };
  },

  async fetchCheckout(checkoutId, limits) {
    const session = await stripe().checkout.sessions.retrieve(checkoutId, { expand: ["subscription"] }, requestOptions(limits));
    if (session.status === "expired") return { state: "expired" };
    if (session.status === "complete" && session.payment_status === "paid" && session.subscription) {
      const period = typeof session.subscription === "string" ? null : toPeriod(session.subscription);
      if (period) return { state: "paid", period };
    }
    return { state: "open", url: session.url ?? null };
  },

  async fetchActivePeriod(customerId, limits) {
    const active = (await listSubscriptions(customerId, limits)).find((sub) => STRIPE_ACTIVE_STATUSES.has(sub.status));
    return active ? toPeriod(active) : null;
  },

  async hasOpenSubscription(customerId) {
    return (await listSubscriptions(customerId)).some((sub) => STRIPE_OPEN_STATUSES.has(sub.status));
  },

  parseWebhook(rawBody, headers) {
    const { STRIPE_WEBHOOK_SECRET } = required({ STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET });
    let event: Stripe.Event;
    try {
      // On the raw body: a parsed and re-serialized body wouldn't verify. A
      // missing header is an empty one, which Stripe refuses like a bad one.
      event = stripe().webhooks.constructEvent(rawBody, headers.get("stripe-signature") ?? "", STRIPE_WEBHOOK_SECRET);
    } catch (error) {
      throw new WebhookSignatureError(error);
    }
    return toWebhookEvent(event);
  },

  async createPortalLink(customerId, returnUrl) {
    const portal = await stripe().billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return portal.url;
  },

  async cancelAll(customerId) {
    for (const sub of await listSubscriptions(customerId)) {
      if (STRIPE_OPEN_STATUSES.has(sub.status)) await stripe().subscriptions.cancel(sub.id);
    }
  },

  async cancelSubscription(subscriptionId) {
    await stripe().subscriptions.cancel(subscriptionId);
  },
};

/** A verified Stripe event, reduced to what the app acts on. */
const toWebhookEvent = (event: Stripe.Event): BillingWebhookEvent => {
  if (event.type === STRIPE_WEBHOOK_EVENTS.checkoutCompleted) {
    const session = event.data.object;
    return {
      type: "checkout.completed",
      checkoutId: session.id,
      periodId: session.client_reference_id,
      paid: session.payment_status === "paid",
    };
  }
  if (event.type === STRIPE_WEBHOOK_EVENTS.checkoutExpired) {
    const session = event.data.object;
    return { type: "checkout.expired", checkoutId: session.id, periodId: session.client_reference_id };
  }
  return { type: "ignored", vendorType: event.type };
};

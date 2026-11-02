import { beforeEach, describe, expect, it, vi } from "vitest";

import { BILLING_CLIENT_TIMEOUT_MS } from "@/lib/constants/billing";

import { stripeBilling } from "./stripe";

// After vi.resetModules() the error classes are fresh copies, so match by name.
const NOT_CONFIGURED = { name: "BillingNotConfiguredError" };
const BAD_SIGNATURE = { name: "WebhookSignatureError" };

// The real Stripe class, with its network resources replaced by recorders:
// what matters is what reaches Stripe, and how its answers are mapped.
// Webhook signing and verification stay real.
const api = vi.hoisted(() => ({
  configs: [] as unknown[],
  createSession: vi.fn(),
  retrieveSession: vi.fn(),
  listSubscriptions: vi.fn(),
  cancelSubscription: vi.fn(),
  createPortal: vi.fn(),
}));

vi.mock("stripe", async (importOriginal) => {
  const { default: Stripe } = await importOriginal<typeof import("stripe")>();
  class RecordingStripe extends Stripe {
    constructor(key: string, config?: ConstructorParameters<typeof Stripe>[1]) {
      super(key, config);
      api.configs.push({ key, ...config });
      Object.assign(this, {
        checkout: { sessions: { create: api.createSession, retrieve: api.retrieveSession } },
        subscriptions: { list: api.listSubscriptions, cancel: api.cancelSubscription },
        billingPortal: { sessions: { create: api.createPortal } },
      });
    }
  }
  return { default: RecordingStripe };
});

const SECRET = "whsec_test_secret";
const PERIOD_START = 1_780_000_000;
const PERIOD_END = PERIOD_START + 30 * 24 * 3600;

const subscription = (status: string, interval: "month" | "year" = "month") => ({
  id: `sub_${status}`,
  status,
  customer: "cus_1",
  items: {
    data: [
      {
        price: { id: interval === "year" ? "price_year" : "price_month", recurring: { interval } },
        current_period_start: PERIOD_START,
        current_period_end: PERIOD_END,
      },
    ],
  },
});

const request = {
  periodId: "period-1",
  userId: "ada",
  email: "ada@example.com",
  customerId: null,
  interval: "MONTH" as const,
  successUrl: "https://app.test/billings?billing=success",
  cancelUrl: "https://app.test/billings?billing=canceled",
};

// A body signed with the webhook secret, as Stripe would send it.
const signed = async (event: object, secret = SECRET) => {
  const { default: Stripe } = await vi.importActual<typeof import("stripe")>("stripe");
  const payload = JSON.stringify(event);
  const header = new Stripe("sk_test_signing").webhooks.generateTestHeaderString({ payload, secret });
  return { payload, headers: new Headers({ "stripe-signature": header }) };
};

const event = (type: string, object: object) => ({ id: "evt_1", object: "event", type, data: { object } });

beforeEach(() => {
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_123");
  vi.stubEnv("STRIPE_PRICE_ID_MONTHLY", "price_month");
  vi.stubEnv("STRIPE_PRICE_ID_YEARLY", "price_year");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", SECRET);
  for (const fn of [api.createSession, api.retrieveSession, api.listSubscriptions, api.cancelSubscription, api.createPortal]) {
    fn.mockReset();
  }
  api.createSession.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" });
  api.listSubscriptions.mockResolvedValue({ data: [] });
});

describe("a caller's limits reach Stripe (CR1)", () => {
  const limits = { timeoutMs: 1234, maxRetries: 0 };
  const stripeOptions = { timeout: 1234, maxNetworkRetries: 0 };

  it("fetchCheckout passes them as that request's options", async () => {
    api.retrieveSession.mockResolvedValue({ status: "open", url: null });

    await stripeBilling.fetchCheckout("cs_1", limits);

    expect(api.retrieveSession).toHaveBeenCalledWith("cs_1", { expand: ["subscription"] }, stripeOptions);
  });

  it("fetchActivePeriod passes them as that request's options", async () => {
    await stripeBilling.fetchActivePeriod("cus_1", limits);

    expect(api.listSubscriptions).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 20 }, stripeOptions);
  });

  it("with no limits, the call keeps the client's own timeout and retries", async () => {
    api.retrieveSession.mockResolvedValue({ status: "open", url: null });

    await stripeBilling.fetchCheckout("cs_1");
    await stripeBilling.fetchActivePeriod("cus_1");

    expect(api.retrieveSession).toHaveBeenCalledWith("cs_1", { expand: ["subscription"] }, undefined);
    expect(api.listSubscriptions).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 20 }, undefined);
  });
});

describe("the client (R5)", () => {
  it("is built on first use with the pinned API version and the secret key", async () => {
    vi.resetModules();
    const fresh = await import("./stripe");
    const before = api.configs.length;

    await fresh.stripeBilling.fetchActivePeriod("cus_1");
    await fresh.stripeBilling.fetchActivePeriod("cus_1");

    expect(api.configs.slice(before)).toEqual([
      expect.objectContaining({ key: "sk_test_123", apiVersion: "2026-09-30.endive" }),
    ]);
  });

  it("CR1: replaces the SDK's 80 second default with a moderate timeout for every call", async () => {
    vi.resetModules();
    const fresh = await import("./stripe");
    const before = api.configs.length;

    await fresh.stripeBilling.fetchActivePeriod("cus_1");

    expect(api.configs.slice(before)).toEqual([expect.objectContaining({ timeout: BILLING_CLIENT_TIMEOUT_MS })]);
  });

  it.each(["STRIPE_SECRET_KEY", "STRIPE_PRICE_ID_MONTHLY", "STRIPE_PRICE_ID_YEARLY"])(
    "with %s unset, refuses by name before building a client or asking Stripe",
    async (name) => {
      vi.resetModules();
      vi.stubEnv(name, "");
      const fresh = await import("./stripe");
      const before = api.configs.length;

      expect(() => fresh.stripeBilling.assertConfigured()).toThrow(expect.objectContaining({ ...NOT_CONFIGURED, missing: [name] }));
      await expect(fresh.stripeBilling.createCheckout(request)).rejects.toMatchObject(NOT_CONFIGURED);
      expect(api.configs.length).toBe(before);
      expect(api.createSession).not.toHaveBeenCalled();
    },
  );

  it("is configured when every setting is there", () => {
    expect(() => stripeBilling.assertConfigured()).not.toThrow();
  });
});

describe("starting a checkout (R6, R8, R9, R12)", () => {
  it("creates a subscription checkout tied to the pending period, at the interval's price", async () => {
    const result = await stripeBilling.createCheckout({ ...request, interval: "YEAR" });

    expect(result).toEqual({ url: "https://checkout.stripe.com/c/cs_1", checkoutId: "cs_1" });
    const [params, options] = api.createSession.mock.calls[0];
    expect(params).toMatchObject({
      mode: "subscription",
      line_items: [{ price: "price_year", quantity: 1 }],
      client_reference_id: "period-1",
      metadata: { periodId: "period-1", userId: "ada" },
      subscription_data: { metadata: { periodId: "period-1", userId: "ada" } },
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
    });
    expect(options).toEqual({ idempotencyKey: "checkout-period-1" });
  });

  it("R9: a new customer goes by email; Checkout creates the customer on payment", async () => {
    await stripeBilling.createCheckout(request);

    const [params] = api.createSession.mock.calls[0];
    expect(params.customer_email).toBe("ada@example.com");
    expect(params).not.toHaveProperty("customer");
  });

  it("R9: a returning customer goes by their customer id, not their email", async () => {
    await stripeBilling.createCheckout({ ...request, customerId: "cus_old" });

    const [params] = api.createSession.mock.calls[0];
    expect(params.customer).toBe("cus_old");
    expect(params).not.toHaveProperty("customer_email");
  });

  it("monthly uses the monthly price", async () => {
    await stripeBilling.createCheckout(request);

    expect(api.createSession.mock.calls[0][0].line_items).toEqual([{ price: "price_month", quantity: 1 }]);
  });

  it("a session without a URL is an error, not a redirect to nowhere", async () => {
    api.createSession.mockResolvedValue({ id: "cs_1", url: null });

    await expect(stripeBilling.createCheckout(request)).rejects.toThrow();
  });
});

describe("fetching a checkout (R6)", () => {
  it("a paid, complete session maps to its period, with dates from the subscription item", async () => {
    api.retrieveSession.mockResolvedValue({
      id: "cs_1",
      status: "complete",
      payment_status: "paid",
      subscription: subscription("active", "year"),
    });

    expect(await stripeBilling.fetchCheckout("cs_1")).toEqual({
      state: "paid",
      period: {
        vendor: "STRIPE",
        customerId: "cus_1",
        subscriptionId: "sub_active",
        stripePriceId: "price_year",
        interval: "YEAR",
        periodStart: new Date(PERIOD_START * 1000),
        periodEnd: new Date(PERIOD_END * 1000),
      },
    });
    expect(api.retrieveSession).toHaveBeenCalledWith("cs_1", { expand: ["subscription"] }, undefined);
  });

  it("an expired session is expired", async () => {
    api.retrieveSession.mockResolvedValue({ id: "cs_1", status: "expired", payment_status: "unpaid", subscription: null });

    expect(await stripeBilling.fetchCheckout("cs_1")).toEqual({ state: "expired" });
  });

  it("an open session is open, with its URL", async () => {
    api.retrieveSession.mockResolvedValue({ id: "cs_1", status: "open", url: "https://checkout.stripe.com/c/cs_1", payment_status: "unpaid", subscription: null });

    expect(await stripeBilling.fetchCheckout("cs_1")).toEqual({ state: "open", url: "https://checkout.stripe.com/c/cs_1" });
  });

  it("a complete session still awaiting payment is not paid", async () => {
    api.retrieveSession.mockResolvedValue({ id: "cs_1", status: "complete", url: null, payment_status: "unpaid", subscription: subscription("incomplete") });

    expect(await stripeBilling.fetchCheckout("cs_1")).toEqual({ state: "open", url: null });
  });
});

describe("subscriptions (R6)", () => {
  it("the active period is the active or trialing subscription's", async () => {
    api.listSubscriptions.mockResolvedValue({ data: [subscription("canceled"), subscription("trialing")] });

    expect(await stripeBilling.fetchActivePeriod("cus_1")).toMatchObject({ subscriptionId: "sub_trialing", interval: "MONTH" });
    expect(api.listSubscriptions).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_1", status: "all" }), undefined);
  });

  it("no active subscription is no period; past due doesn't count", async () => {
    api.listSubscriptions.mockResolvedValue({ data: [subscription("past_due"), subscription("canceled")] });

    expect(await stripeBilling.fetchActivePeriod("cus_1")).toBeNull();
  });

  it("an open subscription includes past due and incomplete, not canceled", async () => {
    api.listSubscriptions.mockResolvedValue({ data: [subscription("canceled")] });
    expect(await stripeBilling.hasOpenSubscription("cus_1")).toBe(false);

    for (const status of ["active", "trialing", "past_due", "incomplete"]) {
      api.listSubscriptions.mockResolvedValue({ data: [subscription("canceled"), subscription(status)] });
      expect(await stripeBilling.hasOpenSubscription("cus_1")).toBe(true);
    }
  });

  it("cancelAll cancels every open subscription now, and leaves closed ones", async () => {
    api.listSubscriptions.mockResolvedValue({
      data: [subscription("active"), subscription("canceled"), subscription("past_due"), subscription("incomplete_expired")],
    });

    await stripeBilling.cancelAll("cus_1");

    expect(api.cancelSubscription.mock.calls.map(([id]) => id)).toEqual(["sub_active", "sub_past_due"]);
  });

  it("cancelSubscription cancels that one subscription", async () => {
    await stripeBilling.cancelSubscription("sub_9");

    expect(api.cancelSubscription).toHaveBeenCalledWith("sub_9");
  });

  it("the portal link is for the customer, returning to the given page", async () => {
    api.createPortal.mockResolvedValue({ url: "https://billing.stripe.com/p/1" });

    expect(await stripeBilling.createPortalLink("cus_1", "https://app.test/settings")).toBe("https://billing.stripe.com/p/1");
    expect(api.createPortal).toHaveBeenCalledWith({ customer: "cus_1", return_url: "https://app.test/settings" });
  });
});

describe("webhooks (R6, R13)", () => {
  const completed = { id: "cs_1", object: "checkout.session", client_reference_id: "period-1", subscription: "sub_1", payment_status: "paid" };

  it("a signed checkout.session.completed maps to the checkout and its period id", async () => {
    const { payload, headers } = await signed(event("checkout.session.completed", completed));

    expect(stripeBilling.parseWebhook(payload, headers)).toEqual({
      type: "checkout.completed",
      checkoutId: "cs_1",
      periodId: "period-1",
      paid: true,
    });
  });

  it("a completed checkout still awaiting payment is not paid", async () => {
    const { payload, headers } = await signed(event("checkout.session.completed", { ...completed, payment_status: "unpaid" }));

    expect(stripeBilling.parseWebhook(payload, headers)).toMatchObject({ type: "checkout.completed", paid: false });
  });

  it("a missing reference reads as no period id", async () => {
    const { payload, headers } = await signed(event("checkout.session.completed", { ...completed, client_reference_id: null }));

    expect(stripeBilling.parseWebhook(payload, headers)).toMatchObject({ periodId: null });
  });

  it("a signed checkout.session.expired maps to the checkout and its period id", async () => {
    const { payload, headers } = await signed(event("checkout.session.expired", { ...completed, subscription: null }));

    expect(stripeBilling.parseWebhook(payload, headers)).toEqual({ type: "checkout.expired", checkoutId: "cs_1", periodId: "period-1" });
  });

  it("any other event is ignored", async () => {
    const { payload, headers } = await signed(event("invoice.paid", { id: "in_1" }));

    expect(stripeBilling.parseWebhook(payload, headers)).toEqual({ type: "ignored", vendorType: "invoice.paid" });
  });

  it("a body signed with another secret is refused", async () => {
    const { payload, headers } = await signed(event("checkout.session.completed", completed), "whsec_other");

    expect(() => stripeBilling.parseWebhook(payload, headers)).toThrow(expect.objectContaining(BAD_SIGNATURE));
  });

  it("a body changed after signing is refused", async () => {
    const { payload, headers } = await signed(event("checkout.session.completed", completed));

    expect(() => stripeBilling.parseWebhook(payload.replace("period-1", "period-2"), headers)).toThrow(
      expect.objectContaining(BAD_SIGNATURE),
    );
  });

  it("a body with no signature header is refused", async () => {
    const { payload } = await signed(event("checkout.session.completed", completed));

    expect(() => stripeBilling.parseWebhook(payload, new Headers())).toThrow(expect.objectContaining(BAD_SIGNATURE));
  });

  it("without a webhook secret it refuses as not configured, naming it", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const { payload, headers } = await signed(event("checkout.session.completed", completed));

    expect(() => stripeBilling.parseWebhook(payload, headers)).toThrow(
      expect.objectContaining({ ...NOT_CONFIGURED, missing: ["STRIPE_WEBHOOK_SECRET"] }),
    );
  });
});

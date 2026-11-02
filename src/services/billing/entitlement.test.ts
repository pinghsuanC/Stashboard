import { beforeEach, describe, expect, it, vi } from "vitest";

import { BILLING_GRACE_MS, SESSION_VENDOR_LIMITS } from "@/lib/constants/billing";
import { DAY_MS } from "@/lib/constants/time";
import { checkRateLimit } from "@/services/rate-limit";
import { fakeAdapter, paidPeriod, resetFakeBilling } from "@/test/fake-billing";
import { db, fakePrisma, resetDb } from "@/test/fake-prisma";

import { resolveBilling } from "./entitlement";

vi.mock("@/services/prisma", async () => ({ prisma: (await import("@/test/fake-prisma")).fakePrisma }));
vi.mock("@/services/billing/vendors", async () => (await import("@/test/fake-billing")).fakeVendors);
vi.mock("@/services/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.1.1.1" }) }));
const log = vi.spyOn(console, "error").mockImplementation(() => {});

const now = () => Date.now();
const daysFromNow = (n: number) => new Date(now() + n * DAY_MS);
const FREE = { plan: "FREE", interval: null, periodEnd: null, isCustomer: false };
const adas = () => db.subscriptionPeriods.filter((row) => row.userId === "ada");
const stripeCalls = () =>
  fakeAdapter.fetchCheckout.mock.calls.length + fakeAdapter.fetchActivePeriod.mock.calls.length;

// A paid Stripe row for Ada, ending `endsIn` days from now (negative: lapsed).
const paidRow = (id: string, endsIn: number, extra: object = {}) => ({
  id,
  userId: "ada",
  status: "PAID" as const,
  vendor: "STRIPE" as const,
  vendorCustomerId: "cus_ada",
  vendorSubscriptionId: "sub_ada",
  stripePriceId: "price_month",
  interval: "MONTH" as const,
  periodStart: daysFromNow(endsIn - 30),
  periodEnd: daysFromNow(endsIn),
  createdAt: daysFromNow(endsIn - 30),
  ...extra,
});
const pendingRow = (id: string, extra: object = {}) => ({
  id,
  userId: "ada",
  status: "PENDING" as const,
  vendor: "STRIPE" as const,
  interval: "YEAR" as const,
  stripeCheckoutSessionId: `cs_${id}`,
  createdAt: daysFromNow(0),
  ...extra,
});

beforeEach(() => {
  resetDb();
  resetFakeBilling();
  log.mockClear();
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ success: true, remaining: 1, reset: now() });
  db.users.push(
    { id: "ada", name: "Ada", email: "ada@example.com", passwordHash: null, createdAt: daysFromNow(-400) },
    { id: "bob", name: "Bob", email: "bob@example.com", passwordHash: null, createdAt: daysFromNow(-400) },
  );
});

describe("no vendor rows: no Stripe call (R18.3)", () => {
  it("a Free user is Free, and neither Stripe nor the rate limit is touched", async () => {
    expect(await resolveBilling("ada")).toEqual(FREE);
    expect(stripeCalls()).toBe(0);
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("a granted period is Pro from the stored row alone, and no customer", async () => {
    const end = daysFromNow(10);
    db.subscriptionPeriods.push({ id: "trial", userId: "ada", vendor: null, interval: "MONTH", periodStart: daysFromNow(-4), periodEnd: end });

    expect(await resolveBilling("ada")).toEqual({ plan: "PRO", interval: "MONTH", periodEnd: end, isCustomer: false });
    expect(stripeCalls()).toBe(0);
  });

  it("another user's rows are never looked at", async () => {
    db.subscriptionPeriods.push({ ...paidRow("bobs", 10), userId: "bob", vendorCustomerId: "cus_bob" });

    expect(await resolveBilling("ada")).toEqual(FREE);
    expect(stripeCalls()).toBe(0);
  });
});

describe("a pending checkout is checked first (R18.1)", () => {
  it("paid at Stripe: the row is marked PAID and the user is Pro, with the period's interval and end", async () => {
    const period = paidPeriod({ interval: "YEAR" });
    db.subscriptionPeriods.push(pendingRow("p1"));
    fakeAdapter.fetchCheckout.mockResolvedValue({ state: "paid", period });

    expect(await resolveBilling("ada")).toEqual({ plan: "PRO", interval: "YEAR", periodEnd: period.periodEnd, isCustomer: true });
    expect(fakeAdapter.fetchCheckout).toHaveBeenCalledWith("cs_p1", SESSION_VENDOR_LIMITS);
    expect(adas()).toEqual([expect.objectContaining({ id: "p1", status: "PAID", vendorCustomerId: "cus_ada" })]);
  });

  it("expired at Stripe: the row is marked EXPIRED, and the user stays Free", async () => {
    db.subscriptionPeriods.push(pendingRow("p1"));
    fakeAdapter.fetchCheckout.mockResolvedValue({ state: "expired" });

    expect(await resolveBilling("ada")).toEqual(FREE);
    expect(adas()[0].status).toBe("EXPIRED");
  });

  it("still open: nothing changes", async () => {
    db.subscriptionPeriods.push(pendingRow("p1"));
    fakeAdapter.fetchCheckout.mockResolvedValue({ state: "open", url: "https://checkout.test/p1" });

    expect(await resolveBilling("ada")).toEqual(FREE);
    expect(adas()[0].status).toBe("PENDING");
  });

  it("is the one Stripe call: a customer's subscription isn't also asked about", async () => {
    db.subscriptionPeriods.push(paidRow("old", -40), pendingRow("p1"));
    fakeAdapter.fetchCheckout.mockResolvedValue({ state: "open", url: null });

    await resolveBilling("ada");

    expect(fakeAdapter.fetchCheckout).toHaveBeenCalledOnce();
    expect(fakeAdapter.fetchActivePeriod).not.toHaveBeenCalled();
  });

  it("the newest pending one is checked; a row without a session id is skipped", async () => {
    db.subscriptionPeriods.push(
      pendingRow("older", { createdAt: daysFromNow(-2) }),
      pendingRow("newer", { createdAt: daysFromNow(-1) }),
      pendingRow("no-session", { createdAt: daysFromNow(0), stripeCheckoutSessionId: null }),
    );
    fakeAdapter.fetchCheckout.mockResolvedValue({ state: "open", url: null });

    await resolveBilling("ada");

    expect(fakeAdapter.fetchCheckout).toHaveBeenCalledWith("cs_newer", SESSION_VENDOR_LIMITS);
  });
});

describe("a paying customer's subscription is checked (R18.2)", () => {
  it("a renewal Stripe has and we don't is recorded as a new PAID row, the customer copied", async () => {
    db.subscriptionPeriods.push(paidRow("last", -0.5));
    const renewal = paidPeriod({ periodStart: daysFromNow(-0.5), periodEnd: daysFromNow(29.5) });
    fakeAdapter.fetchActivePeriod.mockResolvedValue(renewal);

    expect(await resolveBilling("ada")).toEqual({ plan: "PRO", interval: "MONTH", periodEnd: renewal.periodEnd, isCustomer: true });
    expect(fakeAdapter.fetchActivePeriod).toHaveBeenCalledWith("cus_ada", SESSION_VENDOR_LIMITS);
    expect(adas()).toEqual([
      expect.objectContaining({ id: "last" }),
      expect.objectContaining({
        status: "PAID",
        vendor: "STRIPE",
        vendorCustomerId: "cus_ada",
        vendorSubscriptionId: "sub_ada",
        stripePriceId: "price_month",
        periodStart: renewal.periodStart,
        periodEnd: renewal.periodEnd,
      }),
    ]);
  });

  it("is checked while the stored period is still live, too", async () => {
    db.subscriptionPeriods.push(paidRow("live", 10));

    await resolveBilling("ada");

    expect(fakeAdapter.fetchActivePeriod).toHaveBeenCalledWith("cus_ada", SESSION_VENDOR_LIMITS);
  });

  it("a renewal is recorded once, however many loads see it", async () => {
    db.subscriptionPeriods.push(paidRow("last", -0.5));
    fakeAdapter.fetchActivePeriod.mockResolvedValue(paidPeriod({ periodEnd: daysFromNow(29.5) }));

    await resolveBilling("ada");
    await resolveBilling("ada");

    expect(adas()).toHaveLength(2);
  });

  it("the period Stripe reports that's already stored inserts nothing", async () => {
    const stored = paidRow("live", 10);
    db.subscriptionPeriods.push(stored);
    fakeAdapter.fetchActivePeriod.mockResolvedValue(paidPeriod({ periodStart: stored.periodStart, periodEnd: stored.periodEnd }));
    const create = vi.spyOn(fakePrisma.subscriptionPeriod, "create");

    try {
      await resolveBilling("ada");

      expect(adas()).toHaveLength(1);
      // Found by the check, not by tripping the unique key.
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it("a load racing another to insert the same renewal counts it as recorded", async () => {
    db.subscriptionPeriods.push(paidRow("last", -0.5));
    const renewal = paidPeriod({ periodEnd: daysFromNow(29.5) });
    fakeAdapter.fetchActivePeriod.mockResolvedValue(renewal);
    // The other load inserted the row after this one's existence check found
    // nothing, so this one's insert hits the unique key.
    db.subscriptionPeriods.push({ ...paidRow("raced", 29.5), periodEnd: renewal.periodEnd });
    const original = fakePrisma.subscriptionPeriod.findFirst;
    const findFirst = vi
      .spyOn(fakePrisma.subscriptionPeriod, "findFirst")
      .mockImplementation((args) => (args?.where?.vendorSubscriptionId ? Promise.resolve(null) : original(args)));

    try {
      expect(await resolveBilling("ada")).toMatchObject({ plan: "PRO" });
      expect(adas()).toHaveLength(2);
      expect(log).not.toHaveBeenCalled();
    } finally {
      findFirst.mockRestore();
    }
  });

  it("no active subscription at Stripe: nothing is inserted, and a lapsed customer is Free", async () => {
    db.subscriptionPeriods.push(paidRow("lapsed", -40));

    expect(await resolveBilling("ada")).toEqual({ ...FREE, isCustomer: true });
    expect(adas()).toHaveLength(1);
  });

  it("a period inside the grace window is still Pro", async () => {
    db.subscriptionPeriods.push(paidRow("ended", -(BILLING_GRACE_MS / DAY_MS) / 2));

    expect(await resolveBilling("ada")).toMatchObject({ plan: "PRO" });
  });
});

describe("failures and the rate limit (R20)", () => {
  it("a Stripe error answers from the stored rows: a live period is still Pro, and the error is logged", async () => {
    const live = paidRow("live", 10);
    db.subscriptionPeriods.push(live);
    fakeAdapter.fetchActivePeriod.mockRejectedValue(new Error("Stripe down"));

    expect(await resolveBilling("ada")).toEqual({ plan: "PRO", interval: "MONTH", periodEnd: live.periodEnd, isCustomer: true });
    expect(log).toHaveBeenCalled();
  });

  it("a Stripe error grants nothing: a pending checkout stays pending and the user Free", async () => {
    db.subscriptionPeriods.push(pendingRow("p1"));
    fakeAdapter.fetchCheckout.mockRejectedValue(new Error("Stripe down"));

    expect(await resolveBilling("ada")).toEqual(FREE);
    expect(adas()[0].status).toBe("PENDING");
  });

  it("past the billingCheck limit, keyed by the user alone, Stripe isn't asked and the stored rows answer", async () => {
    const live = paidRow("live", 10);
    db.subscriptionPeriods.push(live, pendingRow("p1"));
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false, remaining: 0, reset: now() + 60_000 });

    expect(await resolveBilling("ada")).toEqual({ plan: "PRO", interval: "MONTH", periodEnd: live.periodEnd, isCustomer: true });
    expect(stripeCalls()).toBe(0);
    expect(checkRateLimit).toHaveBeenCalledWith("billingCheck", expect.any(Headers), "ada");
  });

  it("missing Stripe settings answer from the stored rows too", async () => {
    db.subscriptionPeriods.push(paidRow("live", 10));
    fakeAdapter.fetchActivePeriod.mockRejectedValue(Object.assign(new Error("not configured"), { name: "BillingNotConfiguredError" }));

    expect(await resolveBilling("ada")).toMatchObject({ plan: "PRO" });
  });
});

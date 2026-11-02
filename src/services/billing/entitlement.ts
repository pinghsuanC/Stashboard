import "server-only";

import { headers } from "next/headers";

import { Prisma } from "@/generated/prisma/client";
import { liveSince } from "@/lib/billing/plan-rules";
import { SESSION_VENDOR_LIMITS } from "@/lib/constants/billing";
import { adapterFor } from "@/services/billing/vendors";
import { prisma } from "@/services/prisma";
import { checkRateLimit } from "@/services/rate-limit";
import type { BillingStatus, CheckoutState, PaidPeriod, SettleOutcome } from "@/types/billing";

// Every write that settles a period. Reached by the webhook route, the
// session load and starting a checkout, never by a server action (the
// boundaries test, B12): each write is built from what the vendor just said,
// fetched with the server's secret, and keyed by ids the browser never sends.

/**
 * Moves a `PENDING` period to what the vendor says its checkout is now:
 * `paid` writes Stripe's customer, subscription, price, interval and dates;
 * `expired` marks it `EXPIRED`; `open` changes nothing. The row must match
 * both our period id (Stripe's `client_reference_id`) and the vendor's
 * checkout id, so one checkout can't settle another's period.
 *
 * Shared by the webhook and the session load, so the two can't disagree. The
 * write is conditional on the row still being `PENDING`: whichever runs
 * first moves it, and a retried or duplicated event, or the other path,
 * finds it moved on (`unchanged`). `no-period` means no row has those ids:
 * never written, or gone with its deleted user (periods cascade).
 */
export const settleCheckout = async (
  periodId: string | null,
  checkoutId: string,
  checkout: CheckoutState,
): Promise<SettleOutcome> => {
  if (!periodId) return "no-period";
  const where = { id: periodId, stripeCheckoutSessionId: checkoutId };
  if (checkout.state === "open") return (await periodExists(where)) ? "open" : "no-period";

  const data =
    checkout.state === "paid"
      ? {
          status: "PAID" as const,
          vendorCustomerId: checkout.period.customerId,
          vendorSubscriptionId: checkout.period.subscriptionId,
          stripePriceId: checkout.period.stripePriceId,
          interval: checkout.period.interval,
          periodStart: checkout.period.periodStart,
          periodEnd: checkout.period.periodEnd,
        }
      : { status: "EXPIRED" as const };

  const { count } = await prisma.subscriptionPeriod.updateMany({ where: { ...where, status: "PENDING" }, data });
  if (count > 0) return checkout.state;
  return (await periodExists(where)) ? "unchanged" : "no-period";
};

const periodExists = async (where: { id: string; stripeCheckoutSessionId: string }) =>
  (await prisma.subscriptionPeriod.findFirst({ where, select: { id: true } })) !== null;

/**
 * The user's billing, for the user session: checked with the vendor once,
 * then answered from the stored rows. Run by `getUserSession()`, so on a full
 * page load, not on navigation.
 *
 * One vendor call at most, about the user's latest record:
 * 1. The newest `PENDING` period with a checkout id: its checkout is fetched
 *    and settled (paid → `PAID`, expired → `EXPIRED`), as the webhook does.
 * 2. Else the newest period with a vendor customer, live or not: the vendor
 *    is asked for the customer's active subscription, and a period it reports
 *    that isn't stored yet (a renewal) is recorded as a new `PAID` row.
 * 3. A user with neither (Free, or granted-only) costs no call.
 *
 * The check obeys the `billingCheck` rate limit and `SESSION_VENDOR_LIMITS`,
 * and a vendor error, a timeout or missing settings is logged and skipped:
 * either way the stored rows answer.
 * A live period keeps Pro; nothing is granted that the vendor didn't confirm.
 *
 * Known gap: `resetProfile()` after a server action also re-renders the
 * layout, so saves run this check too. The rate limit caps that; past it,
 * the stored rows answer, as they would anyway.
 */
export const resolveBilling = async (userId: string): Promise<BillingStatus> => {
  try {
    await checkWithVendor(userId);
  } catch (error) {
    console.error("Billing check failed; answering from stored periods:", error);
  }
  return storedStatus(userId);
};

const checkWithVendor = async (userId: string) => {
  const pending = await prisma.subscriptionPeriod.findFirst({
    where: { userId, status: "PENDING", vendor: { not: null }, stripeCheckoutSessionId: { not: null } },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true, vendor: true, stripeCheckoutSessionId: true },
  });
  // Only a paid row has a customer: settling is what writes it.
  const customer = pending
    ? null
    : await prisma.subscriptionPeriod.findFirst({
        where: { userId, vendor: { not: null }, vendorCustomerId: { not: null } },
        orderBy: [{ createdAt: "desc" }],
        select: { vendor: true, vendorCustomerId: true },
      });
  if (!pending && !customer) return;

  // Per user alone (`perIp: false`): reloading can't spend Stripe's rate limit.
  const limit = await checkRateLimit("billingCheck", await headers(), userId);
  if (!limit.success) return;

  if (pending?.vendor && pending.stripeCheckoutSessionId) {
    const checkout = await adapterFor(pending.vendor).fetchCheckout(pending.stripeCheckoutSessionId, SESSION_VENDOR_LIMITS);
    await settleCheckout(pending.id, pending.stripeCheckoutSessionId, checkout);
  }
  // Never looked up when a pending checkout was: one vendor call per load.
  if (customer?.vendor && customer.vendorCustomerId) {
    const period = await adapterFor(customer.vendor).fetchActivePeriod(customer.vendorCustomerId, SESSION_VENDOR_LIMITS);
    if (period) await recordRenewal(userId, period);
  }
};

/**
 * Inserts a period the vendor reports unless it is stored already, matched on
 * the vendor's subscription and period end. Serializable, so two loads at
 * once can't both see "not stored" and insert. Known race the fake can't
 * model: under Serializable the loser fails with P2034, or past the check it
 * hits the `[vendor, vendorSubscriptionId, periodEnd]` unique key (P2002).
 * Either means the other load recorded it, so both count as done.
 */
const recordRenewal = async (userId: string, period: PaidPeriod) => {
  try {
    await prisma.$transaction(
      async (tx) => {
        const stored = await tx.subscriptionPeriod.findFirst({
          where: { vendor: period.vendor, vendorSubscriptionId: period.subscriptionId, periodEnd: period.periodEnd },
          select: { id: true },
        });
        if (stored) return;
        await tx.subscriptionPeriod.create({
          data: {
            userId,
            status: "PAID",
            vendor: period.vendor,
            vendorCustomerId: period.customerId,
            vendorSubscriptionId: period.subscriptionId,
            stripePriceId: period.stripePriceId,
            interval: period.interval,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
          },
        });
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (isRecordedByAnother(error)) return;
    throw error;
  }
};

const isRecordedByAnother = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2002" || error.code === "P2034");

/** The billing the stored rows give: Pro while a `PAID` period is live, as `getCurrentUser()` decides. */
const storedStatus = async (userId: string): Promise<BillingStatus> => {
  const [live, customer] = await Promise.all([
    prisma.subscriptionPeriod.findFirst({
      where: { userId, status: "PAID", periodEnd: { gte: liveSince() } },
      orderBy: [{ periodEnd: "desc" }],
      select: { interval: true, periodEnd: true },
    }),
    prisma.subscriptionPeriod.findFirst({ where: { userId, vendorCustomerId: { not: null } }, select: { id: true } }),
  ]);
  const isCustomer = customer !== null;
  return live
    ? { plan: "PRO", interval: live.interval, periodEnd: live.periodEnd, isCustomer }
    : { plan: "FREE", interval: null, periodEnd: null, isCustomer };
};


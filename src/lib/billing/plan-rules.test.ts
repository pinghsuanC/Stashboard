import { describe, expect, it } from "vitest";

import { BILLING_GRACE_MS } from "@/lib/constants/billing";
import { PRO_TYPE_NAMES } from "@/lib/constants/item-types";
import { COLLECTION_LIMIT_REACHED, ITEM_LIMIT_REACHED } from "@/lib/constants/messages/billing";
import { PRICING } from "@/lib/constants/pricing";

import { canCreateCollection, canCreateItem, canUseAi, canUseType, liveSince, subscriptionState } from "./plan-rules";

const now = new Date("2026-05-10T12:00:00Z");

// How a `PAID` period's end is matched: `periodEnd >= liveSince(now)`.
const isLive = (periodEnd: Date) => periodEnd.getTime() >= liveSince(now).getTime();

describe("when a paid period is live (R3)", () => {
  it("is live before its end", () => {
    expect(isLive(new Date(now.getTime() + 1))).toBe(true);
  });

  it("stays live through the grace window after its end", () => {
    expect(isLive(new Date(now.getTime() - BILLING_GRACE_MS / 2))).toBe(true);
  });

  it("is live at the last instant of the grace window", () => {
    expect(isLive(new Date(now.getTime() - BILLING_GRACE_MS))).toBe(true);
  });

  it("is not live a millisecond after the grace window", () => {
    expect(isLive(new Date(now.getTime() - BILLING_GRACE_MS - 1))).toBe(false);
  });

  it("measures from the current time when none is given", () => {
    const before = Date.now();
    const since = liveSince().getTime();

    expect(since).toBeGreaterThanOrEqual(before - BILLING_GRACE_MS);
    expect(since).toBeLessThanOrEqual(Date.now() - BILLING_GRACE_MS);
  });
});

describe("a past subscription's state on the billing page (P9)", () => {
  const at = (offsetMs: number) => new Date(now.getTime() + offsetMs);

  it("is active while live, grace window included", () => {
    expect(subscriptionState({ periodEnd: at(1) }, now)).toBe("active");
    expect(subscriptionState({ periodEnd: at(-BILLING_GRACE_MS) }, now)).toBe("active");
  });

  it("has ended once past the grace window", () => {
    expect(subscriptionState({ periodEnd: at(-BILLING_GRACE_MS - 1) }, now)).toBe("ended");
  });

  it("has ended when it has no end date, as no live check would match it", () => {
    expect(subscriptionState({ periodEnd: null }, now)).toBe("ended");
  });
});

describe("Free plan limits (Billing 2: R1–R4)", () => {
  const { itemLimit, collectionLimit } = PRICING.free;

  it("R1: a Free user may create items up to the limit, and not one more", () => {
    expect(canCreateItem("FREE", itemLimit - 1)).toBe(true);
    expect(canCreateItem("FREE", itemLimit)).toBe(false);
    expect(canCreateItem("FREE", itemLimit + 5)).toBe(false);
  });

  it("R2: a Free user may create collections up to the limit, and not one more", () => {
    expect(canCreateCollection("FREE", collectionLimit - 1)).toBe(true);
    expect(canCreateCollection("FREE", collectionLimit)).toBe(false);
  });

  it("R3: a Free user can't use the Pro types; every other type is open", () => {
    for (const typeName of PRO_TYPE_NAMES) expect(canUseType("FREE", typeName)).toBe(false);
    expect(canUseType("FREE", "snippet")).toBe(true);
    expect(canUseType("FREE", "link")).toBe(true);
  });

  it("AI features are Pro only", () => {
    expect(canUseAi("FREE")).toBe(false);
    expect(canUseAi("PRO")).toBe(true);
  });

  it("R4: Pro has none of these limits", () => {
    expect(canCreateItem("PRO", itemLimit * 10)).toBe(true);
    expect(canCreateCollection("PRO", collectionLimit * 10)).toBe(true);
    for (const typeName of PRO_TYPE_NAMES) expect(canUseType("PRO", typeName)).toBe(true);
  });
});

describe("limit messages derive their numbers from PRICING (R4)", () => {
  it("names the item and collection limits", () => {
    expect(ITEM_LIMIT_REACHED).toContain(String(PRICING.free.itemLimit));
    expect(COLLECTION_LIMIT_REACHED).toContain(String(PRICING.free.collectionLimit));
  });
});

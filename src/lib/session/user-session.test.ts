import { refresh } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { DAY_MS } from "@/lib/constants/time";
import { hasAiCredits } from "@/services/ai/openai";
import { fakeAdapter, paidPeriod, resetFakeBilling } from "@/test/fake-billing";
import { db, resetDb } from "@/test/fake-prisma";

import { getUserSession, resetProfile } from "./user-session";

// Next's redirect() works by throwing; the tests read the target off the error.
class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
// The JWT: only the user id. Everything else is read from the database.
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/services/prisma", async () => ({ prisma: (await import("@/test/fake-prisma")).fakePrisma }));
// The billing check runs for real; only the vendor and the rate limit are stood in for.
vi.mock("@/services/billing/vendors", async () => (await import("@/test/fake-billing")).fakeVendors);
vi.mock("@/services/rate-limit", () => ({
  checkRateLimit: async () => ({ success: true, remaining: 1, reset: Date.now() }),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/services/ai/openai", () => ({ hasAiCredits: vi.fn() }));

const signedInAs = (userId: string | null) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- auth() is overloaded; the session shape is all that matters
  vi.mocked(auth as any).mockResolvedValue(userId ? { user: { id: userId } } : null);

/** Runs something that should redirect and returns the target path, without the query. */
const redirectPathOf = async (run: () => Promise<unknown>) => {
  const error = await run().then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(RedirectError);
  return new URL((error as RedirectError).url, "http://app.test").pathname;
};

const day = (n: number) => new Date(Date.UTC(2026, 0, n));

beforeEach(() => {
  resetDb();
  resetFakeBilling();
  vi.mocked(refresh).mockClear();
  vi.mocked(hasAiCredits).mockReset().mockResolvedValue(true);
  db.users.push(
    {
      id: "ada",
      name: "Ada",
      email: "ada@example.test",
      image: null,
      passwordHash: "$2b$secret-hash",
      editorPreferences: { fontSize: 16, theme: "monokai" },
      createdAt: day(1),
    },
    {
      id: "bob",
      name: "Bob",
      email: "bob@example.test",
      image: "https://avatars.example/bob.png",
      passwordHash: null,
      createdAt: day(1),
    },
  );
  // Ada pays through Stripe; Bob has never paid.
  db.subscriptionPeriods.push({
    id: "ada-paid",
    userId: "ada",
    status: "PAID",
    vendor: "STRIPE",
    vendorCustomerId: "cus_secret",
    vendorSubscriptionId: "sub_secret",
    stripeCheckoutSessionId: "cs_secret",
    stripePriceId: "price_secret",
    interval: "MONTH",
    periodStart: new Date(Date.now() - 10 * DAY_MS),
    periodEnd: new Date(Date.now() + 20 * DAY_MS),
  });
  // Seeded out of display order on purpose; display order is createdAt, then
  // name. Link is added before Command on the same day so the name tie-break
  // is what puts Command first.
  db.itemTypes.push(
    { id: "t-note", name: "note", label: "Note", icon: "StickyNote", color: "#fde047", isSystem: true, userId: null, createdAt: day(3) },
    { id: "t-snippet", name: "snippet", label: "Snippet", icon: "Code", color: "#3b82f6", isSystem: true, userId: null, createdAt: day(1) },
    { id: "t-link", name: "link", label: "Link", icon: "Link", color: "#10b981", isSystem: true, userId: null, createdAt: day(2) },
    { id: "t-command", name: "command", label: "Command", icon: "Terminal", color: "#f97316", isSystem: true, userId: null, createdAt: day(2) },
    // Not system types for everyone: a Pro user's own type, and a stray row
    // flagged isSystem but owned by a user.
    { id: "t-ada-recipe", name: "recipe", label: "Recipe", icon: null, color: "#000000", isSystem: false, userId: "ada", createdAt: day(1) },
    { id: "t-ada-flagged", name: "flagged", label: "Flagged", icon: null, color: "#000000", isSystem: true, userId: "ada", createdAt: day(1) },
  );
});

describe("user session: profile (S1)", () => {
  it("holds the signed-in user's profile", async () => {
    signedInAs("ada");

    const { user } = await getUserSession();

    expect(user).toEqual({
      id: "ada",
      name: "Ada",
      email: "ada@example.test",
      image: null,
      plan: "PRO",
      isPro: true,
      editorPreferences: { fontSize: 16, tabSize: 2, wordWrap: true, minimap: false, theme: "monokai" },
      createdAt: day(1),
      hasPassword: true,
    });
  });

  it("says whether the user can sign in with a password, for the change-password form", async () => {
    signedInAs("bob");

    expect((await getUserSession()).user.hasPassword).toBe(false);
  });

  it("marks a free user as not Pro", async () => {
    signedInAs("bob");

    expect((await getUserSession()).user.isPro).toBe(false);
  });

  it("never carries the password hash or billing ids to the client (R7)", async () => {
    signedInAs("ada");

    const serialized = JSON.stringify(await getUserSession());

    expect(serialized).not.toContain("$2b$secret-hash");
    expect(serialized).not.toContain("cus_secret");
    expect(serialized).not.toContain("sub_secret");
    expect(serialized).not.toContain("cs_secret");
    expect(serialized).not.toContain("price_secret");
  });
});

describe("user session: item types (S2)", () => {
  it("lists only the global system types, in display order, with their routes", async () => {
    signedInAs("ada");

    const { itemTypes } = await getUserSession();

    expect(itemTypes).toEqual([
      { id: "t-snippet", name: "snippet", label: "Snippet", icon: "Code", color: "#3b82f6", route: "/items/snippets" },
      { id: "t-command", name: "command", label: "Command", icon: "Terminal", color: "#f97316", route: "/items/commands" },
      { id: "t-link", name: "link", label: "Link", icon: "Link", color: "#10b981", route: "/items/links" },
      { id: "t-note", name: "note", label: "Note", icon: "StickyNote", color: "#fde047", route: "/items/notes" },
    ]);
  });

  it("keeps counts off the type definitions: they live in itemCounts, kept up separately", async () => {
    signedInAs("ada");
    db.items.push({ id: "i1", userId: "ada", typeId: "t-snippet" });

    const { itemTypes } = await getUserSession();

    for (const type of itemTypes) expect(Object.keys(type)).not.toContain("itemCount");
  });
});

describe("user session: auth guard (S4)", () => {
  it("sends a signed-out request to sign-in", async () => {
    signedInAs(null);

    expect(await redirectPathOf(getUserSession)).toBe("/sign-in");
  });

  it("sends a valid token for a deleted user to sign-in", async () => {
    signedInAs("ghost");

    expect(await redirectPathOf(getUserSession)).toBe("/sign-in");
  });
});

describe("user session: item counts, pinned items and collections (S3)", () => {
  beforeEach(() => {
    // The note joins the React collection first, so ranking by use (two
    // snippets) has to move Snippet ahead of first-seen order.
    db.items.push(
      { id: "a3", userId: "ada", typeId: "t-note", title: "Alpha", isPinned: true, updatedAt: day(7), collectionIds: ["c-react"] },
      {
        id: "a1",
        userId: "ada",
        typeId: "t-snippet",
        title: "useAuth hook",
        description: "Auth context hook",
        content: "export function useAuth() { /* secret body */ }",
        isPinned: true,
        isFavorite: true,
        createdAt: day(4),
        updatedAt: day(5),
        tags: ["react", "auth", "hooks"],
        collectionIds: ["c-react"],
      },
      { id: "a2", userId: "ada", typeId: "t-snippet", title: "Beta", isPinned: true, updatedAt: day(7), collectionIds: ["c-react"] },
      { id: "a4", userId: "ada", typeId: "t-link", title: "Unpinned", isFavorite: true, updatedAt: day(9), collectionIds: ["c-react"] },
      { id: "b1", userId: "bob", typeId: "t-note", title: "Bob's", isPinned: true, isFavorite: true, updatedAt: day(4), collectionIds: ["c-bob"] },
    );
    db.collections.push(
      { id: "c-react", userId: "ada", name: "React", slug: "react", description: null, isFavorite: true, updatedAt: day(6) },
      { id: "c-empty", userId: "ada", name: "Empty", slug: "empty", description: "Nothing yet", isFavorite: false, updatedAt: day(2) },
      { id: "c-bob", userId: "bob", name: "Bob's", slug: "bobs", description: null, isFavorite: false, updatedAt: day(6) },
    );
  });

  it("holds the signed-in user's item counts: total, favorites and per type", async () => {
    signedInAs("ada");

    const { itemCounts } = await getUserSession();

    expect(itemCounts).toEqual({
      total: 4,
      favorites: 2,
      byType: { "t-snippet": 2, "t-note": 1, "t-link": 1 },
    });
  });

  it("holds every pinned item of the user, newest first, the title breaking ties", async () => {
    signedInAs("ada");

    const { pinnedItems } = await getUserSession();

    expect(pinnedItems.map((item) => item.id)).toEqual(["a3", "a2", "a1"]);
    expect(pinnedItems.find((item) => item.id === "a1")).toEqual({
      id: "a1",
      title: "useAuth hook",
      description: "Auth context hook",
      isPinned: true,
      isFavorite: true,
      createdAt: day(4),
      updatedAt: day(5),
      fileName: null,
      fileSize: null,
      tags: ["auth", "hooks", "react"],
      hasFile: false,
      type: { id: "t-snippet", name: "snippet", label: "Snippet", icon: "Code", color: "#3b82f6" },
    });
  });

  it("does not hold recent items: the dashboard fetches those per visit", async () => {
    signedInAs("ada");

    const session = await getUserSession();

    expect(Object.keys(session).sort()).toEqual(
      ["aiAvailable", "billing", "collections", "itemCounts", "itemTypes", "pinnedItems", "searchItems", "user"],
    );
  });

  it("AI1: a Pro user has AI while the account has credits", async () => {
    signedInAs("ada");
    vi.mocked(hasAiCredits).mockResolvedValue(true);

    expect((await getUserSession()).aiAvailable).toBe(true);
  });

  it("AI2: a Pro user loses AI when the credits run out", async () => {
    signedInAs("ada");
    vi.mocked(hasAiCredits).mockResolvedValue(false);

    expect((await getUserSession()).aiAvailable).toBe(false);
  });

  it("AI3: a Free user has no AI, and costs no credit check", async () => {
    signedInAs("bob");
    vi.mocked(hasAiCredits).mockResolvedValue(true);

    expect((await getUserSession()).aiAvailable).toBe(false);
    expect(hasAiCredits).not.toHaveBeenCalled();
  });

  it("GS1: holds the user's items for the search palette, newest first, never another user's", async () => {
    signedInAs("ada");

    const { searchItems } = await getUserSession();

    expect(searchItems.map((item) => item.id)).toEqual(["a4", "a3", "a2", "a1"]);
    expect(searchItems.find((item) => item.id === "a1")).toMatchObject({
      title: "useAuth hook",
      description: "Auth context hook",
      tags: ["auth", "hooks", "react"],
      type: { label: "Snippet", icon: "Code" },
    });
  });

  it("leaves item bodies out", async () => {
    signedInAs("ada");

    expect(JSON.stringify(await getUserSession())).not.toContain("secret body");
  });

  it("holds every collection of the user, with its item count and types ranked by use", async () => {
    signedInAs("ada");

    const { collections } = await getUserSession();

    expect(collections).toHaveLength(2);
    expect(collections.find((collection) => collection.id === "c-react")).toEqual({
      id: "c-react",
      name: "React",
      slug: "react",
      description: null,
      isFavorite: true,
      updatedAt: day(6),
      itemCount: 4,
      types: [
        { id: "t-snippet", name: "snippet", label: "Snippet", icon: "Code", color: "#3b82f6" },
        { id: "t-note", name: "note", label: "Note", icon: "StickyNote", color: "#fde047" },
        { id: "t-link", name: "link", label: "Link", icon: "Link", color: "#10b981" },
      ],
    });
    expect(collections.find((collection) => collection.id === "c-empty")).toMatchObject({
      itemCount: 0,
      types: [],
    });
  });
});

describe("user session: freshness and isolation (S7)", () => {
  it("shows a profile edit on the next request instead of a stale copy", async () => {
    signedInAs("ada");
    await getUserSession();
    db.users[0].name = "Ada Lovelace";

    expect((await getUserSession()).user.name).toBe("Ada Lovelace");
  });

  it("counts a new item on the next load instead of a stale number", async () => {
    signedInAs("ada");
    await getUserSession();
    db.items.push({ id: "a9", userId: "ada", typeId: "t-link", title: "New link", updatedAt: day(9) });

    expect((await getUserSession()).itemCounts.byType["t-link"]).toBe(1);
  });

  it("never hands one user's session to another", async () => {
    signedInAs("ada");
    await getUserSession();
    signedInAs("bob");

    const { user } = await getUserSession();

    expect(user.id).toBe("bob");
    expect(user.email).toBe("bob@example.test");
    expect(user.hasPassword).toBe(false);
  });
});

describe("server-side reset (S6)", () => {
  it("re-renders the current route so the layout reads a fresh session", () => {
    resetProfile();

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("user session: billing (Billing 2: R19)", () => {
  it("holds the user's billing: plan, interval, period end and whether they're a customer", async () => {
    signedInAs("ada");

    const { billing } = await getUserSession();

    expect(billing).toEqual({
      plan: "PRO",
      interval: "MONTH",
      periodEnd: db.subscriptionPeriods[0].periodEnd,
      isCustomer: true,
    });
  });

  it("a user who never paid is Free and no customer, at no Stripe call", async () => {
    signedInAs("bob");

    expect((await getUserSession()).billing).toEqual({ plan: "FREE", interval: null, periodEnd: null, isCustomer: false });
    expect(fakeAdapter.fetchActivePeriod).not.toHaveBeenCalled();
    expect(fakeAdapter.fetchCheckout).not.toHaveBeenCalled();
  });

  it("checks with Stripe once per load", async () => {
    signedInAs("ada");

    await getUserSession();

    expect(fakeAdapter.fetchActivePeriod).toHaveBeenCalledOnce();
    expect(fakeAdapter.fetchActivePeriod).toHaveBeenCalledWith("cus_secret");
  });

  it("a payment settled by this load makes the session's user Pro on this load", async () => {
    signedInAs("bob");
    db.subscriptionPeriods.push({ id: "bob-pending", userId: "bob", status: "PENDING", vendor: "STRIPE", interval: "YEAR", stripeCheckoutSessionId: "cs_bob" });
    fakeAdapter.fetchCheckout.mockResolvedValue({ state: "paid", period: paidPeriod({ customerId: "cus_bob", interval: "YEAR" }) });

    const { user, billing } = await getUserSession();

    expect(billing).toMatchObject({ plan: "PRO", interval: "YEAR", isCustomer: true });
    expect(user).toMatchObject({ plan: "PRO", isPro: true });
  });
});

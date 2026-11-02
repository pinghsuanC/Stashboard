import { compare, hash } from "bcryptjs";
import { CredentialsSignin } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { signIn, signOut } from "@/auth";
import { signInHref } from "@/lib/auth/auth-redirect";
import { requireCurrentUser, requireCurrentUserId } from "@/services/auth/session";
import { BILLING_CANCEL_FAILED } from "@/lib/constants/messages/billing";
import { checkRateLimit } from "@/services/rate-limit";
import { fakeAdapter, resetFakeBilling } from "@/test/fake-billing";
import { db, resetDb } from "@/test/fake-prisma";
import { resetStorage, storage, upload } from "@/test/fake-storage";

import { changePasswordAction, deleteAccountAction, updateEditorPreferences } from "./account";

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
  unstable_rethrow: (error: unknown) => {
    if (error instanceof RedirectError) throw error;
  },
}));
// Both redirect on success, as Auth.js does from a server action.
vi.mock("@/auth", () => ({
  signIn: vi.fn(async (_provider: string, { redirectTo }: { redirectTo: string }) => {
    throw new RedirectError(redirectTo);
  }),
  signOut: vi.fn(async ({ redirectTo }: { redirectTo?: string }) => {
    if (redirectTo) throw new RedirectError(redirectTo);
  }),
}));
vi.mock("@/services/auth/session", () => ({
  requireCurrentUser: vi.fn(),
  requireCurrentUserId: vi.fn(),
}));
vi.mock("@/services/prisma", async () => ({ prisma: (await import("@/test/fake-prisma")).fakePrisma }));
vi.mock("@/services/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("@/services/billing/vendors", async () => (await import("@/test/fake-billing")).fakeVendors);
vi.mock("@/services/storage", async () => (await import("@/test/fake-storage")).fakeStorage);
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.1.1.1" }) }));
// Real bcrypt at the lowest cost.
vi.mock("@/lib/constants/security", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/constants/security")>()),
  BCRYPT_ROUNDS: 4,
}));
const log = vi.spyOn(console, "error").mockImplementation(() => {});

const OLD_PASSWORD = "old-password-1";
const NEW_PASSWORD = "new-password-2";

const signedInAs = (userId: string) => {
  vi.mocked(requireCurrentUserId).mockResolvedValue(userId);
  const user = db.users.find((row) => row.id === userId)!;
  vi.mocked(requireCurrentUser).mockResolvedValue({
    ...user,
    image: null,
    plan: "FREE",
    isPro: false,
    editorPreferences: { fontSize: 12, tabSize: 2, wordWrap: true, minimap: false, theme: "vs-dark" },
    hasPassword: user.passwordHash !== null,
  });
};

const signedOut = () => {
  const toSignIn = async (): Promise<never> => {
    throw new RedirectError("/sign-in");
  };
  vi.mocked(requireCurrentUserId).mockImplementation(toSignIn);
  vi.mocked(requireCurrentUser).mockImplementation(toSignIn);
};

const addUser = async (id: string, password: string | null) => {
  const user = {
    id,
    name: id,
    email: `${id}@example.test`,
    passwordHash: password ? await hash(password, 4) : null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };
  db.users.push(user);
  return user;
};

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const passwordForm = (overrides: Record<string, string> = {}) =>
  form({
    currentPassword: OLD_PASSWORD,
    password: NEW_PASSWORD,
    confirmPassword: NEW_PASSWORD,
    ...overrides,
  });

/** Runs an action that should redirect and returns where it went. */
const redirectOf = async (run: () => Promise<unknown>) => {
  const error = await run().then(
    () => null,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(RedirectError);
  return (error as RedirectError).url;
};

const storedHash = (id: string) => db.users.find((user) => user.id === id)?.passwordHash;
const storedVersion = (id: string) => db.users.find((user) => user.id === id)?.sessionVersion ?? 0;

beforeEach(() => {
  resetDb();
  resetStorage();
  log.mockClear();
  vi.mocked(requireCurrentUserId).mockReset();
  vi.mocked(requireCurrentUser).mockReset();
  vi.mocked(signIn).mockClear();
  vi.mocked(signOut).mockClear();
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ success: true, remaining: 1, reset: Date.now() });
});

describe("change password", () => {
  beforeEach(async () => {
    await addUser("ada", OLD_PASSWORD);
    signedInAs("ada");
  });

  it("R4: stores the new password, retires the old one, and returns to settings with the toast flag", async () => {
    const url = await redirectOf(() => changePasswordAction({}, passwordForm()));

    expect(url).toBe("/settings?password=changed");
    const hashAfter = storedHash("ada")!;
    expect(await compare(NEW_PASSWORD, hashAfter)).toBe(true);
    expect(await compare(OLD_PASSWORD, hashAfter)).toBe(false);
  });

  it("R3: rejects a wrong current password on that field and leaves the password unchanged", async () => {
    const before = storedHash("ada");

    const state = await changePasswordAction({}, passwordForm({ currentPassword: "not-it-123" }));

    expect(state.fieldErrors?.currentPassword).toBeTruthy();
    expect(storedHash("ada")).toBe(before);
  });

  it("R1: reports invalid input per field without touching the stored password", async () => {
    const before = storedHash("ada");

    const state = await changePasswordAction(
      {},
      passwordForm({ password: "short", confirmPassword: "short" }),
    );

    expect(state.fieldErrors?.password).toBeTruthy();
    expect(storedHash("ada")).toBe(before);
  });

  it("R2: refuses a GitHub-only account, which has no password to change", async () => {
    await addUser("octo", null);
    signedInAs("octo");

    const state = await changePasswordAction({}, passwordForm());

    // The reason, not a generic failure: "something went wrong" would also
    // appear if the missing hash merely crashed the comparison.
    expect(state.error).toMatch(/github/i);
    expect(storedHash("octo")).toBeNull();
  });

  it("R5: sends a signed-out caller to sign-in and changes nothing", async () => {
    signedOut();
    const before = storedHash("ada");

    const url = await redirectOf(() => changePasswordAction({}, passwordForm()));

    expect(url).toBe("/sign-in");
    expect(storedHash("ada")).toBe(before);
  });

  it("R6: answers a database failure with a message instead of throwing", async () => {
    db.down = true;

    const state = await changePasswordAction({}, passwordForm());

    expect(state.error).toMatch(/something went wrong/i);
  });

  it("R8: signs out every existing session by bumping the stored session version", async () => {
    await redirectOf(() => changePasswordAction({}, passwordForm()));

    expect(storedVersion("ada")).toBe(1);
  });

  it("R8: a wrong current password signs nobody out", async () => {
    await changePasswordAction({}, passwordForm({ currentPassword: "not-it-123" }));

    expect(storedVersion("ada")).toBe(0);
  });

  it("R8: keeps this device signed in by signing in again with the new password", async () => {
    await redirectOf(() => changePasswordAction({}, passwordForm()));

    expect(signIn).toHaveBeenCalledWith("credentials", {
      email: "ada@example.test",
      password: NEW_PASSWORD,
      redirectTo: "/settings?password=changed",
    });
  });

  it("R8: when signing back in is refused, sends the user to sign in and back to settings", async () => {
    vi.mocked(signIn).mockRejectedValueOnce(new CredentialsSignin());

    const url = await redirectOf(() => changePasswordAction({}, passwordForm()));

    expect(url).toBe(signInHref("/settings?password=changed"));
    expect(await compare(NEW_PASSWORD, storedHash("ada")!)).toBe(true);
  });

  it("R9: cancels the user's outstanding reset links, and no one else's", async () => {
    await addUser("bob", OLD_PASSWORD);
    db.passwordResetTokens.push(
      { email: "ada@example.test", token: "r-ada" },
      { email: "bob@example.test", token: "r-bob" },
    );

    await redirectOf(() => changePasswordAction({}, passwordForm()));

    expect(db.passwordResetTokens.map((token) => token.token)).toEqual(["r-bob"]);
  });

  // A stolen session cookie must not get unlimited guesses at the password.
  it("R10: over the limit, answers with the wait as a toast and neither checks nor changes the password", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 10 * 60_000 });
    const before = storedHash("ada");

    const state = await changePasswordAction({}, passwordForm());

    expect(state.toast).toMatch(/too many attempts/i);
    expect(state.fieldErrors).toBeUndefined();
    expect(storedHash("ada")).toBe(before);
    expect(storedVersion("ada")).toBe(0);
  });

  it("R10: counts tries per signed-in user, whatever the IP", async () => {
    await changePasswordAction({}, passwordForm({ currentPassword: "not-it-123" }));

    expect(checkRateLimit).toHaveBeenCalledWith("changePassword", expect.any(Headers), "ada");
  });

  it("R10: invalid input doesn't use up a try", async () => {
    await changePasswordAction({}, passwordForm({ password: "short", confirmPassword: "short" }));

    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("delete account", () => {
  beforeEach(async () => {
    resetFakeBilling();
    const ada = await addUser("ada", OLD_PASSWORD);
    const bob = await addUser("bob", OLD_PASSWORD);
    db.itemTypes.push({ id: "snippet", userId: null });
    db.items.push(
      { id: "ada-1", userId: "ada", typeId: "snippet" },
      { id: "bob-1", userId: "bob", typeId: "snippet" },
    );
    db.collections.push({ id: "ada-c", userId: "ada" }, { id: "bob-c", userId: "bob" });
    db.subscriptionPeriods.push(
      { id: "ada-p", userId: "ada", interval: "MONTH", periodEnd: new Date(Date.UTC(2099, 0, 1)) },
      { id: "bob-p", userId: "bob", interval: "YEAR", periodEnd: new Date(Date.UTC(2099, 0, 1)) },
    );
    db.verificationTokens.push(
      { identifier: ada.email, token: "v-ada" },
      { identifier: bob.email, token: "v-bob" },
    );
    db.passwordResetTokens.push(
      { email: ada.email, token: "r-ada" },
      { email: bob.email, token: "r-bob" },
    );
    signedInAs("ada");
  });

  it("R7: removes the user with their data and email-keyed tokens", async () => {
    await deleteAccountAction();

    expect(db.users.map((user) => user.id)).toEqual(["bob"]);
    expect(db.items.map((item) => item.id)).toEqual(["bob-1"]);
    expect(db.collections.map((collection) => collection.id)).toEqual(["bob-c"]);
    expect(db.subscriptionPeriods.map((period) => period.id)).toEqual(["bob-p"]);
    expect(db.verificationTokens.map((token) => token.token)).toEqual(["v-bob"]);
    expect(db.passwordResetTokens.map((token) => token.token)).toEqual(["r-bob"]);
  });

  it("R7: deletes a Pro user whose custom types still have items", async () => {
    db.itemTypes.push({ id: "ada-recipe", userId: "ada" });
    db.items.push({ id: "ada-2", userId: "ada", typeId: "ada-recipe" });

    await deleteAccountAction();

    expect(db.users.some((user) => user.id === "ada")).toBe(false);
    expect(db.itemTypes.map((type) => type.id)).toEqual(["snippet"]);
  });

  it("R7: deletes only the signed-in user, whatever the request carries", async () => {
    // useActionState calls it with (state, formData); a tampered form names bob.
    const submit = deleteAccountAction as (...args: unknown[]) => Promise<unknown>;
    await submit({}, form({ userId: "bob", id: "bob", email: "bob@example.test" }));

    expect(db.users.map((user) => user.id)).toEqual(["bob"]);
  });

  // A redirect from the action is followed on the server, so the browser would
  // never see the signed-out route's Clear-Site-Data; the dialog navigates.
  it("R11: ends the session without redirecting, and hands the dialog the signed-out route with the deleted flag", async () => {
    const state = await deleteAccountAction();

    expect(signOut).toHaveBeenCalledWith({ redirect: false });
    expect(state).toEqual({ leaveTo: "/api/auth/signed-out?deleted=1" });
  });

  it("R11: signs out only after the delete, never before", async () => {
    vi.mocked(signOut).mockImplementationOnce(async () => {
      expect(db.users.some((user) => user.id === "ada")).toBe(false);
    });

    await deleteAccountAction();

    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("R6/R7: on a database failure, keeps the user signed in and returns a message", async () => {
    db.down = true;

    const state = await deleteAccountAction();

    expect(state.error).toMatch(/something went wrong/i);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("R5: sends a signed-out caller to sign-in and deletes nothing", async () => {
    signedOut();

    const url = await redirectOf(() => deleteAccountAction());

    expect(url).toBe("/sign-in");
    expect(db.users).toHaveLength(2);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("delete account: stored files go too (CR2)", () => {
  const LEFT_THE_APP = { leaveTo: "/api/auth/signed-out?deleted=1" };
  const stored = () => [...storage.objects.keys()].sort();

  beforeEach(async () => {
    resetFakeBilling();
    await addUser("ada", OLD_PASSWORD);
    await addUser("bob", OLD_PASSWORD);
    upload("users/ada/one.png", "a");
    // No row points at this one: the bucket is what's cleared, not the items.
    upload("users/ada/orphan.pdf", "b");
    upload("users/bob/keep.png", "c");
    signedInAs("ada");
  });

  it("deletes everything in the user's folder and nobody else's", async () => {
    expect(await deleteAccountAction()).toEqual(LEFT_THE_APP);

    expect(stored()).toEqual(["users/bob/keep.png"]);
    expect(log).not.toHaveBeenCalled();
  });

  it("happens only after the rows commit: a failed delete keeps the files", async () => {
    db.down = true;

    await deleteAccountAction();

    expect(stored()).toEqual(["users/ada/one.png", "users/ada/orphan.pdf", "users/bob/keep.png"]);
  });

  it("a kept account keeps its files when Stripe fails", async () => {
    db.subscriptionPeriods.push({
      id: "p",
      userId: "ada",
      vendor: "STRIPE",
      vendorCustomerId: "cus_ada",
      interval: "MONTH",
      periodEnd: new Date(Date.UTC(2099, 0, 1)),
    });
    fakeAdapter.cancelAll.mockRejectedValueOnce(new Error("Stripe down"));

    await deleteAccountAction();

    expect(stored()).toHaveLength(3);
  });

  it("an object that won't delete is logged by key, the rest go, and the user still leaves", async () => {
    storage.undeletable.add("users/ada/one.png");

    expect(await deleteAccountAction()).toEqual(LEFT_THE_APP);

    expect(stored()).toEqual(["users/ada/one.png", "users/bob/keep.png"]);
    expect(log).toHaveBeenCalledWith(expect.any(String), ["users/ada/one.png"]);
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("an unreachable bucket is logged, and the rows being gone still ends the session", async () => {
    storage.down = true;

    expect(await deleteAccountAction()).toEqual(LEFT_THE_APP);

    expect(log).toHaveBeenCalledOnce();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it("a bucket that isn't configured is the same", async () => {
    storage.unconfigured = true;

    expect(await deleteAccountAction()).toEqual(LEFT_THE_APP);
    expect(log).toHaveBeenCalledOnce();
  });
});

describe("delete account: subscriptions are cancelled first (Billing 2: R22)", () => {
  const paid = (id: string, userId: string, customerId: string, createdAt: number) => ({
    id,
    userId,
    vendor: "STRIPE" as const,
    vendorCustomerId: customerId,
    vendorSubscriptionId: `sub_${id}`,
    interval: "MONTH" as const,
    periodEnd: new Date(Date.UTC(2099, 0, 1)),
    createdAt: new Date(Date.UTC(2026, 0, createdAt)),
  });

  beforeEach(async () => {
    resetFakeBilling();
    await addUser("ada", OLD_PASSWORD);
    await addUser("bob", OLD_PASSWORD);
    db.subscriptionPeriods.push(
      paid("ada-1", "ada", "cus_ada_old", 1),
      paid("ada-2", "ada", "cus_ada_old", 2),
      paid("ada-3", "ada", "cus_ada_new", 3),
      // Granted: no customer to cancel.
      { id: "ada-trial", userId: "ada", interval: "MONTH", periodEnd: new Date(Date.UTC(2099, 0, 1)) },
      paid("bob-1", "bob", "cus_bob", 1),
    );
    signedInAs("ada");
  });

  it("cancels every open subscription of every customer the user paid through, each once, then deletes", async () => {
    const state = await deleteAccountAction();

    expect(fakeAdapter.cancelAll.mock.calls.map(([customerId]) => customerId).sort()).toEqual(["cus_ada_new", "cus_ada_old"]);
    expect(state).toEqual({ leaveTo: "/api/auth/signed-out?deleted=1" });
    expect(db.users.map((user) => user.id)).toEqual(["bob"]);
  });

  it("cancels before deleting: the account still exists while Stripe is asked", async () => {
    fakeAdapter.cancelAll.mockImplementation(async () => {
      expect(db.users.some((user) => user.id === "ada")).toBe(true);
    });

    await deleteAccountAction();

    expect(fakeAdapter.cancelAll).toHaveBeenCalled();
  });

  it("a user who never paid deletes with no Stripe call", async () => {
    db.subscriptionPeriods = db.subscriptionPeriods.filter((period) => period.userId !== "ada" || period.id === "ada-trial");

    await deleteAccountAction();

    expect(fakeAdapter.cancelAll).not.toHaveBeenCalled();
    expect(db.users.map((user) => user.id)).toEqual(["bob"]);
  });

  it("a Stripe failure keeps the account and the session, with a message", async () => {
    fakeAdapter.cancelAll.mockRejectedValueOnce(new Error("Stripe down"));

    expect(await deleteAccountAction()).toEqual({ error: BILLING_CANCEL_FAILED });
    expect(db.users.map((user) => user.id)).toEqual(["ada", "bob"]);
    expect(db.subscriptionPeriods.filter((period) => period.userId === "ada")).toHaveLength(4);
    expect(signOut).not.toHaveBeenCalled();
  });

  it("missing Stripe settings keep the account too: a subscription would go on billing", async () => {
    fakeAdapter.cancelAll.mockRejectedValue(Object.assign(new Error("not configured"), { name: "BillingNotConfiguredError" }));

    expect(await deleteAccountAction()).toEqual({ error: BILLING_CANCEL_FAILED });
    expect(db.users.some((user) => user.id === "ada")).toBe(true);
  });
});

describe("editor preferences", () => {
  const CHOSEN = { fontSize: 16, tabSize: 4, wordWrap: false, minimap: true, theme: "monokai" };
  const stored = (id: string) => db.users.find((user) => user.id === id)?.editorPreferences;

  beforeEach(async () => {
    await addUser("ada", OLD_PASSWORD);
    await addUser("bob", OLD_PASSWORD);
    db.users.find((user) => user.id === "bob")!.editorPreferences = { theme: "github-dark" };
    signedInAs("ada");
  });

  it("EP4: saves the choices on the signed-in user's row and returns them", async () => {
    const result = await updateEditorPreferences(CHOSEN);

    expect(result).toEqual({ success: true, data: CHOSEN });
    expect(stored("ada")).toEqual(CHOSEN);
  });

  it("EP4: never stores keys outside the preferences, and leaves other users alone", async () => {
    await updateEditorPreferences({ ...CHOSEN, userId: "bob", id: "bob" });

    expect(stored("ada")).toEqual(CHOSEN);
    expect(stored("bob")).toEqual({ theme: "github-dark" });
  });

  it("EP4: rejects an option not offered with a field error and stores nothing", async () => {
    const result = await updateEditorPreferences({ ...CHOSEN, theme: "solarized" });

    expect(result.success).toBe(false);
    expect(!result.success && result.error.fieldErrors?.theme).toBeTruthy();
    expect(stored("ada")).toBeUndefined();
  });

  it("EP4: sends a signed-out caller to sign in before reading the input", async () => {
    signedOut();

    expect(await redirectOf(() => updateEditorPreferences({ theme: "solarized" }))).toBe("/sign-in");
    expect(stored("ada")).toBeUndefined();
  });

  it("EP4: answers a database failure with a message", async () => {
    db.down = true;

    const result = await updateEditorPreferences(CHOSEN);

    expect(result).toEqual({ success: false, error: { message: expect.stringMatching(/something went wrong/i) } });
  });
});

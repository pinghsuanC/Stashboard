import { redirect } from "next/navigation";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BYTES_PER_MB } from "@/lib/constants/files";
import { FIELDS_INVALID, SOMETHING_WENT_WRONG } from "@/lib/constants/messages/common";
import {
  FILE_REQUIRED,
  FILE_UPLOAD_UNAVAILABLE,
  fileTooLarge,
  ITEM_COLLECTION_NOT_FOUND,
  ITEM_NOT_FOUND,
  ITEM_TYPE_INVALID,
  ITEM_TITLE_REQUIRED,
  ITEM_URL_REQUIRED,
} from "@/lib/constants/messages/items";
import { ITEM_LIMIT_REACHED, PRO_TYPE_REQUIRED } from "@/lib/constants/messages/billing";
import { PRICING } from "@/lib/constants/pricing";
import { resetProfile } from "@/lib/session/user-session";
import { requireCurrentUserId } from "@/services/auth/session";
import { checkRateLimit } from "@/services/rate-limit";
import { db, resetDb } from "@/test/fake-prisma";
import { signInOnPlan } from "@/test/fake-session";
import { resetStorage, storage, upload } from "@/test/fake-storage";

import { createItem, deleteItem, setItemFavorite, setItemPinned, updateItem } from "./items";

vi.mock("@/services/auth/session", () => ({ requireCurrentUserId: vi.fn(), requireCurrentUser: vi.fn() }));
vi.mock("@/services/prisma", async () => ({ prisma: (await import("@/test/fake-prisma")).fakePrisma }));
// Next's refresh() only works inside a real request; the tests check it was asked for.
vi.mock("@/lib/session/user-session", () => ({ resetProfile: vi.fn() }));
vi.mock("@/services/storage", async () => (await import("@/test/fake-storage")).fakeStorage);
vi.mock("@/services/rate-limit", () => ({ checkRateLimit: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "1.1.1.1" }) }));
vi.spyOn(console, "error").mockImplementation(() => {});

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const itemRow = (id: string) => db.items.find((item) => item.id === id)!;

beforeEach(() => {
  resetDb();
  resetStorage();
  vi.mocked(checkRateLimit).mockReset().mockResolvedValue({ success: true, remaining: 1, reset: Date.now() });
  vi.mocked(resetProfile).mockClear();
  vi.mocked(requireCurrentUserId).mockResolvedValue("ada");
  signInOnPlan("FREE");
  db.itemTypes.push(
    { id: "t-note", name: "note", label: "Notes", icon: "StickyNote", color: "#fde047", isSystem: true, userId: null },
    { id: "t-link", name: "link", label: "Links", icon: "Link", color: "#10b981", isSystem: true, userId: null },
  );
  db.items.push(
    { id: "note", userId: "ada", typeId: "t-note", title: "Standup", content: "old", url: null, updatedAt: day(1), tags: [] },
    { id: "link", userId: "ada", typeId: "t-link", title: "Docs", url: "https://old.dev", updatedAt: day(1), tags: [] },
  );
});

describe("updateItem action: success (A1)", () => {
  it("saves the edit and returns the saved item", async () => {
    const result = await updateItem("note", { title: " Retro ", content: "new", tags: ["team"] });

    expect(result).toEqual({
      success: true,
      data: expect.objectContaining({ id: "note", title: "Retro", content: "new", tags: ["team"] }),
    });
    expect(itemRow("note")).toMatchObject({ title: "Retro", content: "new", tags: ["team"] });
  });

  it("a content-only save, as Use it sends, leaves the tags as they are", async () => {
    await updateItem("note", { title: "Standup", tags: ["team"] });

    await updateItem("note", { title: "Standup", description: "", content: "optimized" });

    expect(itemRow("note")).toMatchObject({ content: "optimized", tags: ["team"] });
  });

  it("refreshes the page and session so lists and pinned items show the edit", async () => {
    await updateItem("note", { title: "Retro" });

    expect(resetProfile).toHaveBeenCalledOnce();
  });
});

describe("updateItem action: validation (A2)", () => {
  it("returns field errors and writes nothing", async () => {
    const result = await updateItem("note", { title: "  " });

    expect(result).toEqual({
      success: false,
      error: { message: FIELDS_INVALID, fieldErrors: { title: ITEM_TITLE_REQUIRED } },
    });
    expect(itemRow("note").title).toBe("Standup");
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("a link can't lose its URL", async () => {
    const result = await updateItem("link", { title: "Docs", url: "" });

    expect(result).toMatchObject({ success: false, error: { fieldErrors: { url: ITEM_URL_REQUIRED } } });
    expect(itemRow("link").url).toBe("https://old.dev");
  });
});

describe("updateItem action: fields follow the item's type (A3)", () => {
  it("ignores fields the item's type doesn't edit", async () => {
    await updateItem("note", { title: "Standup", url: "https://evil.example", language: "ts" });

    expect(itemRow("note").url).toBeNull();
    expect(itemRow("note").language).toBeUndefined();
  });

  it("a link's URL is saved", async () => {
    await updateItem("link", { title: "Docs", url: "https://new.dev" });

    expect(itemRow("link").url).toBe("https://new.dev");
  });
});

describe("updateItem action: not found (A4)", () => {
  const notFound = { success: false, error: { message: ITEM_NOT_FOUND, code: "not-found" } };

  it("another user's item answers not-found and stays unchanged", async () => {
    db.items.push({ id: "bobs", userId: "bob", typeId: "t-note", title: "Bob's", updatedAt: day(1) });

    expect(await updateItem("bobs", { title: "Hijacked" })).toEqual(notFound);
    expect(itemRow("bobs").title).toBe("Bob's");
  });

  it("a missing id answers the same", async () => {
    expect(await updateItem("no-such-item", { title: "Ghost" })).toEqual(notFound);
  });

  it("an id that isn't a string answers the same", async () => {
    expect(await updateItem(42 as unknown as string, { title: "Ghost" })).toEqual(notFound);
  });

  it("refreshes, so lists drop an item that was deleted elsewhere", async () => {
    await updateItem("no-such-item", { title: "Ghost" });

    expect(resetProfile).toHaveBeenCalledOnce();
  });
});

describe("updateItem action: failures (A5)", () => {
  it("a database error answers with a retry message", async () => {
    db.down = true;

    expect(await updateItem("note", { title: "Retro" })).toEqual({
      success: false,
      error: { message: SOMETHING_WENT_WRONG },
    });
  });

  it("a signed-out user is still redirected to sign in", async () => {
    vi.mocked(requireCurrentUserId).mockImplementation(() => redirect("/sign-in"));

    await expect(updateItem("note", { title: "Retro" })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });
});

describe("deleteItem action: success (R3)", () => {
  it("deletes the item and answers success", async () => {
    expect(await deleteItem("note")).toEqual({ success: true, data: null });
    expect(db.items.map((item) => item.id)).toEqual(["link"]);
  });

  it("refreshes the page and session so counts, pinned items and lists drop it", async () => {
    await deleteItem("note");

    expect(resetProfile).toHaveBeenCalledOnce();
  });
});

describe("deleteItem action: not found (R3)", () => {
  const notFound = { success: false, error: { message: ITEM_NOT_FOUND, code: "not-found" } };

  it("another user's item answers not-found and stays", async () => {
    db.items.push({ id: "bobs", userId: "bob", typeId: "t-note", title: "Bob's", updatedAt: day(1) });

    expect(await deleteItem("bobs")).toEqual(notFound);
    expect(itemRow("bobs")).toBeDefined();
  });

  it("a missing id answers the same", async () => {
    expect(await deleteItem("no-such-item")).toEqual(notFound);
    expect(db.items).toHaveLength(2);
  });

  it("an id that isn't a string answers the same and deletes nothing", async () => {
    expect(await deleteItem({ not: "an id" } as unknown as string)).toEqual(notFound);
    expect(db.items).toHaveLength(2);
  });

  it("refreshes, so lists drop an item that was deleted elsewhere", async () => {
    await deleteItem("no-such-item");

    expect(resetProfile).toHaveBeenCalledOnce();
  });
});

describe("deleteItem action: failures (R3)", () => {
  it("a database error answers with a retry message and doesn't refresh", async () => {
    db.down = true;

    expect(await deleteItem("note")).toEqual({
      success: false,
      error: { message: SOMETHING_WENT_WRONG },
    });
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("a signed-out user is still redirected to sign in", async () => {
    vi.mocked(requireCurrentUserId).mockImplementation(() => redirect("/sign-in"));

    await expect(deleteItem("note")).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(itemRow("note")).toBeDefined();
  });
});

describe("createItem action: success (R6)", () => {
  const created = () => db.items.filter((item) => !["note", "link"].includes(item.id));

  it("creates the item and returns it", async () => {
    const result = await createItem("note", { title: " Retro ", content: "went well", tags: ["team"] });

    expect(result).toEqual({
      success: true,
      data: {
        item: expect.objectContaining({ title: "Retro", content: "went well", tags: ["team"], type: expect.objectContaining({ name: "note" }) }),
        upload: null,
      },
    });
    expect(created()).toEqual([expect.objectContaining({ userId: "ada", typeId: "t-note", title: "Retro" })]);
  });

  it("refreshes the page and session so lists and counts show it", async () => {
    await createItem("note", { title: "Retro" });

    expect(resetProfile).toHaveBeenCalledOnce();
  });

  it("a link is saved with its URL", async () => {
    await createItem("link", { title: "Docs", url: "https://nextjs.org" });

    expect(created()).toEqual([expect.objectContaining({ typeId: "t-link", url: "https://nextjs.org" })]);
  });
});

describe("createItem action: validation (R6)", () => {
  it("returns field errors, writes nothing and doesn't refresh", async () => {
    const result = await createItem("note", { title: "  " });

    expect(result).toEqual({
      success: false,
      error: { message: FIELDS_INVALID, fieldErrors: { title: ITEM_TITLE_REQUIRED } },
    });
    expect(db.items).toHaveLength(2);
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("a link needs a URL", async () => {
    const result = await createItem("link", { title: "Docs" });

    expect(result).toMatchObject({ success: false, error: { fieldErrors: { url: ITEM_URL_REQUIRED } } });
    expect(db.items).toHaveLength(2);
  });

  it("fields the type doesn't use are not written", async () => {
    await createItem("note", { title: "Retro", url: "https://evil.example", language: "ts" });

    expect(db.items[2]).toMatchObject({ url: null, language: null });
  });
});

describe("createItem action: only the listed types (R5)", () => {
  const invalidType = { success: false, error: { message: ITEM_TYPE_INVALID } };

  it("an unknown type name is refused", async () => {
    expect(await createItem("my-custom-type", { title: "T" })).toEqual(invalidType);
    expect(db.items).toHaveLength(2);
  });

  it("a type that isn't a string is refused", async () => {
    expect(await createItem({ name: "note" } as unknown as string, { title: "T" })).toEqual(invalidType);
    expect(db.items).toHaveLength(2);
  });

  it("a listed type with no system type in the database is refused", async () => {
    expect(await createItem("snippet", { title: "T" })).toEqual(invalidType);
    expect(db.items).toHaveLength(2);
    expect(resetProfile).not.toHaveBeenCalled();
  });
});

describe("createItem action: failures (R6)", () => {
  it("a database error answers with a retry message and doesn't refresh", async () => {
    db.down = true;

    expect(await createItem("note", { title: "Retro" })).toEqual({
      success: false,
      error: { message: SOMETHING_WENT_WRONG },
    });
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("a signed-out user is redirected to sign in and nothing is written", async () => {
    vi.mocked(requireCurrentUserId).mockImplementation(() => redirect("/sign-in"));

    await expect(createItem("note", { title: "Retro" })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
    expect(db.items).toHaveLength(2);
  });

  it("a signed-out user is redirected whatever they send, before any validation", async () => {
    vi.mocked(requireCurrentUserId).mockImplementation(() => redirect("/sign-in"));
    const redirected = { digest: expect.stringContaining("NEXT_REDIRECT") };

    await expect(createItem("note", { title: "  " })).rejects.toMatchObject(redirected);
    await expect(createItem("file", { title: "Upload" })).rejects.toMatchObject(redirected);
  });
});

describe("createItem action: file and image items (F7)", () => {
  const created = () => db.items.filter((item) => !["note", "link"].includes(item.id));
  const MAX = 5 * BYTES_PER_MB;

  beforeEach(() => {
    // File and image items are Pro (R3); the Free refusal has its own tests.
    signInOnPlan("PRO");
    db.itemTypes.push(
      { id: "t-file", name: "file", label: "Files", color: "#6b7280", isSystem: true, userId: null },
      { id: "t-image", name: "image", label: "Images", color: "#ec4899", isSystem: true, userId: null },
    );
  });

  it("saves the item with its file details under a key in the user's folder", async () => {
    await createItem("image", { title: "Logo", file: { name: "My Logo.PNG", size: 1234, mimeType: "image/png" } });

    expect(created()).toEqual([
      expect.objectContaining({
        userId: "ada",
        typeId: "t-image",
        title: "Logo",
        fileName: "My Logo.png",
        fileSize: 1234,
        mimeType: "image/png",
        fileKey: expect.stringMatching(/^users\/ada\/[^/]+\.png$/),
      }),
    ]);
  });

  it("returns the item and a signed upload link for that key, type and size", async () => {
    const result = await createItem("file", { title: "Spec", file: { name: "spec.pdf", size: 2048, mimeType: "application/pdf" } });

    const { fileKey } = created()[0];
    expect(result).toEqual({
      success: true,
      data: {
        item: expect.objectContaining({ title: "Spec", fileName: "spec.pdf", fileSize: 2048, mimeType: "application/pdf" }),
        upload: { url: `https://bucket.test/${fileKey}?signed`, headers: { "Content-Type": "application/pdf" } },
      },
    });
    expect(storage.signed.get(fileKey!)).toEqual({ contentType: "application/pdf", size: 2048 });
  });

  it("the key and stored type are the server's: a client can't choose them", async () => {
    await createItem("file", {
      title: "Spec",
      fileKey: "users/bob/theirs.pdf",
      mimeType: "text/html",
      file: { name: "notes.yml", size: 10, mimeType: "text/yaml" },
    });

    expect(created()[0]).toMatchObject({ fileKey: expect.stringMatching(/^users\/ada\//), mimeType: "application/x-yaml" });
  });

  it("the item's body can't carry text: content, language and url are dropped", async () => {
    await createItem("file", {
      title: "Spec",
      content: "text",
      url: "https://evil.example",
      file: { name: "spec.pdf", size: 10, mimeType: "application/pdf" },
    });

    expect(created()[0]).toMatchObject({ content: null, url: null });
  });

  it("a file over 5 MB is refused as a field error, and nothing is saved or signed", async () => {
    const result = await createItem("image", { title: "Big", file: { name: "big.png", size: MAX + 1, mimeType: "image/png" } });

    expect(result).toEqual({
      success: false,
      error: { message: FIELDS_INVALID, fieldErrors: { file: fileTooLarge(MAX) } },
    });
    expect(created()).toEqual([]);
    expect(storage.signed.size).toBe(0);
  });

  it("a type the kind doesn't take is refused", async () => {
    const result = await createItem("image", { title: "Doc", file: { name: "doc.pdf", size: 10, mimeType: "application/pdf" } });

    expect(result).toMatchObject({ success: false, error: { fieldErrors: { file: expect.any(String) } } });
    expect(created()).toEqual([]);
  });

  it("a file or image item needs a file", async () => {
    const result = await createItem("file", { title: "Nothing" });

    expect(result).toMatchObject({ success: false, error: { fieldErrors: { file: FILE_REQUIRED } } });
    expect(created()).toEqual([]);
  });

  it("other types ignore a file sent with them", async () => {
    const result = await createItem("note", { title: "Retro", file: { name: "a.png", size: 10, mimeType: "image/png" } });

    expect(result).toMatchObject({ success: true, data: { upload: null } });
    expect(created()[0].fileKey ?? null).toBeNull();
    expect(created()[0].fileName ?? null).toBeNull();
    expect(storage.signed.size).toBe(0);
  });

  it("is rate limited before the save: nothing is saved or signed, and the wait is the message", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ success: false, remaining: 0, reset: Date.now() + 10 * 60_000 });

    const result = await createItem("image", { title: "Logo", file: { name: "a.png", size: 10, mimeType: "image/png" } });

    // No "file-not-uploaded" code: no item was saved for the dialog to keep.
    expect(result).toEqual({ success: false, error: { message: expect.stringContaining("Too many attempts") } });
    expect(checkRateLimit).toHaveBeenCalledWith("upload", expect.any(Headers), "ada");
    expect(created()).toEqual([]);
    expect(storage.signed.size).toBe(0);
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("a saved item whose file step failed still refreshes the lists", async () => {
    storage.unconfigured = true;

    await createItem("image", { title: "Logo", file: { name: "a.png", size: 10, mimeType: "image/png" } });

    expect(resetProfile).toHaveBeenCalledOnce();
  });

  it("the file details are written only once the upload link is signed", async () => {
    const result = await createItem("image", { title: "Logo", file: { name: "a.png", size: 10, mimeType: "image/png" } });

    const { fileKey } = created()[0];
    expect(storage.signed.has(fileKey!)).toBe(true);
    expect(result).toMatchObject({ success: true, data: { item: { fileName: "a.png", fileSize: 10, mimeType: "image/png" } } });
  });

  it("only file and image items count against the upload limit", async () => {
    await createItem("note", { title: "Retro" });

    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("an invalid file doesn't use up an upload try", async () => {
    await createItem("image", { title: "Big", file: { name: "big.png", size: MAX + 1, mimeType: "image/png" } });

    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("storage not configured: the item stays without a file, with the upload-unavailable message", async () => {
    storage.unconfigured = true;

    expect(await createItem("image", { title: "Logo", file: { name: "a.png", size: 10, mimeType: "image/png" } })).toEqual({
      success: false,
      error: { message: expect.stringContaining(FILE_UPLOAD_UNAVAILABLE), code: "file-not-uploaded" },
    });
    expect(created()).toHaveLength(1);
    expect(created()[0].fileKey ?? null).toBeNull();
  });

  it("storage not configured doesn't affect items without a file", async () => {
    storage.unconfigured = true;

    expect(await createItem("note", { title: "Retro" })).toMatchObject({ success: true });
  });

  it("a storage failure while signing: the item stays without a file, with a retry message", async () => {
    storage.down = true;

    expect(await createItem("image", { title: "Logo", file: { name: "a.png", size: 10, mimeType: "image/png" } })).toEqual({
      success: false,
      error: { message: expect.stringContaining(SOMETHING_WENT_WRONG), code: "file-not-uploaded" },
    });
    expect(created()).toHaveLength(1);
    expect(created()[0].fileKey ?? null).toBeNull();
  });

  it("a failure saving the item itself writes nothing and asks for no file", async () => {
    db.down = true;

    expect(await createItem("image", { title: "Logo", file: { name: "a.png", size: 10, mimeType: "image/png" } })).toEqual({
      success: false,
      error: { message: SOMETHING_WENT_WRONG },
    });
    expect(storage.signed.size).toBe(0);
  });
});

describe("deleteItem action: the stored file goes too (F8)", () => {
  beforeEach(() => {
    db.itemTypes.push({ id: "t-image", name: "image", label: "Images", color: "#ec4899", isSystem: true, userId: null });
    db.items.push(
      { id: "pic", userId: "ada", typeId: "t-image", title: "Pic", fileKey: "users/ada/u1.png", updatedAt: day(1) },
      { id: "bobs-pic", userId: "bob", typeId: "t-image", title: "Bob's", fileKey: "users/bob/u2.png", updatedAt: day(1) },
    );
    upload("users/ada/u1.png", "png bytes");
    upload("users/bob/u2.png", "png bytes");
  });

  it("deleting a file or image item deletes its stored file", async () => {
    expect(await deleteItem("pic")).toEqual({ success: true, data: null });
    expect(storage.objects.has("users/ada/u1.png")).toBe(false);
  });

  it("another user's item: nothing is deleted, in the database or the bucket", async () => {
    expect(await deleteItem("bobs-pic")).toMatchObject({ success: false, error: { code: "not-found" } });
    expect(storage.objects.has("users/bob/u2.png")).toBe(true);
  });

  it("an item without a file touches no stored file", async () => {
    await deleteItem("note");

    expect([...storage.objects.keys()]).toEqual(["users/ada/u1.png", "users/bob/u2.png"]);
  });

  it("a storage failure still answers success: the item is gone, only the object is left over", async () => {
    storage.down = true;

    expect(await deleteItem("pic")).toEqual({ success: true, data: null });
    expect(db.items.some((item) => item.id === "pic")).toBe(false);
    expect(resetProfile).toHaveBeenCalledOnce();
  });
});

describe("item collections: the actions (C5)", () => {
  const collectionGone = {
    success: false,
    error: { message: FIELDS_INVALID, fieldErrors: { collectionIds: ITEM_COLLECTION_NOT_FOUND } },
  };

  beforeEach(() => {
    db.collections.push(
      { id: "c-work", userId: "ada", name: "Work" },
      { id: "c-bobs", userId: "bob", name: "Bob's" },
    );
  });

  it("C5: createItem saves the item in the chosen collections and refreshes the session", async () => {
    const result = await createItem("note", { title: "Retro", collectionIds: ["c-work"] });

    expect(result).toMatchObject({ success: true, data: { item: { collections: [{ id: "c-work", name: "Work" }] } } });
    expect(db.items[2].collectionIds).toEqual(["c-work"]);
    expect(resetProfile).toHaveBeenCalledOnce();
  });

  it("C5: updateItem moves the item between collections", async () => {
    itemRow("note").collectionIds = ["c-work"];

    const result = await updateItem("note", { title: "Standup", collectionIds: [] });

    expect(result).toMatchObject({ success: true, data: { collections: [] } });
    expect(itemRow("note").collectionIds).toEqual([]);
  });

  it("C5: createItem with another user's collection answers a field error and saves nothing", async () => {
    expect(await createItem("note", { title: "Retro", collectionIds: ["c-bobs"] })).toEqual(collectionGone);
    expect(db.items).toHaveLength(2);
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("C5: a file item with a missing collection is refused before any upload is signed", async () => {
    signInOnPlan("PRO");
    db.itemTypes.push({ id: "t-image", name: "image", label: "Images", icon: "Image", color: "#ec4899", isSystem: true, userId: null });

    const result = await createItem("image", {
      title: "Shot",
      collectionIds: ["no-such"],
      file: { name: "a.png", size: 10, mimeType: "image/png" },
    });

    expect(result).toEqual(collectionGone);
    expect(db.items).toHaveLength(2);
    expect(storage.signed.size).toBe(0);
  });

  it("C5: updateItem with another user's or a missing collection answers the same and changes nothing", async () => {
    for (const id of ["c-bobs", "no-such"]) {
      expect(await updateItem("note", { title: "Changed", collectionIds: [id] })).toEqual(collectionGone);
    }
    expect(itemRow("note").title).toBe("Standup");
    expect(resetProfile).not.toHaveBeenCalled();
  });
});

describe("setItemFavorite and setItemPinned actions (FP7–FP11)", () => {
  const NOT_FOUND_RESULT = { success: false, error: { message: ITEM_NOT_FOUND, code: "not-found" } };

  beforeEach(() => {
    db.items.push({ id: "bob-note", userId: "bob", typeId: "t-note", title: "Bob's", isFavorite: false, isPinned: false, updatedAt: day(1) });
  });

  describe.each([
    ["setItemFavorite", setItemFavorite, "isFavorite"],
    ["setItemPinned", setItemPinned, "isPinned"],
  ] as const)("%s", (_, set, flag) => {
    it("FP7: saves the value sent and refreshes the session", async () => {
      expect(await set("note", true)).toEqual({ success: true, data: null });
      expect(itemRow("note")[flag]).toBe(true);
      expect(resetProfile).toHaveBeenCalledOnce();

      expect(await set("note", false)).toEqual({ success: true, data: null });
      expect(itemRow("note")[flag]).toBe(false);
    });

    it("FP7: sending the same value twice leaves it set, never flipped back", async () => {
      await set("note", true);
      await set("note", true);

      expect(itemRow("note")[flag]).toBe(true);
    });

    it("FP8: a value that isn't a boolean is invalid and writes nothing", async () => {
      db.down = true;

      expect(await set("note", "true" as unknown as boolean)).toEqual({
        success: false,
        error: { message: FIELDS_INVALID },
      });
      expect(resetProfile).not.toHaveBeenCalled();
    });

    it("FP9: another user's item answers not found, is left unchanged, and refreshes stale lists", async () => {
      expect(await set("bob-note", true)).toEqual(NOT_FOUND_RESULT);
      expect(itemRow("bob-note")[flag]).toBe(false);
      expect(resetProfile).toHaveBeenCalledOnce();
    });

    it("FP9: a missing item, or an id that isn't a string, answers not found", async () => {
      expect(await set("gone", true)).toEqual(NOT_FOUND_RESULT);
      db.down = true;
      expect(await set(42 as unknown as string, true)).toEqual(NOT_FOUND_RESULT);
    });

    it("FP10: a database error answers with a retry message", async () => {
      db.down = true;

      expect(await set("note", true)).toEqual({ success: false, error: { message: SOMETHING_WENT_WRONG } });
      expect(resetProfile).not.toHaveBeenCalled();
    });

    it("FP11: a signed-out caller is redirected to sign in, even with an invalid value, and nothing is written", async () => {
      vi.mocked(requireCurrentUserId).mockImplementation(() => redirect("/sign-in"));

      await expect(set("note", "yes" as unknown as boolean)).rejects.toMatchObject({
        digest: expect.stringContaining("NEXT_REDIRECT"),
      });
      expect(itemRow("note")[flag]).toBeUndefined();
    });
  });
});

describe("createItem action: Free plan limits (Billing 2: R1, R3, R4; Billing 3: plan-limit code)", () => {
  const PRO_ONLY = { success: false, error: { message: PRO_TYPE_REQUIRED, code: "plan-limit" } };
  const file = { name: "a.png", size: 10, mimeType: "image/png" };

  beforeEach(() => {
    db.itemTypes.push(
      { id: "t-file", name: "file", label: "Files", color: "#6b7280", isSystem: true, userId: null },
      { id: "t-image", name: "image", label: "Images", color: "#ec4899", isSystem: true, userId: null },
    );
  });

  it("R3: a Free user can't create a file or image item; nothing is saved or signed", async () => {
    expect(await createItem("image", { title: "Logo", file })).toEqual(PRO_ONLY);
    expect(await createItem("file", { title: "Doc", file: { ...file, name: "a.pdf", mimeType: "application/pdf" } })).toEqual(PRO_ONLY);

    expect(db.items).toHaveLength(2);
    expect(storage.signed.size).toBe(0);
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("R3: the refusal comes before the rate limit, so it uses up no upload try", async () => {
    await createItem("image", { title: "Logo", file });

    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("R1: a Free user at the item limit is refused with the limit message; nothing is saved", async () => {
    // Two items already (note, link); fill up to the limit.
    for (let n = 2; n < PRICING.free.itemLimit; n++) db.items.push({ id: `fill-${n}`, userId: "ada", typeId: "t-note", title: `Fill ${n}` });

    expect(await createItem("note", { title: "One too many" })).toEqual({
      success: false,
      error: { message: ITEM_LIMIT_REACHED, code: "plan-limit" },
    });
    expect(db.items).toHaveLength(PRICING.free.itemLimit);
    expect(resetProfile).not.toHaveBeenCalled();
  });

  it("R4: a Pro user creates file and image items, past the Free item limit", async () => {
    signInOnPlan("PRO");
    for (let n = 2; n < PRICING.free.itemLimit; n++) db.items.push({ id: `fill-${n}`, userId: "ada", typeId: "t-note", title: `Fill ${n}` });

    expect(await createItem("image", { title: "Logo", file })).toMatchObject({ success: true });
    expect(db.items).toHaveLength(PRICING.free.itemLimit + 1);
  });
});

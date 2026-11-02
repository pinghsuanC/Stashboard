import { StorageNotConfiguredError } from "@/lib/items/upload-errors";
import type { StoredFile, UploadTarget } from "@/types/files";

/**
 * An in-memory stand-in for `@/services/storage`, so tests check which objects
 * end up stored rather than which calls were made. It keeps the service's
 * one rule: a key outside `users/{userId}/` is never read, signed or deleted.
 * Signing an upload records the link; `upload()` plays the browser's PUT.
 */

interface StoredObject {
  body: Uint8Array<ArrayBuffer>;
  contentType: string;
}

export const storage = {
  objects: new Map<string, StoredObject>(),
  /** Upload links handed out, by key: what each was signed for. */
  signed: new Map<string, { contentType: string; size: number }>(),
  /** When set, every call rejects, like an unreachable bucket. */
  down: false,
  /** When set, every call rejects as the service does with an `R2_*` setting missing. */
  unconfigured: false,
  /** Keys R2 refuses to delete, one at a time, while the others go. */
  undeletable: new Set<string>(),
};

export const resetStorage = () => {
  storage.objects = new Map();
  storage.signed = new Map();
  storage.undeletable = new Set();
  storage.down = false;
  storage.unconfigured = false;
};

const ownKey = (userId: string, fileKey: string) =>
  typeof fileKey === "string" && fileKey.startsWith(`users/${userId}/`);

const reachable = () => {
  if (storage.unconfigured) throw new StorageNotConfiguredError(["R2_BUCKET_NAME"]);
  if (storage.down) throw new Error("Could not reach the bucket");
};

let nextId = 0;

export const fakeStorage = {
  newFileKey: (userId: string, ext: string): string => `users/${userId}/fake-uuid-${++nextId}${ext}`,

  createUploadUrl: async (
    userId: string,
    fileKey: string,
    contentType: string,
    size: number,
  ): Promise<UploadTarget> => {
    reachable();
    if (!ownKey(userId, fileKey)) throw new Error("Key outside the user's folder");
    storage.signed.set(fileKey, { contentType, size });
    return { url: `https://bucket.test/${fileKey}?signed`, headers: { "Content-Type": contentType } };
  },

  getFile: async (userId: string, fileKey: string): Promise<StoredFile | null> => {
    reachable();
    const object = ownKey(userId, fileKey) ? storage.objects.get(fileKey) : undefined;
    if (!object) return null;
    return { body: new Blob([object.body]).stream(), size: object.body.byteLength };
  },

  deleteFile: async (userId: string, fileKey: string): Promise<boolean> => {
    reachable();
    if (!ownKey(userId, fileKey)) return false;
    storage.objects.delete(fileKey);
    return true;
  },

  deleteUserFiles: async (userId: string): Promise<string[]> => {
    reachable();
    const keys = [...storage.objects.keys()].filter((key) => ownKey(userId, key));
    const failed = keys.filter((key) => storage.undeletable.has(key));
    for (const key of keys) if (!storage.undeletable.has(key)) storage.objects.delete(key);
    return failed;
  },
};

/** The browser's PUT to a signed link, or a file already in the bucket. */
export const upload = (fileKey: string, text: string, contentType = "text/plain") => {
  storage.objects.set(fileKey, { body: new TextEncoder().encode(text), contentType });
};

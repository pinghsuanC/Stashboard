import "server-only";

import { randomUUID } from "node:crypto";

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { FILE_KEY_ROOT, UPLOAD_URL_TTL_SECONDS } from "@/lib/constants/files";
import { StorageNotConfiguredError } from "@/lib/items/upload-errors";
import type { StoredFile, UploadTarget } from "@/types/files";

// The storage service: the only module that talks to R2 (through its S3 API).
// Every function is scoped to a user: keys live in `users/{userId}/`, and a
// key outside the caller's folder is never signed, read or deleted, a second
// check behind the database's own `userId` filter. Which files are allowed,
// and their wording, live in `@/lib/constants/files` and `@/lib/items/`.

/**
 * The `R2_*` settings, read fresh on each call (env reads stay literal). Any
 * one missing throws `StorageNotConfiguredError` naming them, before a client
 * is built or R2 is asked anything.
 */
const config = () => {
  const settings = {
    R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  };
  const missing = Object.entries(settings)
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) throw new StorageNotConfiguredError(missing);
  return settings as Record<keyof typeof settings, string>;
};

// Built on first use, so importing the module never needs the env. Holds no
// per-user state, so sharing it across requests is fine.
let client: S3Client | undefined;

/** The client and bucket; throws `StorageNotConfiguredError` first if a setting is missing. */
const r2 = () => {
  const settings = config();
  client ??= new S3Client({
    region: "auto",
    endpoint: `https://${settings.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: settings.R2_ACCESS_KEY_ID, secretAccessKey: settings.R2_SECRET_ACCESS_KEY },
    // Newer SDKs add CRC32 checksums to every upload, which a presigned
    // browser PUT can't supply; R2 doesn't need them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { client, bucket: settings.R2_BUCKET_NAME };
};

const folder = (userId: string) => `${FILE_KEY_ROOT}/${userId}/`;

// Directly in the user's folder: no deeper path, no `..`, and not a folder
// whose name only starts with the user's id.
const isOwnKey = (userId: string, fileKey: string): boolean => {
  if (typeof fileKey !== "string" || !fileKey.startsWith(folder(userId))) return false;
  const name = fileKey.slice(folder(userId).length);
  return name !== "" && !name.includes("/") && !name.includes("\\") && name !== "." && name !== "..";
};

/** A new object key in the user's folder: `users/{userId}/{uuid}{ext}`. */
export const newFileKey = (userId: string, ext: string): string => `${folder(userId)}${randomUUID()}${ext}`;

/**
 * A short-lived link the browser PUTs the file to. The type and exact size are
 * signed into it, so R2 refuses a body of another type or length. Throws for
 * a key outside the user's folder.
 */
export const createUploadUrl = async (
  userId: string,
  fileKey: string,
  contentType: string,
  size: number,
): Promise<UploadTarget> => {
  if (!isOwnKey(userId, fileKey)) throw new Error("Refusing to sign a key outside the user's folder");
  const { client: s3, bucket } = r2();
  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: fileKey,
    ContentType: contentType,
    ContentLength: size,
  });
  const url = await getSignedUrl(s3, command, {
    expiresIn: UPLOAD_URL_TTL_SECONDS,
    signableHeaders: new Set(["content-type", "content-length"]),
  });
  return { url, headers: { "Content-Type": contentType } };
};

/**
 * The user's stored file, as a stream; `null` when it is missing or not in
 * their folder. Like every function here, throws `StorageNotConfiguredError`
 * when an `R2_*` setting is missing.
 */
export const getFile = async (userId: string, fileKey: string): Promise<StoredFile | null> => {
  if (!isOwnKey(userId, fileKey)) return null;
  const { client: s3, bucket } = r2();
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
    if (!object.Body) return null;
    return { body: object.Body.transformToWebStream(), size: object.ContentLength ?? null };
  } catch (error) {
    if (error instanceof NoSuchKey) return null;
    throw error;
  }
};

/**
 * Deletes the user's stored file. `false`, touching nothing, for a key outside
 * their folder. Deleting a key that is already gone succeeds, as in S3.
 */
export const deleteFile = async (userId: string, fileKey: string): Promise<boolean> => {
  if (!isOwnKey(userId, fileKey)) return false;
  const { client: s3, bucket } = r2();
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: fileKey }));
  return true;
};

/**
 * Deletes everything in the user's folder, whether or not a row still points
 * at it, for account deletion. Returns the keys it couldn't delete: one bad
 * object or batch doesn't stop the rest. A listing that fails is thrown, as
 * there's no telling what is left.
 */
export const deleteUserFiles = async (userId: string): Promise<string[]> => {
  const { client: s3, bucket } = r2();
  const failed: string[] = [];
  let page: string | undefined;
  do {
    const listing = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: folder(userId), ContinuationToken: page }),
    );
    page = listing.NextContinuationToken;
    const keys = (listing.Contents ?? []).flatMap(({ Key }) => (Key ? [Key] : []));
    if (keys.length === 0) continue;
    try {
      const { Errors } = await s3.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        }),
      );
      failed.push(...(Errors ?? []).flatMap(({ Key }) => (Key ? [Key] : [])));
    } catch (error) {
      console.error("Deleting a batch of stored files failed:", error);
      failed.push(...keys);
    }
  } while (page);
  return failed;
};

import { beforeEach, describe, expect, it, vi } from "vitest";

import { UPLOAD_URL_TTL_SECONDS } from "@/lib/constants/files";

import { createUploadUrl, deleteFile, deleteUserFiles, getFile, newFileKey } from "./storage";

// After vi.resetModules() the error class is a fresh copy, so match by name.
const NOT_CONFIGURED = { name: "StorageNotConfiguredError" };

// The SDK is replaced by recorders: what matters is which commands reach R2,
// with what input, and that a key outside the user's folder reaches nothing.
const s3 = vi.hoisted(() => ({
  configs: [] as unknown[],
  send: vi.fn(),
  sign: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  return {
    S3Client: class {
      constructor(config: unknown) {
        s3.configs.push(config);
      }
      send = s3.send;
    },
    PutObjectCommand: class PutObjectCommand extends Command {},
    GetObjectCommand: class GetObjectCommand extends Command {},
    DeleteObjectCommand: class DeleteObjectCommand extends Command {},
    DeleteObjectsCommand: class DeleteObjectsCommand extends Command {},
    ListObjectsV2Command: class ListObjectsV2Command extends Command {},
    NoSuchKey: class NoSuchKey extends Error {
      name = "NoSuchKey";
    },
  };
});
vi.mock("@aws-sdk/s3-request-presigner", () => ({ getSignedUrl: s3.sign }));

const sentCommand = () => {
  const [command] = s3.send.mock.calls[0];
  return { name: command.constructor.name, input: command.input };
};

const KEY = "users/ada/0b0e5b2e-0d6c-4c55-9a43-6f5c0c3a7d11.png";

beforeEach(() => {
  vi.stubEnv("R2_ACCOUNT_ID", "acct");
  vi.stubEnv("R2_ACCESS_KEY_ID", "key-id");
  vi.stubEnv("R2_SECRET_ACCESS_KEY", "secret");
  vi.stubEnv("R2_BUCKET_NAME", "bucket");
  s3.send.mockReset();
  s3.sign.mockReset().mockResolvedValue("https://acct.r2.cloudflarestorage.com/bucket/signed");
});

describe("object keys (S1)", () => {
  it("puts a new file in the user's folder under a random uuid with its extension", () => {
    expect(newFileKey("ada", ".png")).toMatch(
      /^users\/ada\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$/,
    );
  });

  it("never repeats a key", () => {
    expect(newFileKey("ada", ".png")).not.toBe(newFileKey("ada", ".png"));
  });
});

describe("upload links (S2)", () => {
  it("signs a PUT for the key with its type and exact size, valid for the upload link lifetime", async () => {
    const target = await createUploadUrl("ada", KEY, "image/png", 1234);

    expect(target).toEqual({
      url: "https://acct.r2.cloudflarestorage.com/bucket/signed",
      headers: { "Content-Type": "image/png" },
    });
    const [, command, options] = s3.sign.mock.calls[0];
    expect(command.constructor.name).toBe("PutObjectCommand");
    expect(command.input).toEqual({ Bucket: "bucket", Key: KEY, ContentType: "image/png", ContentLength: 1234 });
    expect(options.expiresIn).toBe(UPLOAD_URL_TTL_SECONDS);
    expect([...options.signableHeaders]).toEqual(expect.arrayContaining(["content-type", "content-length"]));
  });

  it("refuses to sign a key in another user's folder", async () => {
    await expect(createUploadUrl("ada", "users/bob/x.png", "image/png", 10)).rejects.toThrow();
    expect(s3.sign).not.toHaveBeenCalled();
  });

  it("talks to the account's R2 endpoint, and only adds checksums R2 needs", async () => {
    await createUploadUrl("ada", KEY, "image/png", 10);

    expect(s3.configs.at(-1)).toMatchObject({
      region: "auto",
      endpoint: "https://acct.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "key-id", secretAccessKey: "secret" },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  });
});

describe("reading a file (S3)", () => {
  it("returns the user's object as a stream, with its size", async () => {
    const body = new Blob(["hello"]).stream();
    s3.send.mockResolvedValue({ Body: { transformToWebStream: () => body }, ContentLength: 5 });

    expect(await getFile("ada", KEY)).toEqual({ body, size: 5 });
    expect(sentCommand()).toEqual({ name: "GetObjectCommand", input: { Bucket: "bucket", Key: KEY } });
  });

  it("answers another user's key as not found, without asking R2", async () => {
    expect(await getFile("ada", "users/bob/x.png")).toBeNull();
    expect(s3.send).not.toHaveBeenCalled();
  });

  it("a key that climbs out of the folder is another user's key", async () => {
    expect(await getFile("ada", "users/ada/../bob/x.png")).toBeNull();
    expect(await getFile("ada", "users/ada/sub/x.png")).toBeNull();
    expect(await getFile("ada", "users/adam/x.png")).toBeNull();
    expect(s3.send).not.toHaveBeenCalled();
  });

  it("a missing object is not found", async () => {
    const { NoSuchKey } = await import("@aws-sdk/client-s3");
    s3.send.mockRejectedValue(new NoSuchKey({ message: "gone", $metadata: {} }));

    expect(await getFile("ada", KEY)).toBeNull();
  });

  it("any other failure is thrown, not hidden as not found", async () => {
    s3.send.mockRejectedValue(new Error("connection reset"));

    await expect(getFile("ada", KEY)).rejects.toThrow("connection reset");
  });
});

describe("missing configuration (S5)", () => {
  it.each(["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET_NAME"])(
    "with %s unset, refuses before building a client or asking R2",
    async (name) => {
      vi.resetModules();
      const configsBefore = s3.configs.length;
      vi.stubEnv(name, "");
      const fresh = await import("./storage");

      await expect(fresh.createUploadUrl("ada", KEY, "image/png", 10)).rejects.toMatchObject(NOT_CONFIGURED);
      await expect(fresh.getFile("ada", KEY)).rejects.toMatchObject(NOT_CONFIGURED);
      await expect(fresh.deleteFile("ada", KEY)).rejects.toMatchObject(NOT_CONFIGURED);
      expect(s3.configs.length).toBe(configsBefore);
      expect(s3.sign).not.toHaveBeenCalled();
      expect(s3.send).not.toHaveBeenCalled();
    },
  );

  it("names what is missing, never a value", async () => {
    vi.resetModules();
    vi.stubEnv("R2_BUCKET_NAME", "");
    const fresh = await import("./storage");

    const error = await fresh.getFile("ada", KEY).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ missing: ["R2_BUCKET_NAME"] });
    expect(String(error)).not.toContain("secret");
  });

  it("a key outside the folder is still refused first, without reading the config", async () => {
    vi.resetModules();
    vi.stubEnv("R2_ACCOUNT_ID", "");
    const fresh = await import("./storage");

    expect(await fresh.getFile("ada", "users/bob/x.png")).toBeNull();
  });
});

describe("deleting a file (S4)", () => {
  it("deletes the user's object", async () => {
    s3.send.mockResolvedValue({});

    expect(await deleteFile("ada", KEY)).toBe(true);
    expect(sentCommand()).toEqual({ name: "DeleteObjectCommand", input: { Bucket: "bucket", Key: KEY } });
  });

  it("leaves another user's object alone, without asking R2", async () => {
    expect(await deleteFile("ada", "users/bob/x.png")).toBe(false);
    expect(s3.send).not.toHaveBeenCalled();
  });
});

describe("deleting all of a user's files (CR2)", () => {
  const sent = (name: string) =>
    s3.send.mock.calls.map(([command]) => command).filter((command) => command.constructor.name === name);
  const deletedKeys = () =>
    sent("DeleteObjectsCommand").flatMap((command) => command.input.Delete.Objects.map(({ Key }: { Key: string }) => Key));

  /** R2 with one listing per page; `onDelete` answers each batch delete. */
  const bucketWith = (pages: string[][], onDelete: (keys: string[]) => object = () => ({})) => {
    s3.send.mockImplementation(async (command) => {
      if (command.constructor.name === "ListObjectsV2Command") {
        const page = Number(command.input.ContinuationToken ?? 0);
        const next = page + 1 < pages.length ? String(page + 1) : undefined;
        return { Contents: pages[page].map((Key) => ({ Key })), NextContinuationToken: next };
      }
      return onDelete(command.input.Delete.Objects.map(({ Key }: { Key: string }) => Key));
    });
  };

  it("lists exactly the user's folder, so a user whose id starts the same is safe", async () => {
    bucketWith([[KEY]]);

    await deleteUserFiles("ada");

    expect(sent("ListObjectsV2Command")[0].input).toMatchObject({ Bucket: "bucket", Prefix: "users/ada/" });
  });

  it("deletes every object on every page and reports no failures", async () => {
    bucketWith([["users/ada/1.png", "users/ada/2.png"], ["users/ada/3.png"]]);

    expect(await deleteUserFiles("ada")).toEqual([]);
    expect(deletedKeys()).toEqual(["users/ada/1.png", "users/ada/2.png", "users/ada/3.png"]);
  });

  it("an empty folder sends no delete", async () => {
    bucketWith([[]]);

    expect(await deleteUserFiles("ada")).toEqual([]);
    expect(sent("DeleteObjectsCommand")).toEqual([]);
  });

  it("an object R2 refuses is reported, and the others still go", async () => {
    bucketWith([["users/ada/1.png", "users/ada/2.png"]], () => ({ Errors: [{ Key: "users/ada/1.png", Code: "InternalError" }] }));

    expect(await deleteUserFiles("ada")).toEqual(["users/ada/1.png"]);
    expect(deletedKeys()).toEqual(["users/ada/1.png", "users/ada/2.png"]);
  });

  it("a failed batch reports its keys and doesn't stop the next page", async () => {
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    bucketWith([["users/ada/1.png"], ["users/ada/2.png"]], (keys) => {
      if (keys.includes("users/ada/1.png")) throw new Error("connection reset");
      return {};
    });

    expect(await deleteUserFiles("ada")).toEqual(["users/ada/1.png"]);
    expect(deletedKeys()).toEqual(["users/ada/1.png", "users/ada/2.png"]);
  });

  it("a listing that fails is thrown: there is no telling what's left", async () => {
    s3.send.mockRejectedValue(new Error("connection reset"));

    await expect(deleteUserFiles("ada")).rejects.toThrow("connection reset");
  });

  it("with a setting missing, refuses before asking R2", async () => {
    vi.resetModules();
    vi.stubEnv("R2_BUCKET_NAME", "");
    const fresh = await import("./storage");

    await expect(fresh.deleteUserFiles("ada")).rejects.toMatchObject(NOT_CONFIGURED);
    expect(s3.send).not.toHaveBeenCalled();
  });
});

// Live check of the upload design against the real bucket, with the same S3
// client settings as src/services/storage.ts:
//   1. a signed PUT with the signed type and size is accepted,
//   2. a body of another size, or another Content-Type, is refused,
//   3. the object reads back, then is deleted,
//   4. a folder lists and batch deletes, as account deletion does.
// Writes tiny objects under users/__check__/ and always deletes them.
// Run: node testScripts/r2-presign-check.mjs   (reads .env)
import "dotenv/config";

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME } = process.env;
const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const Key = `users/__check__/${crypto.randomUUID()}.txt`;
const TYPE = "text/plain";
const body = "hello from the presign check";
const size = Buffer.byteLength(body);

const sign = () =>
  getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key, ContentType: TYPE, ContentLength: size }),
    { expiresIn: 60, signableHeaders: new Set(["content-type", "content-length"]) },
  );

const put = async (data, contentType) =>
  (await fetch(await sign(), { method: "PUT", body: data, headers: { "Content-Type": contentType } })).status;

let failed = false;
const expect = (label, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${label}`);
  if (!ok) failed = true;
};

try {
  expect("a longer body is refused", (await put(`${body}!!`, TYPE)) >= 400);
  expect("another Content-Type is refused", (await put(body, "text/html")) >= 400);
  expect("the signed type and size are accepted", (await put(body, TYPE)) === 200);
  const object = await s3.send(new GetObjectCommand({ Bucket: R2_BUCKET_NAME, Key }));
  expect("it is stored with its type", object.ContentType === TYPE);
  expect("it reads back intact", (await object.Body.transformToString()) === body);
} finally {
  await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key }));
  console.log("deleted the check object");
}

const Prefix = `users/__check__/${crypto.randomUUID()}/`;
const listed = async () =>
  ((await s3.send(new ListObjectsV2Command({ Bucket: R2_BUCKET_NAME, Prefix }))).Contents ?? []).map((object) => object.Key);

try {
  for (const name of ["one.txt", "two.txt"]) {
    await s3.send(new PutObjectCommand({ Bucket: R2_BUCKET_NAME, Key: `${Prefix}${name}`, Body: body, ContentType: TYPE }));
  }
  const keys = await listed();
  expect("a folder lists its objects", keys.length === 2);
  const { Errors } = await s3.send(
    new DeleteObjectsCommand({
      Bucket: R2_BUCKET_NAME,
      Delete: { Objects: keys.map((key) => ({ Key: key })), Quiet: true },
    }),
  );
  expect("a batch delete reports no errors", (Errors ?? []).length === 0);
  expect("the folder is empty afterwards", (await listed()).length === 0);
} finally {
  for (const key of await listed()) await s3.send(new DeleteObjectCommand({ Bucket: R2_BUCKET_NAME, Key: key }));
}
process.exit(failed ? 1 : 0);

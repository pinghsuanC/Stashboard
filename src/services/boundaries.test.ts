import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { describe, expect, it } from "vitest";

// Who may reach the database. `services/prisma.ts` builds the one client;
// `services/` and `lib/db/` are the only modules allowed to import it, and
// `services/` sits below `lib/db/`, never the other way round. Test files are
// skipped: they mock the client by path.

const SRC = join(__dirname, "..");

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "generated" ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const files = sourceFiles(SRC).map((path) => ({
  path: relative(SRC, path).split(sep).join("/"),
  text: readFileSync(path, "utf8"),
}));

const importing = (specifier: string) =>
  files.filter(({ text }) => text.includes(`from "${specifier}"`)).map(({ path }) => path);

// Files importing any module under `prefix`.
const importingPrefix = (prefix: string) =>
  files.filter(({ text }) => text.includes(`from "${prefix}`)).map(({ path }) => path);

// As `importing`, minus `import type` lines: those vanish at runtime.
const importingAtRuntime = (specifier: string) =>
  files
    .filter(({ text }) =>
      text.split("\n").some((line) => line.includes(`from "${specifier}"`) && !line.startsWith("import type")),
    )
    .map(({ path }) => path);

describe("service boundaries", () => {
  it("B1: only services/ and lib/db/ import the Prisma client", () => {
    const outside = importing("@/services/prisma").filter(
      (path) => !path.startsWith("services/") && !path.startsWith("lib/db/"),
    );
    expect(outside).toEqual([]);
  });

  it("B1: the client is imported from services, and the old path is gone", () => {
    expect(importing("@/services/prisma").length).toBeGreaterThan(0);
    expect(importing("@/lib/prisma")).toEqual([]);
  });

  it("B2: a PrismaClient is built only in services/prisma.ts", () => {
    const builders = files.filter(({ text }) => text.includes("new PrismaClient")).map(({ path }) => path);
    expect(builders).toEqual(["services/prisma.ts"]);
  });

  it("B3: services never import from lib/db", () => {
    const upward = files
      .filter(({ path }) => path.startsWith("services/"))
      .filter(({ text }) => text.includes('from "@/lib/db/'))
      .map(({ path }) => path);
    expect(upward).toEqual([]);
  });

  it("B5: only the email service talks to Resend", () => {
    expect(importing("resend")).toEqual(["services/email.ts"]);
  });

  it("B5: email is sent through services, and the old path is gone", () => {
    expect(importing("@/services/email").length).toBeGreaterThan(0);
    expect(importing("@/lib/email")).toEqual([]);
  });

  it("B6: only the rate limit service talks to Upstash", () => {
    expect(importingAtRuntime("@upstash/redis")).toEqual(["services/rate-limit.ts"]);
    expect(importingAtRuntime("@upstash/ratelimit")).toEqual(["services/rate-limit.ts"]);
  });

  it("B6: rate limits are checked through services, and the old path is gone", () => {
    expect(importing("@/services/rate-limit").length).toBeGreaterThan(0);
    expect(importing("@/lib/rate-limit")).toEqual([]);
  });

  it("B10: only the storage service talks to R2", () => {
    expect(importingPrefix("@aws-sdk/")).toEqual(["services/storage.ts"]);
  });

  it("B10: files are stored through services", () => {
    expect(importing("@/services/storage").length).toBeGreaterThan(0);
  });

  it("B11 (Billing R5): only the Stripe adapter talks to Stripe", () => {
    expect(importingAtRuntime("stripe")).toEqual(["services/billing/stripe.ts"]);
    expect(importingPrefix("stripe/")).toEqual([]);
  });

  it("B12 (Billing R21): no server action reaches the period writes", () => {
    // Every export of a "use server" file is a public endpoint; period
    // writes are only reached through the webhook and the session load.
    const actions = importing("@/services/billing/entitlement").filter((path) => path.startsWith("actions/"));
    expect(actions).toEqual([]);
    expect(importing("@/services/billing/entitlement").length).toBeGreaterThan(0);
  });

  it("B13 (AI): only the AI service talks to OpenAI", () => {
    expect(importing("openai")).toEqual(["services/ai/openai.ts"]);
    expect(importingPrefix("openai/")).toEqual([]);
  });

  it("B7: lib/ is grouped by area; only shadcn's utils stays at its root", () => {
    const root = readdirSync(join(SRC, "lib"), { withFileTypes: true });
    expect(root.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()).toEqual([
      "ai",
      "auth",
      "billing",
      "collections",
      "constants",
      "db",
      "editor",
      "helpers",
      "items",
      "pricing",
      "search",
      "session",
    ]);
    expect(root.filter((entry) => entry.isFile()).map((entry) => entry.name)).toEqual(["utils.ts"]);
  });

  it("B8: every service is server-only, except the client the seed loads in plain Node", () => {
    const unguarded = files
      .filter(({ path }) => path.startsWith("services/") && path !== "services/prisma.ts")
      .filter(({ text }) => !text.startsWith('import "server-only";'))
      .map(({ path }) => path);
    expect(unguarded).toEqual([]);
  });

  it("B9: services hold no user-facing copy; messages are worded in lib/ and the UI", () => {
    const wording = files
      .filter(({ path }) => path.startsWith("services/"))
      .filter(({ text }) => text.includes('from "@/lib/constants/messages/'))
      .map(({ path }) => path);
    expect(wording).toEqual([]);
  });

  it("B4: only the session service imports Auth.js's @/auth among services", () => {
    const authImporters = importing("@/auth").filter((path) => path.startsWith("services/"));
    expect(authImporters).toEqual(["services/auth/session.ts"]);
  });
});

// Types live in `types/`, one file per area. Two types are calculated from a
// constant's value, so they stay beside it.
const TYPES_KEPT_BESIDE_THEIR_CONSTANT = [
  "lib/constants/rate-limits.ts RateLimitPolicy",
  "lib/constants/routes.ts Flag",
];

describe("type boundaries", () => {
  it("T1: types/ files are declarations only; they import types from types/ and generated code, nothing else", () => {
    // Whole statements, not lines: a multi-line `import type { ... }` puts
    // its `from` on a later line.
    const offending = files
      .filter(({ path }) => path.startsWith("types/"))
      .flatMap(({ path, text }) =>
        [...text.matchAll(/^import\s+(type\s+)?(?:[^;]*?\s+from\s+)?"([^"]+)";/gm)]
          .filter(([, typeOnly, specifier]) => {
            if (!typeOnly) return true;
            return specifier.startsWith("@/") && !/^@\/(types|generated)\//.test(specifier);
          })
          .map(([statement]) => `${path}: ${statement.replace(/\s+/g, " ")}`),
      );
    expect(offending).toEqual([]);
  });

  it("T2: no file outside types/ exports a type, except the ones calculated from a constant", () => {
    // Declarations, plus re-exports (`export type { X }`, `export { type X }`),
    // so no file can keep a second home for a type.
    const exportedNames = (text: string) => [
      ...[...text.matchAll(/^export (?:interface|type) (\w+)/gm)].map(([, name]) => name),
      ...[...text.matchAll(/^export type \{([^}]*)\}/gm)].flatMap(([, names]) => names.split(",")),
      ...[...text.matchAll(/^export \{([^}]*)\}/gm)].flatMap(([, names]) =>
        names.split(",").filter((name) => name.trim().startsWith("type ")),
      ),
    ];
    const exported = files
      .filter(({ path }) => !path.startsWith("types/"))
      .flatMap(({ path, text }) =>
        exportedNames(text)
          .map((name) => name.replace(/^\s*type\s+/, "").split(" as ")[0].trim())
          .filter(Boolean)
          .map((name) => `${path} ${name}`),
      );
    expect(exported).toEqual(TYPES_KEPT_BESIDE_THEIR_CONSTANT);
  });

  it("T3: components never import from lib/db; shapes come from types/", () => {
    expect(importingPrefix("@/lib/db/").filter((path) => path.startsWith("components/"))).toEqual([]);
  });
});

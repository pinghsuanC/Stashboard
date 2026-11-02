# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

# Rules that must not change

Load-bearing; do not drop or soften. Other sections point here instead of repeating them.

## Production and data

- Always `npm run db:migrate`, never `prisma db push` unless explicitly asked. `.env` points at the Neon dev branch; production is a separate branch and only gets `db:deploy`.
- Neon MCP: pass both `project_id` and `branch_id` explicitly on every call, read-only ones included. The OAuth connection is not limited to one project, and leaving out `branch_id` hits the default branch, which is `production`.
- Neon ids: project `stashboard` `rough-wind-04171988`; branch `development` `br-silent-firefly-b4er4xcj`; production `br-polished-voice-b487lkfo`.
- Never touch `production` through the MCP: no reads, writes, migrations, `reset_from_parent`, branch or endpoint changes.
- If a task seems to need production (for example comparing schemas), stop and ask. Continue only if production is named explicitly in the request.
- Schema changes only through `npm run db:migrate` on the dev branch, never `run_sql` DDL or `prepare_database_migration`, so Prisma's migration history stays the source of truth.
- Ask before destructive SQL (`DELETE`, `UPDATE`, `DROP`, `TRUNCATE`), even on `development`.
- For browser checks on the local dev server, sign in with the test login in `.env.example` (`TEST_USER_EMAIL` / `TEST_USER_PASSWORD`; gitignored, local only). Its data on the dev branch may be changed freely through the app. Never write the password into a tracked file.

## Security and auth

- Never cache the session at module level or behind an "initialized" flag: one process serves every user.
- Queries scope themselves to the session user: no `userId` threaded through callers. `userId` (or the user's own `id`) is part of every `where` for Item, Collection and User; another user's id finds nothing and is answered as not found.
- Call `requireCurrentUserId()` outside any `try`, so the sign-in redirect is not swallowed.
- `sessionVersion` is the real revocation check; the `jwt` callback stamps it only at sign-in; never let `update()` refresh it.
- The profile never carries the password hash or billing ids (customer, subscription, checkout session).
- Register answers a taken email exactly like a new one, so it cannot reveal whether an account exists.
- Redirect targets go through `safeCallbackUrl()` / `signInHref()`.
- Check email verification with `isEmailVerificationEnabled()`, never `process.env` directly.
- The sign-in rate limit lives in `authorizeCredentials()`, not the action, so a direct POST to the Auth.js callback is covered too.
- Auth pages call `redirectIfSignedIn()`, not bare `auth()`.
- The item drawer route (`GET /api/items/[id]`) answers 404 for a missing item and another user's item alike, and the drawer signs the user out on a 404.
- Services start with `import "server-only"` (except `services/prisma.ts`); only `services/` and `lib/db/` import the database client.
- Storage keys are built only by `newFileKey()` (`users/{userId}/{uuid}{ext}`), never from a file name or client input; every storage function takes the session's `userId` and refuses a key outside that folder. The client never sends a key: the server resolves it from the item.
- Stored files are served only through `GET /api/items/[id]/file`, with `FILE_RESPONSE_SECURITY_HEADERS` (sandbox CSP, `nosniff`) and `Cache-Control: private, no-store`, except image caching: images use `private, no-cache` with an `ETag` (a hash of `fileKey`, never the raw key) so the browser revalidates, and the session and ownership checks still run before any `304`. Never make the bucket public or link to it directly.
- `proxy.ts` answers a signed-out `/api/*` request (except `/api/auth/*` and `/api/billing/<vendor>/webhook`, which must stay public) with a JSON 401, not a redirect; routes still check the session themselves.
- The billing webhook (`/api/billing/[vendor]/webhook`) is the one session-less writer: it trusts only a body whose vendor signature verifies on the raw text, writes only to a `PENDING` period matched by both our period id and the vendor's checkout id, and never creates a user or period (a paid checkout nothing claims is cancelled).
- Period writes live in `services/billing/entitlement.ts`, never in `actions/` (`boundaries.test.ts` B12): no server action accepts anything that becomes a period. The plan comes from stored rows; nothing is granted Pro that the vendor didn't confirm.

## Version pins

- Prisma stays on matching `^7` for `prisma` and `@prisma/client`: npm's `latest` tag points at an 8.x release candidate, so a bare `npm i prisma` installs 8.
- Vitest stays on `^4`: v5 needs `@types/node` 22+, and this project is on 20.
- Import the Prisma client from `@/generated/prisma/client`, not `@prisma/client`.

## Looks wrong, is not

- Keep the `@AGENTS.md` import at the top of CLAUDE.md.
- `AGENTS.md` is generated by `next dev`; durable guidance goes in CLAUDE.md.
- Read the local Next docs in `node_modules/next/dist/docs/` before writing App Router code; they override prior knowledge.
- `LayoutProps`, `PageProps` and `RouteContext` are global; do not import them or rewrite `LayoutProps<'/'>` by hand (for example into `{ children }: { children: React.ReactNode }`). It is the current, correct convention.
- There is no `tailwind.config.js` by design; `--font-sans: var(--font-sans)` is not a bug.
- `cn` comes from the `cn` package; do not reinstall `clsx` / `tailwind-merge`.
- Tests come before the code: write them from the feature's requirements, not from the code, and see each fail on its assertion before implementing. Once green, break the behaviour to prove each test can fail (full workflow in `context/ai-interaction.md`).
- Item detail is a drawer; do not add an `/items/[id]` page.

# Stashboard

A developer knowledge hub for snippets, commands, prompts, notes, files, images, links and custom types.

## Commands

```bash
npm run dev      # dev server (Turbopack), http://localhost:3000
npm run build    # production build — also runs the TypeScript check
npm run start    # serve the production build
npm run lint     # ESLint 9 flat config; bare `eslint`, no path args needed
npm run db:migrate   # prisma migrate dev — create + apply a migration (Neon dev branch)
npm run db:deploy    # prisma migrate deploy — apply existing migrations (production)
npm run db:generate  # prisma generate — also runs on postinstall
npm run db:studio    # prisma studio
npm run db:test      # testScripts/test-db.ts — read-only DB smoke checks (not a test runner)
node testScripts/r2-presign-check.mjs  # live R2 check: signed upload limits, folder list and batch delete; deletes all it writes
npx tsx testScripts/seed-pagination.ts <email>  # dev branch: adds 40 items + 40 collections to an account to page through; runs once
npx tsx testScripts/gating-user.ts <reset|trial|lapse|paid|status>  # dev branch: plan-gating walkthrough account (GATING_TEST_USER_* in .env.example)
npm test             # vitest run — unit tests, single run
npm run test:watch   # vitest in watch mode
```

Tests are **Vitest 4** (`vitest.config.ts`), for server actions and utilities only, not components. Test files sit next to their source as `*.test.ts`. Workflow and the tests-first rule: `context/ai-interaction.md`.

- Database code is tested against `src/test/fake-prisma.ts`, an in-memory stand-in that keeps the cascade and `ON DELETE RESTRICT` rules, so tests assert what is stored rather than which calls were made. Mock `@/services/prisma` with it; extend it when new code needs more of Prisma.
- The run's `TZ` is set far from UTC in `vitest.config.ts` so date code that follows the machine zone fails.

For a typecheck without a full build: `npx tsc --noEmit`.

## Docs are local

Next.js 16.4.3 with React 19. Docs are in `node_modules/next/dist/docs/`: `01-app/01-getting-started/` (guides), `01-app/03-api-reference/` (APIs), `01-app/02-guides/upgrading/version-16.md` (what changed).

## Architecture

App Router under `src/app/`. Routes:

- `(app)` group (shared sidebar + top bar layout): `/dashboard`, `/profile`, `/settings`, `/billings` (plan from the session, past subscriptions queried per visit and paginated; every billing return lands here), `/items/[type]` (e.g. `/items/snippets`), `/collections`, `/collections/[slug]` (segment checked with `isSlug()` before any query), `/favorites` (every favourite collection and item, queried per visit; the sidebar shows only the 10 newest favourite collections) and `/pinned` (read from the session, not queried). `/collections` is also queried per visit, not read from the session.
- `(auth)` group (centered layout, no URL segment): `/sign-in`, `/register`, `/forgot-password`, `/reset-password`.
- `/` is the public marketing homepage: it reads no session, so it is prerendered static (sections in `src/components/homepage/`, logos in `src/assets/brand-icons/`, colours from `SYSTEM_TYPE_COLORS`, prices from `PRICING`).
- Route handlers: `/api/items/[id]` (drawer detail), `/api/items/[id]/file` (stored file), `/api/auth/*` (Auth.js, register, verify-email), `/api/billing/[vendor]/webhook`.

- **The three listings are paginated** from `?page=` through `loadPage()` (`src/lib/helpers/pagination.ts`): a count plus `skip`/`take`, never every row; a bad `?page=` reads as page 1 and a page past the end (`isPastLastPage()`) redirects to the dashboard. `Pagination` (`src/components/shared/`) uses `next/link`, not `<a>`, so a page turn keeps the `(app)` layout and does not reload the session. Sort orders end with `id` so `skip` never repeats or drops a row.
- **`src/app/layout.tsx`** is the required root layout: `<html>`/`<body>`, fonts, the always-on `dark` class, default `metadata`, and the Sonner `<Toaster theme="dark">` (pinned, since there is no `next-themes` provider).
- **Services own the connections; `src/lib/db/` is the interface.** Flow: actions / routes → `lib/db` → `services` → database. `src/services/prisma.ts` builds the one client; `src/services/boundaries.test.ts` enforces who may import it and that `services/` never imports `lib/db/`. `prisma.ts` skips `server-only` because the seed loads it in plain Node. Services hold no user-facing copy (wording lives in `lib/` and the UI). Each outside API client has one service, the only module importing that package:
  - `src/services/email.ts`: `resend` (send functions per email kind; templates in `src/lib/constants/emails.ts`).
  - `src/services/rate-limit.ts`: `@upstash/*` at runtime (policies in `src/lib/constants/rate-limits.ts`; blocked-caller message and `Retry-After` in `src/lib/auth/rate-limit-messages.ts`).
  - `src/services/storage.ts`: `@aws-sdk/*` (R2 via its S3 API: `newFileKey`, `createUploadUrl`, `getFile`, `deleteFile`, `deleteUserFiles`, all scoped to a user). It throws `StorageNotConfiguredError` (`src/lib/items/upload-errors.ts`) when an `R2_*` setting is missing, which `createItem` words as `FILE_UPLOAD_UNAVAILABLE`.
  - **`src/services/billing/`**: `stripe.ts` (the only `stripe` importer, behind the vendor-neutral `BillingAdapter` in `src/types/billing.ts`), `vendors.ts` (vendor → adapter; `checkoutAdapter()` reads `BILLING_VENDOR` for new checkouts only), `checkout.ts` (`beginCheckout()`: a `PENDING` period, then the vendor's checkout tied to its id), `entitlement.ts` (`settleCheckout()`, shared by the webhook and the session load, and `resolveBilling()`).
  - **`src/services/ai/openai.ts`**: the only `openai` importer (`boundaries.test.ts` B13). It builds the client on first use, so a missing `OPENAI_API_KEY` fails the call, not the import, and turns SDK errors into `AiError` (`src/lib/ai/ai-errors.ts`), worded by `aiFailureMessage()`. Calls use the Responses API with `store: false` and a hashed user id. `hasAiCredits()` says whether the OpenAI account can pay: an API key can't read the balance, so it makes the smallest real call and caches the answer 5 minutes in the process. That is acceptable because it is app-wide state with no user data, unlike the session.
  - **`src/services/auth/`**, split so its imports can't loop (no `index.ts`: a barrel would bring the loop back): `session.ts` (`getCurrentUser()`, `requireCurrentUser()`, `requireCurrentUserId()`, `redirectIfSignedIn()`; the only service importing `@/auth`), `adapter.ts` (Prisma adapter for `src/auth.ts`), `users.ts` and `tokens.ts` (database side of sign-in, register, password change, verification, reset). They take plain arguments; bcrypt, expiry and cooldown rules, emails and rate limits stay in `src/lib/`.
- **`src/lib/db/`** (`items.ts`, `item-types.ts`, `collections.ts`, `users.ts`): the CRUD functions the app calls. They build the query and shape the result into plain, UI-shaped types. Inside `(app)` the loaders are called by `getUserSession()`, except per-visit data such as recent items, which pages fetch.
- **`src/lib/` is grouped by area** (`boundaries.test.ts` checks the root): one folder per area (`ai/`, `auth/`, `items/`, `collections/`, `session/`, `search/`, `pricing/`, `billing/`, `helpers/` for generic code, `db/`, `constants/`). Only `utils.ts` stays at the root (shadcn's `components.json` points at `@/lib/utils`). Demo content for the seed lives in `prisma/seed-data.ts`, outside the app. Rules live in `lib/<area>/`; queries in `lib/db/`; connections in `services/`.
- **Types live in `src/types/`, one file per area** (plus `next-auth.d.ts`, the Auth.js augmentation). No `index.ts`; import each file directly. They are declarations only: the only imports allowed are `import type` from `@/types/` and `@/generated/` (e.g. Prisma's `Plan` enum). Components never import from `@/lib/db/`. Nothing outside `types/` exports a type, except the two calculated from a constant's value, which stay beside it: `RateLimitPolicy` and `Flag`. `boundaries.test.ts` enforces all of this.
- **The user session holds what rarely changes** (`src/lib/session/user-session.ts`, `server-only`). `getUserSession()` loads `{ user, billing, aiAvailable, itemTypes, itemCounts, pinnedItems, collections, searchItems }`, cached per request, and is called **only by the `(app)` layout**, which runs on a full page load and on a reset, not on navigation. Item bodies are never in it: items come as counts (total, favorites, per type, counted in the database), the pinned list, and `searchItems` (the search palette's card summaries, newest first, capped at `SEARCH_ITEM_LIMIT`). Collections are few, so all are included, with item count and ranked types. `UserSessionProvider` (`src/components/session/`) holds it on the client; components read it with `useUserSession()` and derive display shapes with `src/lib/session/session-selectors.ts`. A test guards that the session is not cached across requests.
- **Billing** lives on `SubscriptionPeriod` rows. Pro is a live `PAID` period (`getCurrentUser()`, database only). Free limits (`PRICING.free`: items, collections, file and image types) are enforced on the server in `createItem` / `createCollection`, counted inside the write's transaction (`lib/billing/plan-rules.ts`). A refused create answers `code: "plan-limit"`, and the dialog hands it to `UpgradePromptProvider` (in the `(app)` layout), whose upgrade dialog offers `startCheckout` (the `/billings` Upgrade button opens it too, with no reason); the New Item dialog and sidebar mark Pro-only types from the session plan (`canUseType`), but the server decides. Upgrading: `startCheckout` inserts a `PENDING` period and redirects to Stripe Checkout; the webhook (`checkout.session.completed` / `.expired`) settles it. `getUserSession()` also calls `resolveBilling()`, which asks Stripe once per load about the latest record (a pending checkout, else the customer's active subscription, recording a renewal), within the `billingCheck` rate limit and `SESSION_VENDOR_LIMITS` (3 seconds, no retries, then the stored rows answer; other calls use the client's 20 seconds), and stores `billing: { plan, interval, periodEnd, isCustomer }` in the session (no vendor ids). Account deletion cancels every open subscription first, deletes the rows, then empties the user's R2 folder; a file that won't delete is logged, as the account is already gone. Checkout, the portal and the already-Pro redirect all return to `/billings`, built on the server, never from the caller. Bills (amounts, receipts) stay on the vendor, behind `openBillingPortal`. Vendor return links come from `appUrl()` (`lib/billing/app-url.ts`): Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, else the request's host; there is no `APP_URL` setting. Local webhooks: `stripe listen --events checkout.session.completed,checkout.session.expired --forward-to localhost:3000/api/billing/stripe/webhook`.
- **Not in the session, fetched per visit:** recent items (`getRecentItems()`, called by the dashboard page; pages re-render on navigation) and full item lists.
- **Item detail is a drawer, not a page.** Clicking an `ItemRow` calls `openItem(summary)` from `useItemDrawer()`; `ItemDrawerProvider` (in the `(app)` layout) shows the card's summary at once and fetches the body from `GET /api/items/[id]` via `fetchItemDetail()` (a 401 from the proxy or a redirect both mean signed out).
- **Global search is a command palette**, `SearchPaletteProvider` (`src/components/search/`, in the `(app)` layout inside `ItemDrawerProvider`): Cmd+K / Ctrl+K toggles it and the top bar's `SearchTrigger` opens it. It filters the session's `searchItems` and `collections` in the browser with `searchScore()` (`src/lib/search/search.ts`): fuzzy on the title or name, a plain contains-match on the other card fields (type, description, file name, tags), never the id. An item opens in the drawer, a collection its page.
- **New items come from a dialog**, `ItemCreateDialog` behind the top bar's New Item button, offering only `CREATABLE_ITEM_TYPE_NAMES`. It and the drawer's edit mode render the same `ItemFormFields`, driven by `editableFieldsFor()`; the per-type rules live in that map, not in either form. Both forms pick collections with `CollectionPicker` (shadcn `popover` + `command`, options from the session); `createItem` / `updateItem` check every `collectionIds` entry is the user's inside the write's transaction and throw `CollectionNotFoundError` (`src/lib/collections/collection-errors.ts`), which the actions answer as a `collectionIds` field error. An edit that sends `collectionIds` replaces the links (kept ones keep `addedAt`); one that leaves it out keeps them.
- **AI suggestions** are Pro only. `SuggestTags` and `SuggestDescription` (in `ItemFormFields`, so both item forms have them; hidden unless the session's `aiAvailable` says the user is on Pro and the OpenAI account has credits) call `generateAutoTags` / `generateDescription` (`src/actions/ai.ts`) with the unsaved form. Both go through `withAiChecks()`: session, `canUseAi`, validation, then the shared `ai` rate limit, so a refused click uses no try. Item text goes in the model's `input`, never its instructions, and `lib/ai/` checks every reply (`parseSuggestedTags()`, `parseDescription()`). `json_object` mode answers 400 unless `input` itself says JSON. A link's URL is only read as text, never fetched, and a file's stored contents are never sent, only its name. Suggestions save nothing: an accepted tag or generated description goes in the form, and a generated description replaces what was there.
- **AI code explanations** are Pro only, for snippets and commands in the drawer read view. `ExplainableCode` fills optional slots on `CodeEditor`, which the forms leave empty, and calls `explainCode` with the saved code; each click asks again and nothing is stored. Free users see a Crown with a tooltip, and a Pro user sees nothing when `aiAvailable` is false. Replies are plain markdown through `generateText()`, not JSON, rendered by `MarkdownView` with no raw HTML and no images (the code can steer the model, and an image would send its address with no click; only `MarkdownEditor`, for what the user wrote, passes `allowImages`). `complete: false` means a token cap cut the reply, which is kept with a note, and code past `AI_CODE_MAX_CHARS` gets a note too. The drawer keys it by item, and `useMountedRef()` drops an answer that lands after its component has gone.
- **AI prompt optimization** is Pro only, for prompts in the drawer read view. `OptimizablePrompt` wraps `MarkdownEditor` and shares `AiHeaderButton` (its three plan states) with `ExplainableCode`. `optimizePrompt` saves nothing; Use it saves through `updateItem`, because no form's Save is there to be the consent. The answer replaces the whole prompt, so nothing partial may reach it: a prompt past `AI_PROMPT_MAX_CHARS` is refused before the rate limit, never cut, and a reply cut off by the token cap is invalid JSON, so it is no answer. `parseOptimizedPrompt()` also refuses a reply adding a markdown image or re-pointing one, reference definitions included: the choice view shows none, but saved text is the user's own markdown, which loads them. The model must find a real flaw to change a prompt, or it polishes every one. This is the one call with its own timeout and retries (`AiCall.timeoutMs`, `maxRetries`): one 60-second attempt, as it writes the whole prompt back at about 170 tokens a second.
- **File and image items upload straight to R2** (a Vercel function body is capped at 4.5 MB). `FileUpload` checks the pick with `checkFile()` (`src/lib/items/file-rules.ts`, rules in `UPLOAD_RULES` in `src/lib/constants/files.ts`); `createItem` checks it again, rate limits (`upload` policy) before saving anything, and saves the item without file fields (lib/db `createItem` names its columns, so it never writes file fields), then `uploadItemFile` signs a PUT link with the type and size signed in, and writes `fileKey`/`fileName`/`fileSize`/`mimeType` onto it (`setItemFile`). If that file step throws, the item is kept without a file and the answer carries `code: "file-not-uploaded"`, which closes the dialog; the browser sends the file with `uploadFile()` (XHR, for progress, with `UPLOAD_TIMEOUT_MS`). The stored type comes from the extension, never the browser. `deleteItem` returns the item's `fileKey` and the action deletes the object after the row. The drawer shows images from the file route and a Download button; the bucket is private.
- **Updating the session:** `setUser` / `setItemTypes` / `setItemCounts` / `setPinnedItems` / `setCollections` / `setSearchItems` from `useUserSession()` change it locally (for optimistic CRUD; the database save runs separately, and keeping counts and collection totals in step is the caller's job). `resetProfile()` reloads it from the server: from the hook on the client (`router.refresh()`), or from `@/lib/session/user-session` at the end of a server action (`refresh()`). A re-sent server session always replaces local state.
- **Scoping mechanism:** `lib/db` functions (and `changePassword`) each call `requireCurrentUserId()`, which reads the per-request cached `getCurrentUser()` and redirects to sign-in when there is none. The rules are under "Security and auth".
- **Auth is Auth.js v5 with a split config**: `src/auth.config.ts` (edge-safe, used by `src/proxy.ts`, which guards `/dashboard`, `/profile`, `/settings`, `/collections`, `/items`, `/favorites`, `/pinned`, `/billings` and `/api/*` except `/api/auth/*` and the billing webhook) and `src/auth.ts` (Prisma adapter, JWT sessions). The JWT carries only the user id and a `sessionVersion`; `getCurrentUser()` (`services/auth/session.ts`) reads the user row once per request (cached) and does two jobs: it is the auth check (guards, actions, auth pages) and the profile the user session holds (including `createdAt` and `hasPassword`). It also rejects a token whose `sessionVersion` is behind the user row's: password change and reset bump it, which signs out every other session (the proxy only verifies the JWT). Providers are GitHub and Credentials: `auth.config.ts` holds an edge-safe Credentials placeholder that `auth.ts` replaces with the bcrypt check from `src/lib/auth/authorize-credentials.ts`, and sets `pages.signIn`/`pages.error` to `/sign-in`. Sign-in, register and sign-out are server actions in `src/actions/auth.ts`; account creation lives in `src/lib/auth/register-user.ts`, shared with `POST /api/auth/register` (kept for non-browser clients). When the email is taken, the owner gets an email instead. Zod schemas: `src/lib/auth/auth-schemas.ts`; redirect helpers: `src/lib/auth/auth-redirect.ts`.
- **Email verification is on unless `EMAIL_VERIFICATION=off`** (`src/lib/auth/email-verification.ts`). Off skips the Resend email on register and the unverified-user block in `authorize`; users registered while off stay unverified and get a link on their next sign-in once it's back on.
- **Auth flows are rate limited** through `checkRateLimit(policy, headers, key?)` in `src/services/rate-limit.ts` (Upstash sliding window, policies in `RATE_LIMITS` in `src/lib/constants/rate-limits.ts`). `rateLimitKey()` builds every bucket key there: `{key}-{ip}` (key trimmed and lower-cased), just `{key}` for a policy with `perIp: false`, else the IP alone. Sign-in and resend pass the email (`{email}-{ip}`, so a stranger can't lock an account out from elsewhere); uploads and change password pass the session `userId` (`perIp: false`, so a VPN gets no fresh bucket); register checks per IP and then per email alone (`registerEmail`, `perIp: false`) through `checkRegisterRateLimit()` in `src/lib/auth/register-rate-limit.ts`, shared with the API route; forgot and reset password stay IP-only. It fails open: with `UPSTASH_REDIS_REST_URL`/`_TOKEN` unset, or Upstash down or slow, requests are allowed. The sign-in check lives in `authorizeCredentials()` and throws `RateLimitedError`, which the action turns into a message. Other actions check after validation and return `{ toast }` (`ActionForm` shows it as an error toast); the register route answers 429 with `Retry-After`. Creating a file or image item uses the same check and wording (`upload` policy), returned as `ActionResult` `error.message`, which the New Item dialog toasts.
- **`redirectIfSignedIn()`** sends a signed-in visitor to their `callbackUrl`, else `/dashboard`. It checks the database, so a valid JWT whose user row is gone stays put instead of looping between `/sign-in` and the `(app)` layout.
- **Forms are server-rendered with client islands.** Pages stay server components and pass a server action plus server-built fields to `ActionForm` (`src/components/shared/`), the one client boundary holding `useActionState`. `FormField`, `FormError` and `SubmitButton` are small client leaves that read its state. Actions return `FormState` (`src/types/forms.ts`). Prefer this over a whole `"use client"` form.
- **Components** are grouped by feature under `src/components/`. `skeleton/` holds loading placeholders shaped like the content they stand in for, used as `<Suspense>` fallbacks around a page's slow query so the rest of the page renders first. `src/components/ui/` is shadcn-generated.
- **`public/` does not currently exist.** For favicons and social images, use App Router metadata files (`icon.png`, `apple-icon.png`, `opengraph-image.png` in `src/app/`). Recreate `public/` only for assets that need a stable, hand-referenced path.

### Generated route types

The global `LayoutProps` / `PageProps` / `RouteContext` helpers are generated into `.next/types/` and `.next/dev/types/` (both in the `tsconfig.json` `include`). They exist only after `next dev` or `next build` has run once; on a clean checkout, unresolved-type errors are expected until then, so build before chasing them.

### Styling: Tailwind v4, configured in CSS

Tailwind v4 is configured from `src/app/globals.css` via `@import "tailwindcss"` and `@theme` blocks; PostCSS just loads `@tailwindcss/postcss`.

Add or change design tokens in `globals.css` (shadcn setup, `dark` variant, colour and radius tokens), not in a JS config.

Fonts: `layout.tsx` loads Geist and Geist Mono via `next/font/google` into `--font-sans` / `--font-mono` on `<html>`. `--font-sans: var(--font-sans)` works because `@theme inline` writes the `var()` into the utility, which reads the value `next/font` sets.

### Constants: `src/lib/constants/`

User-facing strings and tunable values live in `src/lib/constants/`, one file per concern (`ai.ts`, `routes.ts` with `ROUTES`, href builders and one-shot `FLAGS`, `limits.ts`, `security.ts`, `rate-limits.ts`, `files.ts`, `emails.ts`, `env.ts`, `messages/`, and so on). Add new ones there rather than inline.

- **Import each file directly; there is no `index.ts`.** Every file is data plus small pure formatters with no `process.env` reads, so any of them is safe in a client component. Env reads stay at their call sites as literal `process.env.NAME`.
- **Logic stays out.** Functions like `checkRateLimit` import their values from here.
- **Text that states a value derives it.** Email and page copy says "expires in …" through `formatDuration(RESET_TOKEN_TTL_MS)`, never a typed "1 hour"; `minLength` uses `PASSWORD_MIN_LENGTH`.
- **Page titles** are just the page name (`title: "Sign in"`); the root layout's `APP_TITLE` template adds `| Stashboard`.
- **Stays inline on purpose:** JSX UI copy (headings, labels, button text), the `proxy.ts` `matcher` (Next reads it statically, so keep it in step with `ROUTES` by hand), `PageProps<"/route">` type arguments, `console.error` text, `src/components/ui/` and `src/hooks/` (shadcn-generated), and `prisma/seed-data.ts`.
- **`ROUTES` lists linked-but-unbuilt pages** (items); `routes.test.ts` keeps them in a `NOT_BUILT_YET` set and fails when one gets its page, so remove it from the set then.

### Class merging: the `cn` package

The [`cn`](https://github.com/shadcn-ui/cn) npm package is shadcn's drop-in replacement for `clsx` + `tailwind-merge`. The `ui/` files import it straight from `"cn"`; `src/lib/utils.ts` re-exports it for app code. Don't rewrite `utils.ts` back to the old wrapper.

### Database: Prisma 7 + Neon

- Config is in `prisma.config.ts`, not the schema: it loads `.env` via `dotenv` (Prisma 7 no longer does) and gives the CLI `DIRECT_URL` (unpooled). The app uses the pooled `DATABASE_URL` through the `PrismaNeon` driver adapter in `src/services/prisma.ts`, which is the only place a `PrismaClient` should be constructed.
- **Primary keys are UUID v4** (`@default(uuid())`, generated by Prisma, not a DB default; columns stay `text`). Don't hand-pick ids in seeds or fixtures. Match rows on natural keys (email, slug, name) instead.
- The client is generated into `src/generated/prisma/` (gitignored). `migrate dev` no longer runs `generate` for you. Run `db:generate` after schema changes if the dev server doesn't pick them up.

- Neon MCP rules and ids: see "Production and data". Production only changes when a merge to `main` triggers `db:deploy`.

## AGENTS.md is generated

`next dev` rewrites the content between `<!-- BEGIN:nextjs-agent-rules -->` and `<!-- END:nextjs-agent-rules -->` (`node_modules/next/dist/server/lib/generate-agent-files.js`); edits inside the markers are overwritten. It leaves this file alone: because `AGENTS.md` exists and hosts the block, `writeAgentFiles` returns `claudeMd: 'skipped'`. A bare `@AGENTS.md` CLAUDE.md is only written when neither file exists.

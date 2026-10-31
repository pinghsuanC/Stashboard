# Features

<!-- One `##` section per feature, in build order. Remove a section once it lands and is recorded in History. -->

## History

<!-- Keep this updated, earliest to latest. -->

- **2026-09-19** — Initialized Next.js 16 project: React 19, TypeScript, Tailwind v4, App Router.
- **2026-09-20** — Dashboard phase 1: shadcn/ui set up, `/dashboard` shell with top bar, dark mode by default.
- **2026-09-20** — Dashboard phase 2: collapsible sidebar (types, collections, user footer), mobile drawer, live top-bar trigger.
- **2026-09-20** — Dashboard phase 3: main area with 4 stat cards, collections grid, pinned items, 10 recent items. Components switched to arrow functions.
- **2026-09-23** — Database phase 1: set up Neon and Prisma, updated schema, seeded database.
- **2026-09-25** — Database phase 2: dashboard and sidebar loaded from the database.
- **2026-09-28** — Sidebar: PRO badge on File and Image types.
- **2026-09-28** — Audit quick wins: sidebar and dashboard fixes, robustness guards, index migration.
- **2026-09-29** — Auth phase 1: GitHub sign-in, protected dashboard, session user profile; demo user removed.
- **2026-09-29** — Auth phase 2: email/password sign-in and `/api/auth/register`, bcrypt hashing, Zod validation.
- **2026-09-29** — Auth phase 3: custom sign-in and register pages, sidebar sign-out, shared avatar, register toast.
- **2026-09-30** — Email verification: Resend link on register, unverified sign-in blocked with auto-resend, email templates module.
- **2026-10-01** — Email verification toggle: `EMAIL_VERIFICATION=off` skips the verification email and sign-in block; on by default.
- **2026-10-01** — Forgot password: emailed 1-hour reset link via `PasswordResetToken`, reset verifies the email, no account enumeration.
- **2026-10-01** — Profile page: `/profile` in shared `(app)` layout with user info, usage stats, change password and delete account; Vitest set up.
- **2026-10-01** — User session: profile, item counts, pinned items and collections loaded once in the `(app)` layout with local setters and `resetProfile()`; recent items fetched per visit.
- **2026-10-03** — Rate limiting: Upstash sliding-window limits on sign-in, register, forgot/reset password and verification resend; fails open; toast in forms, 429 with `Retry-After` from the API. Unknown-email sign-in now costs a bcrypt compare.
- **2026-10-03** — Constants: user-facing strings and tunable config moved to `src/lib/constants/`; brand is Stashboard with one `Page | Stashboard` title format; email and page expiry text derived from the link lifetimes.
- **2026-10-03** — Items list view: `/items/[type]` grid of one type's items with type-colored cards, streamed behind a skeleton; mobile drawer closes on navigate.
- **2026-10-03** — Test coverage: unit tests for email verification, email sending, form errors and the register and verify-email routes.
- **2026-10-04** — Item drawer: right-side detail sheet opened from item cards, item body loaded on click from `/api/items/[id]`; a missing or another user's item signs out.
- **2026-10-06** — Item edit: drawer edit mode with per-type fields from a constants map, `updateItem` action with Zod validation, tags matched by slug; lists and session refresh on save.
- **2026-10-06** — Service refactor: `services/` owns every outside connection (Prisma, Resend, Upstash) and the auth service; `lib/db` stays the interface with the profile check; `lib/` grouped by area; a boundary test enforces the layers.
- **2026-10-06** — Refactored types into `src/types/`.
- **2026-10-06** — Item delete: drawer Trash button opens a confirm dialog naming the item; owner-scoped `deleteItem` action, success toast, lists and session refresh.
- **2026-10-07** — Item create: New Item dialog with a type picker and per-type fields shared with the edit drawer; `createItem` action with Zod validation, tags matched by slug; lists and session refresh.
- **2026-10-07** — Fix: item drawer dates revived from JSON by `reviveDates()`, whose field list must name every top-level `Date` field.
- **2026-10-07** — Pointer cursor: one base rule in `globals.css` gives enabled buttons and `role="button"` elements the pointer that Tailwind v4 dropped; disabled controls and the sidebar rail keep their own cursors.
- **2026-10-07** — Unused tags: deleting an item or editing its tags deletes the user's tags no item uses, in the same transaction.
- **2026-10-07** — Code editor: snippet and command content shown and edited in a bundled Monaco editor with a macOS-style header (window dots, language, copy), height up to 400px then scrolls; free-text language mapped to Monaco ids; autocomplete off; `dompurify` overridden to a patched version.
- **2026-10-07** — Markdown editor: note and prompt content written in a Write tab and shown rendered in Preview (GFM, newlines kept, no raw HTML), styled like the code editor with copy and a 400px max height; read-only Preview in the drawer.
- **2026-10-08** — File uploads: file and image items upload straight to Cloudflare R2 through signed links (5 MB, rate limited, 1-minute timeout); user-scoped storage keys; sandboxed file route for previews and downloads; R2 object deleted with its item; proxy answers signed-out API calls with 401.
- **2026-10-08** — Rate limit keys: buckets keyed by subject through one helper; uploads limited per user across IPs, register adds a per-email limit from any IP; sign-in and resend stay email plus IP.
- **2026-10-08** — Image gallery: `/items/images` shows 16:9 thumbnail tiles in a 3-column grid with a subtle hover zoom and a matching skeleton; items carry `hasFile` (never the storage key), and a missing or unloadable image shows a placeholder.
- **2026-10-08** — File list: `/items/files` shows a single-column list with an extension icon, file name over the item title, size, upload date and a download button, stacking on mobile, with a matching skeleton; item summaries carry `fileName`, `fileSize` and `createdAt` (never the storage key).
- **2026-10-09** — Image cache: image previews cached by ETag (304, no R2 read); cache busted on sign-out and account deletion.
- **2026-10-09** — Collection create: New Collection dialog (name, description, favourite star) with a `createCollection` action, slug from the name, duplicate names as a field error; sidebar, cards and stats refresh on save.
- **2026-10-11** — Item collections: collection picker in the New Item dialog and the drawer edit form.
- **2026-10-11** — Collection pages: `/collections` grid of every collection and `/collections/[slug]` with Items, Files and Images sections in their type layouts, streamed behind a skeleton; slug URLs checked before querying; names capped at 50 characters.
- **2026-10-11** — Collection edit and delete: Edit and Delete buttons on the collection page; the New Collection dialog reused in edit mode, with the page following a renamed slug; delete asks first and keeps the items, removing only the collection and its links.
- **2026-10-11** — Global search: Ctrl+K / ⌘K command palette and a centred top bar search box over the session's 50 newest items and all collections; fuzzy on titles, contains-match on card fields; items open in the drawer, collections their page; shortcut ignored while a dialog is open and kept from the browser.
- **2026-10-11** — Pagination: type, collection and `/collections` pages load 21 per page from `?page=` with numbered links and greyed-out Prev/Next; a page past the end redirects to the dashboard; `/collections` queried per page behind a skeleton; collection section counts dropped.
- **2026-10-12** — Settings page: `/settings` holds change password (hidden for GitHub-only users) and delete account, moved from Profile; password change returns there with the toast; sign out moved from the sidebar to a Profile card; route guarded by the proxy.
- **2026-10-12** — Code cleanup: change password rate limited per user; upload limit checked before the item is saved; proxy guards `/items`; `createItem` never writes file fields; unused `isResetting` dropped from the session context.
- **2026-10-12** — Editor preferences: Settings card with theme (VS Dark, Monokai, GitHub Dark), font size, tab size, word wrap and minimap, auto-saved with a toast and reverted on failure; stored as `editorPreferences` JSON on `User`, read field by field with defaults; every Monaco editor follows them; old `preferredTheme`/`preferredFontSize` columns dropped.
- **2026-10-12** — Favorites page: `/favorites` lists favourite collections then items in a dense monospace list with counts, empty states and a skeleton; items open the drawer, collections their page; top bar star link; sidebar shows the 10 newest favourite collections with See all; route guarded by the proxy.
- **2026-10-12** — Sticky top bar: the top bar stays pinned while the page scrolls, under dialogs and sheets; on phones it keeps only the sidebar trigger, Favorites, New Collection and New Item, with the search box hidden.
- **2026-10-12** — Favourite and pin toggles: drawer Favorite and Pin buttons and a collection page star save at once, disabled while saving and reverted with a toast on failure; owner-scoped actions send the new value, never a flip; item toggles keep `updatedAt` so lists don't reorder behind the drawer, the collection star moves it so the sidebar's favourites show it; `/pinned` lists every pinned item from the session, linked above Types; route guarded by the proxy.
- **2026-10-16** — Homepage mockup: static `/` landing page prototype in `context/references/homepage/` with a chaos-to-order hero (icons drift, bounce and dodge the cursor), features, Pro AI section, pricing with a monthly/yearly toggle, CTA and footer; fades in on scroll, honours reduced motion, stacks on mobile.
- **2026-10-16** — Homepage: `/` is the public static marketing page ported from the prototype, with mobile menu, pricing toggle and brand logos; prices derived from `PRICING`.
- **2026-10-23** — Billing 1, database: `SubscriptionPeriod` table replaces `User.plan` and the `stripe*` columns; `plan` / `isPro` derived in `getCurrentUser()` from a live `PAID` period (1-day grace, not revoked), never from Stripe; demo user Pro through a granted period.
- **2026-10-24** — Billing 2, Stripe core: Free limits enforced on the server (50 items, 3 collections, no file or image items); Stripe Checkout starts as a `PENDING` period, settled by a signed webhook that cancels paid checkouts no period claims; the session load checks Stripe once (renewals recorded, stored rows on failure) and holds `billing` without vendor ids; account deletion cancels subscriptions first; webhook public in the proxy.
- **2026-10-24** — Billing return links: `APP_URL` dropped; Stripe return links use Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, else the request's own host and protocol (local hosts http), so no setting is needed wherever it deploys.
- **2026-10-25** — Billing 3, plan gating: a Free user at a limit or picking File/Image gets a "Pro is needed" dialog with monthly and yearly checkout; PRO tags follow the plan; walkthrough script covers Free, trial, lapse and paid; the `/items` link and Settings billing return are deferred.
- **2026-10-26** — Production E2E test: auth, item and collection CRUD, cross-account 404s, Free gating, Stripe sandbox upgrade and cancel-on-delete, and R2 uploads verified on the live site; Stripe env and webhook and R2 CORS fixed in production config; Settings billing section found missing. Report in `context/reports/2026-10-26-production-e2e.md`.
- **2026-10-26** — Billing 4, billing page: `/billings` shows the plan, past subscriptions a page at a time and past bills on Stripe; Free users upgrade from it; checkout returns land there.
- **2026-10-31** — AI auto-tagging: Pro-only Suggest Tags in the item forms returns up to 5 `gpt-6-luna` tags, click one to add it; `generateAutoTags` limited to 20 calls an hour; button hidden when the OpenAI account has no credits, checked on session load and kept 5 minutes.
- **2026-10-31** — AI description summaries: Pro-only icon button at the description field writes a 1-2 sentence `gpt-6-luna` summary from the unsaved form, using whatever the type has, and replaces the field; URLs read as text and never fetched; shares the 20 calls an hour with tags.

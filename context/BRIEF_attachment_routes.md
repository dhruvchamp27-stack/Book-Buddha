# Build brief — R9 attachment routes 2–5

Repo root `C:\Users\Admin\Desktop\Book Buddha`; commands run from `book-buddha/`.

The storage engine is built and tested (`src/attachments/attachments.ts`, 24 tests, migration v7).
The HTTP seam is built and committed (`d6da71d`): `src/api/attachment-routes.ts` already has
route 1 (`GET /attachments/:id`, metadata), the `asRequestError` error mapping, and
`ATTACHMENT_BODY_LIMIT_BYTES`; it is already registered in `server.ts` via
`registerAttachmentRoutes(app, { db, storageRoot })`. **Only routes 2–5 are missing.**

**Another agent is working in parallel on `server.ts`, `repository.ts`, `reports-wiring.test.ts`
and `report-unknown-fair.test.ts`. Do not touch any of those.** You own exactly:
`src/api/attachment-routes.ts` and `src/api/attachments-api.test.ts`.

## Read first
1. `src/api/attachment-routes.ts` — the whole file, especially its header (transport, size,
   errors). Follow it; do not redesign it.
2. `src/attachments/attachments.ts` — `storeAttachment`, `listAttachments`, `getAttachment`,
   `getAttachmentPath`, `deleteAttachment`, `ATTACHMENT_ENTITY_TYPES`, `StoreAttachmentInput`,
   `DEFAULT_MAX_ATTACHMENT_BYTES`. Read the real input fields — invent none.
3. `src/api/attachments-api.test.ts` — the existing 4 tests and how they make a temp storage root.
4. `context/decisions.md` — search for **S11-19** (base64 transport, a defaulted ruling).

## What to build (in `attachment-routes.ts`)
2. **`POST /attachments`** — JSON body `{ entityType, entityId, fileName, mimeType, contentBase64 }`
   (adjust names to what `StoreAttachmentInput` actually needs). Route option
   `bodyLimit: ATTACHMENT_BODY_LIMIT_BYTES` — REQUIRED, per the header. Decode base64 strictly:
   refuse a body that is not valid base64 with a 400 (Node's `Buffer.from(x, 'base64')` silently
   ignores junk — validate with a regex or a round-trip check). Returns 201 + the metadata.
3. **`GET /attachments?entityType=&entityId=`** — list for one entity; both params required;
   an `entityType` not in `ATTACHMENT_ENTITY_TYPES` → 400.
4. **`GET /attachments/:id/content`** — the bytes, with the stored `Content-Type` and a
   `Content-Disposition` carrying the file name **safely quoted** (strip `"`, `\r`, `\n`; consider
   RFC 5987 `filename*=` for non-ASCII). 404 when missing. Stream or send the buffer read from
   `getAttachmentPath`; refuse any path that resolves outside `storageRoot` (defence in depth).
5. **`DELETE /attachments/:id`** — 204 on success, 404 when missing. **Check whether
   `deleteAttachment` writes the audit log.** Audit log is a fixed part of this product
   ("tamper-evident"). If it does not, DO NOT add audit writing yourself — report it plainly as a
   finding; that is the owner's call.

Every engine call goes through `asRequestError` (400 with the engine's message), as the header
says. Validate request bodies/queries the way `server.ts` does (find its `parseBody` and the
schema library it uses; reuse them — no new dependency).

## Tests (append to `attachments-api.test.ts`; do not edit the existing 4)
Over HTTP with `app.inject`, `buildApi(repository, { __unsafeDisableAuthForTests: true,
attachmentStorageRoot: <a fresh temp dir under os.tmpdir()> })` — TWO positional arguments. Clean
the temp dir up after. **Never write under the repo.**
- upload → list → content round-trip: bytes come back byte-identical; Content-Type matches.
- a body larger than Fastify's 1 MB default but under the cap is ACCEPTED (proves `bodyLimit` is
  on the route) — e.g. a ~1.5 MB payload.
- over the engine cap → 400 with the engine's message (not 413/500 — or, if Fastify's bodyLimit
  answers first with 413, assert that and say why in a comment).
- invalid base64 → 400. Unknown entityType → 400. Missing attachment on content/delete → 404.
- delete → 204, then content → 404, and the file is gone from disk.
- a file name containing `"` and a newline yields a safe `Content-Disposition` header.
- auth: without `__unsafeDisableAuthForTests`, the new routes answer 401 (copy how
  `auth-enforcement.test.ts` checks a protected route).

## Hard constraints
No dependency, no migration, no git. No file outside the two you own. Strict TS
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`). Local imports
end `.js`. If an existing test goes red, STOP and report.

## Gates (PowerShell, from `book-buddha/`)
`.\node_modules\.bin\tsc.cmd; $LASTEXITCODE` FIRST, then `.\node_modules\.bin\vitest.cmd run --root .`
Never pipe into tail/head. Known flake: `allocateProportionally … fuzz` in
`src/accounting/engine.test.ts` — re-run alone. Another agent adds tests concurrently, so totals
move; report which files are yours.

## Report back
tsc exit code; vitest `Test Files` / `Tests` lines verbatim; files changed; the audit-log finding;
how oversize bodies are answered; anything in the engine that surprised you.

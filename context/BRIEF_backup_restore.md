# Build brief — R11 backup, restore and integrity check (backend)

Repo root `C:\Users\Admin\Desktop\Book Buddha`; commands run from `book-buddha/`.
**Another agent is building stock correction in parallel and owns `repository.ts`, `server.ts`,
`migrations.ts`, `stock-layers.ts`. Do not touch any of those.** You own a NEW folder
`src/backup/` and a NEW file `src/api/backup-routes.ts` exporting `registerBackupRoutes(app, ctx)`
(copy the shape of `src/api/attachment-routes.ts`). **Do not register it in `server.ts`** — I add
that one line after both agents finish. Your HTTP tests build their own Fastify app (or call
`buildApi` and then `registerBackupRoutes` on it) so they do not need `server.ts` changed.

## SAFETY — read twice
This module copies and replaces database files. **Every test works only inside a fresh directory
under `os.tmpdir()`, created and removed by the test.** Never open, copy, list or write anything in
the repo folder, the user's home, or any path from `BOOK_BUDDHA_DATABASE` (never read or set it).
Never default a path to the current working directory in a way a test could hit.

## What the spec says (spec/Design Document §14.3, §16, §25D — read §14.3 and §16)
- "You **choose the scope** (everything — database, attachments, logo, audit log; or database only),
  and the backup screen **states plainly what is and isn't included**. **Restore warns** and offers
  a **pre-restore backup** first, **sanitises** incoming settings, and can **preserve users and
  counters**." One database file per company; one backup covers the whole company.
- Acceptance: "an existing prototype database restores and still migrates"; "restored books show
  the same numbers". REMAINING_BUILD_PLAN S11: "Offline backup/restore of the SQLite file with an
  integrity check, plus automated backups."
- Facts: the audit log (`audit_events`, `audit_copy`) and the logo live INSIDE the database, so a
  database backup carries them. Attachments are FILES under a storage root
  (`resolveAttachmentStorageRoot` in `server.ts` — read it, do not edit it). Users are
  `auth_users` (+ `auth_sessions`); numbering counters include `customer_number_counters` — grep
  for every counter table/column (invoice, bill, credit-note numbering) before deciding what
  "counters" means, and list them in your report.

## What to build (`src/backup/backup.ts` + tests)
A backup is a **folder**: `<backupsRoot>/<timestamp-id>/` containing `book-buddha.db`,
optionally `attachments/…`, and `manifest.json`. (No zip: Node has no zip writer and no
dependency may be added.) Write the folder under a temp name and rename it into place at the end,
so a half-written backup never looks complete.

1. `createBackup(db, { backupsRoot, attachmentsRoot?, scope: "DATABASE_ONLY" | "EVERYTHING",
   label?, now? })` → manifest.
   - Database copy via better-sqlite3's online backup API (`db.backup(path)`, it is async —
     consistent while the app is live), NEVER a raw file copy of an open database.
   - `manifest.json`: format version, created-at (ISO instant) and IST date, scope, the schema
     migration version, app `package.json` version, row counts for key tables, SHA-256 of every
     file, and **plain-English `included` and `notIncluded` lists** (the spec's "states plainly").
   - Then **verify** the copy (step 3) and record the result in the manifest; a backup that fails
     verification is reported as failed, not left looking good.
2. `listBackups(backupsRoot)` — manifests, newest first; a folder without a valid manifest is
   reported as incomplete, never silently skipped.
3. `verifyBackup(folder)` → `{ ok, checks[] }`: every SHA-256 matches; `PRAGMA integrity_check`
   = ok; `PRAGMA foreign_key_check` empty; **the journal balances** (Σ debit = Σ credit over
   `journal_lines`); every journal entry balances on its own. Open the copy READ-ONLY.
4. `restoreBackup({ folder, targetDbPath, targetAttachmentsRoot?, preserveFrom?, options })`.
   **It never writes over a database that is open.** Restore writes the backup into
   `targetDbPath` (which must NOT exist, or is moved aside first into a **pre-restore backup**
   using `createBackup` on it — the spec's "pre-restore backup first"), then opens it with
   `new AccountingRepository(targetDbPath)` so **it migrates** to the current version, then
   re-verifies. Options:
   - `preserveUsers` / `preserveCounters`: copy those tables' rows FROM the database being
     replaced (`preserveFrom`) INTO the restored one, inside one transaction.
   - "sanitises incoming settings": find what settings exist (company settings columns?) and
     decide what sanitising can honestly mean here; if nothing in the schema needs it, say so in
     your report instead of inventing a rule.
   - Returns a plain-English list of warnings (what will be lost: activity after the backup date,
     with counts where measurable).
   Restoring INTO the live running app (close, swap, reopen) is out of scope for the backend
   slice — say so in the module header; it belongs to the app shell.
5. `runAutomaticBackup(db, { backupsRoot, keep = 7, now })`: creates a DATABASE_ONLY backup if the
   newest automatic one is older than 24 h, then prunes AUTOMATIC backups beyond `keep` (never a
   manual one). No timer wiring — just the function.
6. `src/api/backup-routes.ts`: `POST /backups` (scope, label), `GET /backups`,
   `POST /backups/:id/verify`. **No restore route** (see 4). Backup ids must be validated against
   a strict pattern so `:id` can never escape `backupsRoot` (path traversal test). Errors → 400 via
   `RepositoryValidationError`, missing → 404, as `attachment-routes.ts` does.

## Tests (`src/backup/backup.test.ts`, `src/api/backup-routes.test.ts`)
- **"Restored books show the same numbers"**: build real books (invoice, payment, bill, stock,
  credit note), back up, restore to a new path, and assert the trial balance, `getReceivables`
  total and `getInventoryValuation` are IDENTICAL before and after.
- **"An existing prototype database restores and still migrates"**: build a DB to an OLD version
  (`migrations.filter(m => m.version <= 15)` or similar — see how
  `src/database/migration-*.test.ts` do it), insert rows by raw SQL, back it up, restore, and prove
  it opened at the current version with the rows intact.
- Tampering: change one byte of the backed-up db → verify fails on SHA-256; corrupt the journal
  balance in a copy → verify names that check.
- Scope: EVERYTHING includes attachment files byte-identical; DATABASE_ONLY does not, and the
  manifest's `notIncluded` says attachments.
- Pre-restore backup exists and verifies; preserveUsers keeps the current admin (can still log in
  — use the repo's auth methods); preserveCounters keeps the next document number.
- Automatic: second call within 24 h does nothing; pruning keeps exactly `keep` automatic backups
  and never deletes a manual one.
- Routes over HTTP with `app.inject`; path traversal id → 400/404, never a file outside root.

## Hard constraints
No dependency, no migration, no git, no edits outside your two new paths. Strict TS
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `erasableSyntaxOnly`). Local imports
end `.js`. Close every database handle you open (Windows will refuse to delete an open file).

## Gates (PowerShell, from `book-buddha/`)
`.\node_modules\.bin\tsc.cmd; $LASTEXITCODE` FIRST, then `.\node_modules\.bin\vitest.cmd run --root .`
Never pipe. Known flake: `allocateProportionally … fuzz` (engine.test.ts) — re-run alone. The
other agent adds tests concurrently; report which files are yours.

## Report back
tsc exit; vitest lines verbatim; files created; the list of counter tables you found; what
"sanitise settings" turned out to mean; every limitation, plainly.

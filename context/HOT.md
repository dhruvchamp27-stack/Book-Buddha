# HOT — Book Buddha

## Last session
2026-11-15: Owner **replaced** the cash/accrual model — now **accrual-always posting +
a Cash/Accrual toggle at report level** (DD §4.5 / QBO). This supersedes the per-company
deferral in Slices 1–6 and commit `5576a21`. **Slice 7 PLANNED and PAUSED at plan phase**
(`book-buddha/SLICE_7_PLAN.md`) — build resumes next session. Nothing built this session.

## The project in one line
Local, offline-first, double-entry accounting app for one PC, organised fair-wise, built
for a non-accountant. A working prototype exists and is being completed slice by slice.

## Active now — autonomous 9-slice finish (branch `autonomous/book-buddha-finish`)
BACKEND-ONLY for now (owner deferred all frontend/UI-UX until the push issue is fixed).
Done & committed locally: 1 Credit notes (d7f6102) · 2 Recurring invoices (0c36b3f) ·
3 Versioned migrations (bcffcb7) · FIFO fix (9970d61) · 4 Auth backend (c00bae0) ·
5 Customers/items/inventory (434a403) · 6 Purchasing/expenses (c10b96e — migration v4;
INVENTORY now ties to the ledger via FIFO lots) · cash-basis credit purchases (5576a21 —
expense/ITC recognized on payment, no migration). Deferred: Slice 4 login UI +
live Google OAuth (`/auth/recover` localhost-only); purchase returns, bill discount,
receipts/attachments, supplier refunds, opening-balance GL offset, all UI. **Next: BUILD
Slice 7** per `book-buddha/SLICE_7_PLAN.md` → 7a Balance-Sheet sign fix · 7b accrual-always
refactor (removes cash-basis branches both sides) · 7c business+date on journals (migration
v5 + backfill → filtered/consolidated reports) · 7d Cash/Accrual report toggle (derived).
Then Projects(fairs) · Subscriptions · Imports+attachments · **Banking (own slice: bank
categorization + bill OCR)** · Cash Flow · Archive · Audit/FY-lock/packaging.

## Workflow (owner-set)
Sonnet builds each slice (backend only), Haiku updates docs, Opus verifies gates+diff then
commits locally. Agents pause-and-ask on anything dangerous/ambiguous; no installs/deletes.
Gates (npm NOT on PATH): run via `.\node_modules\.bin\` → `vitest.cmd run --root .`, `tsc.cmd`, `vite.cmd build`.
Stage by explicit path; one commit = one idea; never `git add -A`; never push to main.

## Blocker — pushes
`git push` can't auth (Git Credential Manager, non-interactive; gh absent). Owner to run
`git push origin autonomous/book-buddha-finish` once to cache token, then pushes resume.
Owner also wants a plain-English brief of work done, on request.

## Preserve / open
Never bend: cash & accrual · balanced journals · integer paise · immutable posted records ·
reversal corrections · safe inventory. Never edit `spec/` or `plan/`.
Owner input needed before 7b/7d BUILD: (1) does any real (non-test) cash-basis data
exist? (decides if 7b needs legacy conversion); (2) hand-worked cash+accrual figures for
one part-paid invoice & one part-paid bill, incl. COGS in the cash view; (3) OK the
chart-of-accounts add (Unearned Revenue/Bank/Uncategorized, one migration). Carried: 7a
fixes the NEGATIVE-liability presentation; opening/adjustment stock still posts no GL
(offset TBD). Bank categorization = designed only, UNAPPROVED (FD 3 open items, todos.md).
Keep <50 lines.

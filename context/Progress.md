# Progress — Book Buddha
*Top part ≤ 50 lines: loaded at every session start, rewritten at every session end.*

## Start here next session
- **Next step:** bill discount is blocked on the odd-paise ruling, so **R12 banking** (accounts, transfers, reconciliation): amend FD §D6 to two Uncategorized accounts first (S11-8); definitions → brief in this file → Sonnet builds.
- **Waiting on Dhruv:** odd-paise ruling (blocks bill discount); attachment audit log; purchase-return back-dating warning; the other Claude session in this folder; delete AGENT_BRIEF_R9_ROUTES.md?; confirm 3 R10 choices (see Open to-dos).
- **Branch and gates (measured 20 Nov):** `autonomous/book-buddha-finish`, never `main`. tsc exit 0 · 856 tests in 64 files · vite built in 1.23s · migration v22.
- **Push rule:** only after the tests pass, in the background, and only after asking Dhruv each time. Count unpushed commits fresh with `git log --oneline @{u}..HEAD`.
- **After R12:** bill discount (when unblocked) → run all tests together and check the backend end to end (standing order S12-3) → then R13 cash flow (S14-2).

## Development — by slice
| Slice | What it does | Built | Tests | Accepted by Dhruv |
|---|---|---|---|---|
| R1, R2, R4, R4b, R5 | not in plan files | ✅ | in gate | outstanding |
| R3, R4c | not in plan files | ✅ | in gate | ✅ hand-verified |
| R6 | not in plan files | not stated in sources | not stated | not stated |
| R7 | not in plan files | ✅ | in gate | outstanding |
| R8 | Purchase returns, refunds, bill discount (S8) | ✅ (stock-cost part ⏳ blocked) | in gate | outstanding |
| R9 | Document storage for invoices and bills (S9) | ✅ routes 2–5 | 8 + 24 engine | parked |
| R10 | CSV and JSON import/export (S10) | ✅ (.xlsx/PDF not built: install) | 142 | parked |
| R11 | Offline backup, restore, integrity check (S11) | ✅ | 16 + 7 | parked |
| R12 | Bank accounts, transfers, reconciliation (S12) | ⬜ | — | — |
| R13 | Cash Flow Statement (S13) | ⬜ after the all-together test run (S14-2) | — | — |
| R14 | Archive: active, inactive, archived (S14) | deferred (S12-4) | — | — |
| §13 reports 1–6 | Customer, stock and profit reports | ✅ | in gate | parked |
| S10-4 | Stock write-down and reversal (v22) | ✅ | 15 | parked |
| 7d, 8c | Cash-basis invoice, bill and P&L figures | ✅ | in gate | on trust |

## Testing
- **Gates, 20 Nov (last measured):** tsc exit 0 · vitest 856 tests in 64 files · vite built in 1.23s. Run tsc first; vitest does not type-check.
- **Acceptance:** hand-verified R3, R4c · on trust 7d, 8c · outstanding R1, R2, R4, R4b, R5, R7, R8 · everything else parked until R12 (S12-3).

## Known Issues
- Attachment upload and delete write no audit log (S13-2); the audit log is a fixed rule.
- No real database yet (S11-16); never touch the live file.
- A purchase return can be back-dated with no warning, unlike a credit note (S11-21).
- Bill discount into stock cost is blocked: Rs 150 off 7 units leaves a paise remainder (S11-1, S11-2, S11-22).
- A bare PURCHASE stock row posts nothing, yet FIFO still consumes it (S7-1(d)).
- Restore writes no audit event, and a zero-cost write-down skips the financial-year lock check.
- Known flake: the fuzz test in engine.test.ts can time out under load; it passes alone.
- Another Claude session commits in this folder (S13-3).
- R10: two equal payments (same document, amount, day) in one file import once; no expenses import.

## Last 3 sessions
- **Session 14 (20 Nov):** setup (orchestrator/workers, Progress.md, closed context folder); R10 import/export built in 4 commits (S14-3 rulings). Nothing pushed.
- **Session 13 (19 Nov):** six commits pushed: reports 1–3 and 6, R9 routes 2–5, S10-4 (v22), R11 backup. Paused by Dhruv.
- **Session 12:** set the standing order (S12-3), deferred R14 (S12-4), wrote the six report definitions before any code.

<!-- END OF SUMMARY - the session-start hook loads only what is above this line -->

## Working area (for the orchestrator and workers; written so Dhruv can inspect it)

### Active briefs
(None open.) Template: `#### <Slice> — status: open / sent / checked / sent back / closed` · Goal · Files to read · Files it may change · Done when (a runnable check) · Orchestrator's check result. Every brief restates: CBM first · no new `context/` file · never open secrets or `*.db` · only its own files (no `repository.ts`/`server.ts` while another worker runs) · no installs · no git writes · gates unpiped, counts read.

### Definitions (written before any code)
#### §13 reports (from REPORT_DEFINITIONS_S12, built in session 13)
- **1. Customer statement.** One customer's account in date order, with a running balance ending at what they owe now. Figures: open-items query (including settled), each document's own payments, applied credits and opening receipts; credit notes from the posted journal. Must tie: closing balance equals that customer's outstanding in open items, and the hand example closes at Rs 15,000 (same as getReceivables). Does NOT: show cash invoices, take a cash basis, or net unapplied credit into the balance.
- **2. Customer Balance Detail.** Every customer, each unpaid document with what is left, a subtotal per customer and a report total. Figures: the same open-items query. Must tie: report total equals getReceivables for the same filter. Does NOT: net unapplied customer credit into a subtotal, or roll back settlements for an as-at date.
- **3. Collections.** The chasing list: overdue documents, days overdue, contact details, oldest first. Figures: Balance Detail rows whose due date is before the as-at date; with no due date, the invoice date is used and the row says so. Must tie: a strict subset of Balance Detail, same amounts. Does NOT: rebuild a historical balance or use a different overdue rule.
- **4. Stock ageing.** How long stock on the shelf has sat, in the four shared bands (0–30, 31–60, 61–90, over 90 days). Figures: FIFO layers dated by their bill, journal or credit-note entry date; layers with no date are counted and shown. Must tie: buckets sum to Inventory Valuation per item and in total. Does NOT: filter by business or fair (stock has no business dimension), or invent finer bands.
- **5. Inventory Valuation Detail.** Each remaining lot: item, received date and its basis, quantity, unit cost, value, source. Must tie: grouped by item, equal to getInventoryValuation exactly. Does NOT: filter by business or fair, or re-sort FIFO by received date (FIFO stays by occurred_at, rowid).
- **6. Item profitability.** Per item: net sales less cost of goods sold (COGS) equals gross margin. Revenue comes from Sales by Item (no second query); COGS from the stock rows of the same sales, dated by the source document. Must tie: COGS equals the COGS account in the posted journal with no date filter; revenue equals Sales by Item. Does NOT: spread invoice discount, extra charge or GST across lines, filter by customer, take a cash basis, or store a margin percentage.

#### R10 import / export (spec §14.1–14.2, plan S10; rulings S14-3)
**Shape.** Stateless two-phase over HTTP: *inspect* (file → headers, sample, suggested column map) → *preview* (the real posting path run inside a transaction that always rolls back, so the preview is exactly what commit will do) → *commit* (the same path, kept). No migration. CSV and JSON only; .xlsx and PDF need a package install (bucket C, ask first) and are not built. Body = JSON `{ fileName, contentBase64, ... }`, like attachments (S11-19 default).

**Codec** (`codec.ts`, pure, no database)
- `decodeBytes(bytes) → { text, encoding }`: BOM first (UTF-8, UTF-16LE, UTF-16BE); else strict UTF-8; if invalid, Windows-1252 (Excel's "CSV" save). BOM stripped from text.
- `detectDelimiter(text) → "," | ";" | "\t" | "|"`: the candidate with the same non-zero count, outside quotes, on the most of the first 10 records.
- `parseCsv(text, delimiter) → string[][]`: RFC 4180: quoted fields, `""` inside quotes, delimiters and newlines inside quotes, CRLF / LF / CR; trailing blank line ignored; an unterminated quote is an error naming the row.
- `parseTabular({ fileName, bytes }) → { format: "CSV"|"JSON", encoding, delimiter, headers, rows: { rowNumber, cells }[] }`. JSON when the name ends `.json` or the text starts with `[` or `{`: an array of flat objects, or `{ rows: [...] }`; headers = keys in first-seen order; a nested object/array value is an error. Header cells trimmed; a blank or duplicate header (case-insensitive) is an error. Fully blank rows dropped. `rowNumber` = the spreadsheet row (header = 1, first data record = 2).
- `parseRupeesToPaise(text)`: accepts `1234`, `1234.5`, `1,23,456.50`, `1,234.50`, `₹1,234.50`, `Rs 100`, `Rs. 100`; decimal string → paise by string arithmetic, never `parseFloat * 100`; rejects a third decimal, letters, empty, misplaced commas (`1,,2`, `,5`), above `Number.MAX_SAFE_INTEGER`; negatives rejected unless `{ allowNegative: true }`.
- `parseDate(text, format)` where format is `"YYYY-MM-DD" | "DD/MM/YYYY" | "DD-MM-YYYY"` (chosen by the user in the column map — never guessed): returns ISO; ISO text is always accepted; impossible dates (31/02, 29/02 in a non-leap year) rejected; 4-digit year only.
- `parseQuantity(text)`: whole number above zero (the repository's rule). `parseTaxRateToBasisPoints("18%" | "18" | "2.5")` → 1800 / 250; max 2 decimals. `parseYesNo` (yes/no/y/n/true/false/1/0). `normaliseName(s)`: NFC, trim, collapse internal whitespace, lower-case.
- **Must pass:** each case above, plus a quoted cell with a newline and a doubled quote; a semicolon file; a tab file; a UTF-8-BOM file; a Windows-1252 file containing `é` and `₹`-less `Rs`; `0.10`→10, `.5`→ rejected or 50 (decide, test, document), `1,23,456.50`→12345650.

**Export** (`exports.ts`, `export-routes.ts`)
- `GET /exports/:dataset?format=csv|json&companyId=&businessId=` (format default csv). Datasets: `customers`, `suppliers`, `items`, `invoices`, `credit-notes`, `payments`, `purchase-bills`, `supplier-payments`, `stock-movements`, `journal-entries`, `trial-balance`. Documents export **one row per line** with the header fields repeated (the same shape the importer groups back by number).
- CSV: UTF-8 with BOM, CRLF, RFC 4180 quoting; money as rupees with two decimals and no grouping (`1234.50`, `-12.00`); dates ISO. A TEXT cell beginning with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` (spreadsheet formula injection); numeric columns are not touched. `Content-Disposition: attachment; filename="<dataset>-<YYYY-MM-DD>.csv"`.
- JSON: `{ dataset, exportedAt, columns, rows }`, each row an object keyed by the CSV headers with the same string values — one format the importer reads both ways.
- **Headers (fixed, the importer's labels):** customers `Name, Email, Phone, Phone 2, Classification, GSTIN, Website, Billing address, Shipping address, Notes, Customer number, Active` · suppliers the same minus Customer number · items `Name, Unit, Track stock, Description, Selling price, Cost price, MRP, Reorder level, Active` · invoices `Number, Invoice date, Due date, Customer, Status, Item, Description, Quantity, Unit price, Discount, Extra charge, Tax type, Tax rate, Fair, Notes`. Others: the worker's choice, plain English, documented in the file header.

**Engine** (`import-engine.ts`) — the contract both C and D code against:
```ts
export type DateFormat = "YYYY-MM-DD" | "DD/MM/YYYY" | "DD-MM-YYYY";
export interface ImportField { readonly key: string; readonly label: string; readonly required: boolean; readonly synonyms: readonly string[] }
export interface ImportContext { readonly repository: AccountingRepository; readonly companyId: string; readonly businessId?: string; readonly dateFormat: DateFormat }
export interface MappedRow { readonly rowNumber: number; readonly values: Readonly<Record<string, string>> } // trimmed cell per field key, "" when blank or unmapped
export interface UnitOutcome { readonly status: "CREATED" | "UPDATED" | "SKIPPED"; readonly reference: string; readonly message?: string }
export interface ImportKindDefinition {
  readonly kind: string; readonly scope: "COMPANY" | "BUSINESS";
  readonly fields: readonly ImportField[];
  readonly groupBy?: string;           // rows sharing this field's value are ONE unit, in first-seen order
  post(context: ImportContext, rows: readonly MappedRow[]): UnitOutcome; // throw to fail the unit
}
export class ImportRowError extends Error {}
```
- `runImport({ repository, kind, parsed, columnMap, companyId, businessId?, dateFormat, mode: "PREVIEW" | "COMMIT" })`. Column map = `{ fieldKey: headerName }`; an unknown header or a missing required field fails the whole request (400) before any row runs. A required field blank in a row fails that unit.
- **Unit = one record, or one document (all rows sharing `groupBy`).** Each unit runs in its own nested `db.transaction` (a savepoint): a thrown error rolls back that unit only and is collected as `FAILED` with its message and row numbers; the rest go on (spec: "skipped and collected, the import does not abort"). The whole run is one outer transaction: PREVIEW always rolls it back; COMMIT keeps it. Nothing half-posted — a draft whose finalize fails is rolled back with it.
- Result: `{ mode, kind, totalRows, units, created, updated, skipped, failed, outcomes: [{ rowNumbers, reference, status, message? }] }`. `SKIPPED` = already exists (not an error; makes re-running a file safe).
- `suggestColumnMap(kind, headers)`: by `normaliseName` against label + synonyms.
- **Must pass:** preview leaves zero rows behind (count tables before/after); commit of the same file gives the same outcome list as its preview; one bad unit among good ones → others committed, the bad one listed with its row numbers; a unit that throws after writing part of itself leaves none of it.

**Master-data kinds** (`import-masters.ts`, all scope COMPANY unless stated)
- `customers` / `suppliers`: fields from `CustomerInput` / `SupplierInput` (labels = export headers; Customer number is ignored on import — it is always allocated). Exists = same `normaliseName(name)` or same non-blank GSTIN in the company → `SKIPPED "already exists"` (S14-3; sub-customers not built).
- `items`: exists = same `normaliseName(name)` → `updateItem` with the filled cells only (blank leaves alone; spec "update rather than duplicate"); a different Track stock value fails (not editable). Optional `Opening quantity` + `Opening unit cost`: on a NEW stock-tracked item only, posts an `OPENING` stock movement via `addStockMovement` (needs `businessId`; missing → that unit fails). On an existing item the opening cells are ignored and the outcome message says so.
- `opening-balances` (BUSINESS): `As at, Account, Debit, Credit`; grouped by As at; one unit → `saveOpeningBalances`.
- `opening-customer-balances` / `opening-supplier-balances` (BUSINESS): `Customer|Supplier (name), As at, Amount` (+ the customer method's other inputs — read it); party not found → fails.
- **Must pass:** each kind creates; duplicate customer by name and by GSTIN → SKIPPED; item re-import updates price, not a second item; opening stock appears in `getStockBalances`; every created record has its audit event (check `listAuditEvents`); export→import round trip of customers and items into a fresh database reproduces the same export.

**Document kinds** (`import-documents.ts`, all scope BUSINESS, all grouped by Number)
- `invoices`: header fields from the first row of the group (a later row disagreeing on Customer, Invoice date, Due date, Discount, Extra charge, Tax type, Tax rate or Fair → the unit fails, naming the field); Item optional (by `normaliseName`; given → the line reduces stock through `finalizeInvoice`'s FIFO, S14-3; short stock → unit fails); `saveDraft` then `finalizeInvoice` — **posted**, on its own date (S14-3). Payment account: read how existing tests create a credit invoice and use that.
- `purchase-bills`: same, `createPurchaseBill` + `finalizePurchaseBill`; Supplier by name; Supplier invoice number optional.
- `credit-notes`: `Number, Invoice number, Note date, Reason, Item, Description, Quantity, Unit price`; `saveCreditNote` + `finalizeCreditNote({ confirmBackdatedMonth: true })` — the preview is the user's confirmation.
- `payments` (customer): `Invoice number, Amount, Paid on`; `supplier-payments`: `Bill number, Amount, Paid on`. Not grouped. Exists = a non-cancelled payment with the same document, amount and date → SKIPPED.
- **Always:** a Number already present in the business → `SKIPPED "already exists"`; a document dated **on or before** the business's latest opening-balance date (general, customer or supplier opening set) → unit FAILED "dated on or before the opening balances of <date> — would count twice" (S14-3); a locked financial year → FAILED with the repository's message; unknown customer/supplier/item/invoice/fair → FAILED naming it.
- **Must pass:** a 3-line invoice in 3 rows → one invoice, ledger balanced, receivable equals its total; two invoices interleaved in a file group correctly; disagreeing header → fails naming the field; pre-opening date → fails; short stock → fails and leaves no draft; re-import → all SKIPPED; credit note against an imported invoice posts; payment re-import skips.

**Routes** (`import-routes.ts`, registered by hand in `server.ts`): `GET /imports/kinds` (kinds + fields) · `POST /imports/inspect` `{ kind, fileName, contentBase64 }` → parse summary (format, encoding, delimiter, headers, rowCount, first 10 rows) + suggested map · `POST /imports/preview` and `POST /imports/commit` `{ kind, fileName, contentBase64, columnMap, companyId, businessId?, dateFormat }` → result. Route `bodyLimit` 20 MB (constant), as attachments do. Bad body / bad map → 400 via `RepositoryValidationError`. **Must pass:** all four behind auth (401 without a session); a CSV over 1 MB accepted; preview then commit over HTTP.

**Not in R10 (recorded):** .xlsx and PDF (install = ask); expenses import (plan lists it, spec §14.1 does not); report exports beyond trial balance; an import-batch audit event (`insertAuditEvent` is private to the repository — each created record audits itself).

### Open to-dos and questions
**Waiting on Dhruv (decisions)**
- Odd-paise ruling: Rs 150 off 7 units, and how a bill tells a trade discount from a settlement discount (S11-1, S11-2, S11-22). Blocks bill discount.
- Attachment upload and delete audit log (S13-2). His call; the audit log is a fixed rule.
- Purchase-return back-dating warning, as credit notes have (S11-21).
- Is the other Claude session in this folder his, and should it continue (S13-3)?
- Smaller calls: base64 vs multipart for attachments (S11-19, defaulted); OPENING_DATE label in Collections; backend-only through R12 (confirm at R12); web/src/App.tsx StockMovementType lacks the v22 types (UI is his).
- Delete context/AGENT_BRIEF_R9_ROUTES.md? Listed as dead litter in HOT.md; deletion offered, not answered.

**Build work still open**
- R10 follow-ups: .xlsx import/export and PDF export need a package install (ask first); expenses import (plan lists it, spec §14.1 does not); report exports beyond the trial balance.
- R10 choices made without Dhruv, to confirm: two equal payments (same document, amount, day) in one file import once; customer/supplier payments are also refused on or before the opening date; imported credit notes confirm back-dating automatically (the preview is the confirmation).
- Bill discount into stock cost: blocked on the odd-paise ruling.
- R12 banking: amend FD §D6 to two Uncategorized accounts (S11-8) before starting.
- Zero-cost write-down is not FY-lock checked; restore writes no audit event.
- Source-less PURCHASE posts nothing while FIFO consumes it (S7-1(d)). Flagged, not fixed.
- Acceptance for R1, R2, R4, R4b, R5, R7, R8 is parked until R12, then run all tests together (S12-3).

**From todos.md (seeded 14 Nov; may be stale)**
- FD §H, listed as open: archive scope; auto-record payment on a bank match; whether the Uncategorized account is auto-created or named by the owner. The section header says it is closed, so confirm before R12.
- Subscriptions deferred (S1-5). Outside advisers: CA (principal vs agent on magazine resale, GST timing, "Exempt" scope); lawyer (buyer personal data under DPDP Rules 2025).
- The old todos.md build order is superseded by HOT.md's remaining order.

**Open spec conflicts and technical decisions (from todos.md; seeded 14 Nov, may be stale)**
- Rounding: whole rupee (DD §7.4, PRD) vs exact paise (ANTI §4, TEST §5.3).
- Tax placement: per-line GST as the user names it (DD §13.1) vs invoice-level GST (prototype).
- Reports count: 8 in BP vs about 17 in DD §12.
- Archive scope: v1-skip (DEC Q7) vs v2 (DD §1.5/§17) vs V1 (FD/H13). FD §H scope is still open.
- M4 challan↔invoice link: pending (DEC) vs decided (DD §11.4).
- Formal tech-stack confirmation: TS + Fastify + SQLite + React in the prototype, never formally confirmed.
- Desktop packaging: Tauri vs Electron undecided; how it installs for a non-engineer.
- PDF extraction library: pdfplumber/Camelot are Python; the prototype is TS.
- OCR library: Tesseract vs PaddleOCR; whether cloud OCR is ever allowed.
- Who builds: Sonnet builds, Opus reviews (ANTI §5); process proposed, not owner-confirmed.
- Test basis: test data and fixtures, partly answered by the Vitest tests.
- Prototype roles: admin/accountant/viewer vs Phase-1 admin-only (DD §15.1).
- Canonical repo path: docs say D:\dhruv-book-accounting-app\Book-Buddha-github; this checkout is C:\Users\Admin\Desktop\Book Buddha. Confirm which.
- Build status: docs say nothing built; HOT shows a working prototype.
- Prototype cancel: claimed as reversal, unverified when seeded.
- testing/testing.md is a stale draft (says DD §5 unwritten; calls a fair a tag).
- Phase 2 design still open: invoicing-user login and recovery, permission matrix, tablet layout, LAN, connection drop (DD §2.4).

### Rules and lessons carried forward
- Owner's standing rule: build backend only, no UI (session 8). Screenshots only of things that really work.
- A slice is accepted when the accounting logic is satisfied (S12-1). The nineteen questions are closed (S11-1 to S11-22); do not re-ask them.
- Where the data model forces a choice, make it and say so; accounting policy is Dhruv's (S9-1 trade-off; v18 and v19 precedent).
- Date the entry, never the stock layer. FIFO runs ORDER BY occurred_at, rowid. Restored stock goes to the end of the queue (v19).
- A stock reversal stamps the BILL's id on the movement, then asserts the ledger equals valuation (session 9 bug).
- Reports key on entry_date, not created_at, and group by chart_accounts type or role via JOIN, never a hard-coded code list.
- An unknown fair must throw, not return zero rows (S11-9).
- A new seeded account needs a new frozen seed list and a new migration; migration-v15-seeding goes red by design, so add the list there.
- Migration tests: build to version n-1, insert rows by raw SQL, call the new apply function directly. A whole-chain run on an empty database tests nothing.
- Any rebuild of chart_accounts must replay every trigger that mentions it (journal_lines_account_exists).
- The posting door rejects a 0/0 journal line; filter zero lines out first.
- New API routes are protected automatically; a public route must be added to PUBLIC_ROUTES deliberately. Every new route needs an HTTP test.
- buildApi takes two positional arguments: buildApi(repository, { __unsafeDisableAuthForTests: true }).
- Fastify tests cannot use fake timers; age a session with validateSession(token, future).
- Edit with the Edit or Write tool, never perl -i -pe (it eats $ signs). Write markdown with Write, not a shell heredoc.
- Reproduce a defect before fixing it; mutation-test key assertions; restore by byte comparison, never git checkout while work is uncommitted.
- Triage any red test: old behaviour, stale count, or an ACCEPTANCE figure (stop and look; never edit it).
- Verify a stated blocker in the code before planning around it (S9-3: "purchase returns blocked on S7-2" was never true).
- Maximum two builders, never both in repository.ts; the orchestrator owns migrations.ts and runs the full suite alone (S5-5).
- Stage by explicit path, one commit per idea, honest limits in the commit message.

### History — closed briefs
- **R10 import / export (session 14)** — `9037872` codec · `098ce15` exports · `d2fa92b` import engine, masters, documents, routes wired · `aecc96a` end-to-end checks. Five Sonnet briefs (A codec 53 tests, B exports 20, C engine+masters+routes 37, D documents 21, E integration 10 + 1). Sent back once: B's journal export had no date (now from the general ledger). Orchestrator fixes: customer number keeps its category prefix (not always GEN); routes wired in `buildApi`. E found a real bug — the export's `'` formula guard came back on import (`'+91…`) — fixed by stripping it on import; 2,000 invoices 8.8 s → 1.9 s. Mutation-proved: money parser, on-or-before-opening rule, preview rollback. Audit chain verified after preview and after a part-failed commit. Design: Definitions → R10.
- **R9 attachment routes 2–5** — built `fa4ab42`. Files: src/api/attachment-routes.ts, src/api/attachments-api.test.ts. Routes: POST upload (base64 JSON, raised body limit), GET list, GET content, DELETE. Checked by 8 HTTP tests. Open: delete writes no audit log (S13-2).
- **R11 backup, verify, restore** — built `2952c28`. Files: src/backup/backup.ts, src/api/backup-routes.ts. Routes: POST /backups, GET /backups, POST /backups/:id/verify. Restore is a backend function with no HTTP route, by design (S13-4). Checked by 16 + 7 tests, including "restored books show the same numbers".
- **Customer reports 1–3** — built `9cd1838`, shared as-at helper in open-items.ts (shared change in `63bb874`). Files: src/database/reports-customers.ts and its test. Checked by 15 tests: hand example Rs 15,000 and tie-outs to getReceivables and Balance Detail.
- **Item profitability (report 6)** — built `cf84fe9`. File: src/database/reports-profitability.ts. Checked by 14 tests: COGS ties to the journal with no date filter, fair filter, unknown fair throws. The mutation check was asked for; its result is not in the sources.
- **Report routes** — built `9cd503c`. Four GET routes for reports 1–3 and 6; repository wrappers; getReceivables gains a fair filter (S13-1). Checked by reports-wiring and unknown-fair sweep tests.
- **Stock correction S10-4 (v22)** — built `2cb332f`. Files: src/database/stock-adjustment-schema.ts, migration v22, stock-layers and repository changes. Routes: POST /inventory/write-downs, POST /inventory/movements/:id/reverse. Checked by 15 tests; v22 proved on a real file.

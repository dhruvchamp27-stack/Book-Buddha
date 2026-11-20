# TRD — Technical Requirements Document (Book Buddha)

> **Filled 2026-11-15 from the project's own docs** (DD = `spec/Design Document (9 Nov 2026)`,
> PRD, AF = `spec/APP_FLOW`, FEAT, ARCH = `context/architecture.md`, DB = `context/database.md`,
> DEC = `context/decisions.md`). Every line is sourced. **Prototype facts are self-reported
> by ARCH and NOT independently verified** — marked *(prototype — unverified)*. Genuine
> owner decisions are marked **DECISION PENDING** and must not be treated as settled.
> Keep the authoritative technical narrative in `architecture.md`/`database.md`; this file is
> the working requirements checklist derived from them.

## 1. Purpose & scope
- **Governs:** the technical requirements for Book Buddha — a local, offline-first,
  double-entry accounting app for a single PC, general-purpose, starting blank, where a
  Book Fair is one kind of customer-linked Project *(DD §1.1–1.3; PRD §1)*.
- **In scope — Phase 1 (Admin-only):** company / businesses / shared chart of accounts;
  the engine (double-entry, posting, FY lock, opening balances); customers; items + basic
  inventory; documents (invoices, quotes, credit notes, challans, recurring invoices,
  bills/expenses, POs); payments (methods, split allocation, credit, refunds, returns,
  write-off); Projects/Fairs; subscriptions & deferred revenue incl. period-end
  settlement; fixed reports + a simple builder; optional tax; custom fields/tags/notes;
  data-entry accelerators; import/export/backup; login, audit log, technical error log,
  Settings *(DD §1.4, §2.3; PRD §3)*.
- **Out of scope — Phase 2 / v2:** invoicing-only users on other devices / tablet at a
  fair (begins once Phase 1 is an accepted MVP); more than one company per install; SaaS;
  payment gateways; live bank feeds; customer portal; e-invoicing; archive as a third
  state; full pivot builder; PDF bank import + OCR *(DD §1.5, §2.4; PRD §2–3)*.

## 2. Platform & runtime
- **Target OS / form factor:** local web app on one PC, browser-rendered screens, one
  program, one database file per company, mostly single-user, offline-preferred
  *(DD §1.1; PRD §6)*. Internet only for Google sign-in and optional email *(DD §2.2)*.
- **Runtime:** Node **22+** (24 verified) *(prototype — unverified; ARCH)*. Not stated in
  the spec itself.
- **Desktop packaging:** **DECISION PENDING — Tauri vs Electron.** ARCH's REQUIREMENTS
  favour Tauri; IMPLEMENTATION_PROGRESS shows Electron; packaging is sequenced last
  *(ARCH)*. Windows build note: `better-sqlite3` needs the VS C++ Build Tools *(ARCH)*.

## 3. Technology stack (status: formally "pending")
- **Spec-level:** no formal language/framework chosen. Spec names only **SQLite** (DB)
  and **React** (UI). The formal stack choice is recorded as **pending** *(ARCH, citing
  Progress.md → Open to-dos and questions)*.
- **Prototype actually uses** *(prototype — unverified; ARCH from package.json/tsconfig/
  vite.config)*: TypeScript (strict, ES2022, NodeNext) · Fastify ^5 (API) · better-sqlite3
  ^13 · Zod ^4 (validation) · React 19 · Vite 7 (web root, `/api` → :3000, dev :5173) ·
  Vitest 3 (tests).
- **PDF/OCR tooling:** **DECISION PENDING** — ARCH cites pdfplumber/Camelot (Python) and
  Tesseract/PaddleOCR, which conflict with a TypeScript codebase; unresolved *(ARCH)*.
- **Rationale / constraints:** offline-first, single-file-per-company, no server
  dependency — drives the SQLite + local-runtime choice *(DD §1.1, §3.1)*.

## 4. Architecture requirements
- **Layering** *(ARCH §3–4)*: Presentation (React, `web/`) → API/auth (validates ALL
  input, enforces company/business/project scope, **never trusts frontend totals or
  statuses**) → Application/accounting engine (lifecycle, integer-paise math, rounding,
  tax, cash/accrual, allocations, FIFO, deferred revenue, journal balancing, reversals,
  FY locks, audit events) → Repository (**every financial op = ONE DB transaction,
  commit only if all succeed**) → SQLite (one file per company).
- **Module boundaries** *(ARCH target)*: `src/api`, `src/application/*`,
  `src/accounting/*`, `src/database/*`, `src/security`, `src/audit`, `web/src/*`. Extract
  modules gradually; avoid a big-bang rewrite.
- **Input validation:** pre-save checks block incomplete rows and zero quantities with
  plain messages; incomplete rows block the save and are never silently dropped
  *(DD §7.4, §18; PRD §7)*.
- **Transactions:** all saves and postings are all-or-nothing; any failure rolls back
  fully *(DD §4.2, §7.5, §18; ARCH §8)*.
- **Error model:** a separate **technical error log** records crashes/failures (PDF, mail,
  security) for the developer, distinct from the business audit log *(DD §16.2; AF §12.2)*.
  Endpoint error envelope / status-code contract: **not specified in docs** — define at
  build time.

## 5. Data & storage
- One **SQLite file per company**; money as **integer paise**; **ISO** dates/timestamps;
  **foreign keys ON**; explicit indexes *(DB ground rules; ARCH §3.5)*.
  - *Caveat:* DD §7.4 rounds invoice/quotation **totals** to whole rupee while storage is
    paise — see the rounding decision in §7.
- **Migrations:** ordered, transactional, backward-compatible, with
  `PRAGMA foreign_key_check`. Versioned migrations **not yet built** in the prototype
  *(DB; ARCH §8 — unverified)*.
- **Integrity checks:** run at startup and before every backup/restore *(DB; ARCH §3.5)*.
- **Backup / restore:** user-chosen scope (everything — DB, attachments, logo, audit log —
  or DB only); the screen states what's in/out; restore warns, offers a pre-restore
  backup, sanitises incoming settings, and can preserve users + counters *(DD §14.3;
  AF §12.6; PRD §5.12)*. Automated backups **not yet built** *(prototype — unverified)*.
- **Attachments:** files live **outside** SQLite; an `attachments` table holds metadata
  only. Customer docs: PDF/JPG/PNG/Word/Excel/CSV, ≤ 20 MB each; transaction attachments
  are included in the backup scope *(DD §5.8, §7.8, §14.3; DB)*.
- **Backup file location, attachment folder path, data retention, log retention:**
  **not specified in docs** — owner/build-time decisions.

## 6. Security & auth
- **Sign-in:** Google sign-in at first setup and for password recovery; daily login is a
  local **app password** that works offline *(DD §15.2; DEC Auth; AF §1.1, §2.1, §2.5)*.
- **App password:** ≥ 8 characters, letters + numbers *(DD §15.2; AF §1.8)*.
- **Lockout:** 15 minutes after 5 wrong attempts *(DD §15.2; AF §2.1)*.
- **Idle:** auto sign-out after 1 hour; 1-minute warning; "Stay signed in"; typed work
  preserved through the session-expiry prompt *(DD §15.2; AF §2.4)*.
- **Ownership checks** at every cross-entity boundary (company/business/customer/supplier/
  item/project) *(ARCH §8)*. Restrict direct DB access *(DEC Q9)*.
- **Secrets** never committed; `.env`/`config.json` blocked by
  `.claude/hooks/protect-files.py`.
- **Password hashing algorithm & session storage mechanism:** **not specified in docs**
  (DB lists only `sessions` and `login_attempts` tables) — define at build time.
- **Phase-2 permission matrix** (data-level "view assigned only" scoping, login/recovery
  on other devices): **DECISION PENDING — to be designed** *(DD §2.4)*.

## 7. Accounting engine requirements
- **Automatic balanced double-entry**; a save that wouldn't balance is **rejected**
  *(DD §4.1; PRD §5.2)*. The normal user never sees or types debits/credits *(DD §4.1)*.
- **Cancel-with-reversal:** posts the exact reverse (`journal_entries.reversal_of`),
  restores stock, keeps the document visible marked **Cancelled**, and **never reuses the
  number** *(DD §2.1, §4.4; DB)*.
- **Edit finalised document:** allowed, with the prior version kept in history
  (`document_versions`) *(DD §4.4; DB)*. No hard delete of posted records *(DD §9.6; DB)*.
- **Tamper-evident audit log** (append-only `audit_events` hash chain,
  `previous_hash`/`hash`) from day one; external anchoring recommended, not confirmed
  built *(DD §16.1; DB; DEC Q9)*. **Not yet implemented** in prototype *(unverified)*.
- **FIFO costing** per purchase lot (`stock_layers`, `stock_allocations`), keeping
  supplier + cost *(DD §6.3; DB)*. **Negative stock blocked** with an "Add stock" step;
  stock concurrency guard *(DD §6.3, §18)*.
- **Cash & accrual:** engine is accrual; reports show cash (from actual payment
  allocations) or accrual, **chosen per report** *(DD §4.5; DEC Q3)*. *(Prototype diverges
  — sets it per company — ARCH §6.)*
- **Rounding:** **DECISION PENDING / CONTESTED.** DD §7.4 + PRD §5.5/§9 round invoice &
  quotation **totals** to the nearest whole rupee (50p up), receipts keep paise ("adopted
  12 Nov 2026 from Magazine PRD v4"); DEC marks this **contested** — ANTI and the test
  files say **exact paise**. Lock before building any totals math *(see `Progress.md` → Open to-dos and questions)*.
- **Tax:** optional; user-named names/rates; **per item line**; inclusive or exclusive;
  tax-exempt option; optional GSTIN *(DD §13.1; PRD §5.11)*. *(Prototype diverges —
  invoice-level CGST/SGST/IGST — ARCH.)* GST legal classification recorded **unconfirmed**
  *(DD §20)*.

## 8. Non-functional requirements
- **Scale:** no hard numbers in DD. PRD §6 target — comfortably handle small-business
  volumes (order of hundreds of customers, tens of thousands of ledger lines); magazine
  figures (50–300 customers, ~500–1000 bills) are reference only. Latency targets: **not
  specified** *(PRD §6, §9)*.
- **Offline:** fully usable offline except Google sign-in, forgot-password, email, and
  scheduled reports *(DD §2.2; PRD §5.10, §6)*.
- **Reliability / crash recovery:** committed records survive an unexpected shutdown;
  in-progress work is saved as entered; drafts autosave *(PRD §6; DD §7.3)*.
- **Logging & observability:** business **audit log** *(DD §16.1)* + a separate
  **technical error log** *(DD §16.2)*; `system_logs` table *(DB)*. Retention **not
  specified**.

## 9. Build, test & CI gates
- Prototype npm scripts *(prototype — unverified; ARCH, run in `book-buddha/`)*:
  `npm test` (Vitest) · `npm run build` (tsc) · `npm run build:web` · `npm run start:api`
  · `npm run dev:web`.
- A slice is **not** "done" on a green technical run alone — **acceptance = the owner's
  hand-worked figures** *(DD §19)*. A formal CI gate definition is **not specified**.
- See `Testing.md` for the full test plan.

## 10. Open technical decisions
Carried in `Progress.md` → Open to-dos and questions; the live ones that gate building:
- Formal **tech-stack** confirmation *(ARCH)*.
- **Desktop packaging** — Tauri vs Electron *(ARCH)*.
- **PDF/OCR** library + language (Python vs TS) *(ARCH)*.
- **Rounding** — whole-rupee vs exact-paise *(DD §7.4 vs DEC/ANTI)*.
- **Tax placement** — target per-line vs prototype invoice-level *(DD §13.1 vs ARCH)*.
- **Report count** — 8 vs 17 *(DEC Q4 vs DD §12.1)*.
- **Archive** as a v1 state — awaiting owner approval *(DEC FD vs DD §1.5)*.
- **Challan↔invoice link (M4)** — DEC says pending, DD §11.4 says decided *(stale DEC)*.
- **Hash-chain external anchoring** *(DEC Q9)*.
- **Custom-field coverage** beyond invoices/bills/items/customers/reports *(PRD §9)*.
- Phase-2 login/recovery, permission matrix, tablet/touch layout *(DD §2.4)*.

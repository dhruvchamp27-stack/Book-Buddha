# todos.md — Book Buddha

*On-demand allied file. Seeded 2026-11-14 from the repo docs. Sources: H12/H13 =
handoffs, BP = Build phase plan, DD = Design Document, FD = Feature Design V1,
ANTI = Prompt - Antigravity (14 Nov), AF = APP_FLOW. Nothing here is invented — where
the docs disagree it is listed as an open question, not resolved.*

## Technology decisions still officially pending (H12 §4, BP §2.0)
1. **Stack** — language / framework / database. *De facto* already TS + Fastify +
   SQLite + React in the prototype, but never formally confirmed.
2. **Who builds** — which AI tool and how driven. ANTI §5 proposes Sonnet builds,
   Opus reviews. Process decision, not owner-confirmed.
3. **Install / launch** — how it installs for a non-engineer; desktop packaging
   (Tauri vs Electron) undecided.
4. **Test basis** — test data / fixtures (partly answered now by the prototype's
   Vitest tests).
- Also implied: PDF extraction (pdfplumber/Camelot are Python; prototype is TS), OCR
  engine (Tesseract vs PaddleOCR), whether cloud OCR is ever allowed.

## Pending spec work
- Update **DD §1.5 / §17** for the v2→V1 move of bank / OCR / archive (H13 §7).
- **Approve FD** (3 open items below), then carry it into APP_FLOW, PRD, Features List,
  then an implementation plan.
- **Phase 2 design** still open: invoicing-user login/recovery, permission matrix,
  tablet/touch layout, LAN device connection, connection-drop mid-invoice (DD §2.4).
- Close the four §2.0 technology items before the implementation plan (BP §2.4).
- `testing/testing.md` is a **stale draft** — revise before using as a checklist.

## Open questions awaiting the owner
> **AS OF 2026-11-18 (S10-7) EVERY ITEM IN THIS SECTION IS IN ONE PLACE: the nineteen numbered
> questions at the top of `context/RESUME_PROMPT.md`**, each with a default he can approve in a
> word. He answers them as his opening message in session 11. Treat the entries below as the
> detail behind those questions, not as a second to-do list — and do not put a question to him
> from here without checking it against that block first. Already ruled and NOT open: the four
> R4c decisions (S10-1..S10-4) · S7-2 (closed by S10-4) · R4c scenario 1 (signed off, S10-6) ·
> Subscriptions (deferred, S1-5). **7d and 8c need only a one-line confirm** — he gave those
> figures himself on 2026-11-15 and the app reproduces them.
- ~~**Slice 7 build gate** (1) real cash-basis data? (2) hand-worked cash/accrual figures?
  (3) chart-of-accounts add?~~ **ALL ANSWERED 2026-11-15.** (1) No real data — no `.db` file
  exists, so 7b was a clean refactor (assumption stated: `BOOK_BUDDHA_DATABASE` could point
  outside the project, which was not checked). (2) Figures given and reproduced as
  `ACCEPTANCE …` tests. (3) All four codes in one migration → decisions.md **S1-4**.
- **CONFIRM the acceptance figures actually produced** (7d and 8c are *built, unconfirmed*):
  cash invoice gross 590000 / GST 90000 / net 500000 / COGS 300000 with receivable 590000;
  cash bill expense 50000 / inventory 250000 / ITC 54000 with payable 354000; net profit
  accrual 300000 vs cash 150000. Fair A P&L sales 40000, costs 23000, profit 17000; Fair B
  sales 20000, costs 12000, profit 8000.
- **Subscriptions (DD §11.6) — needed before that slice can start:** exact early-closure
  behaviour · statement layouts · refund-vs-carry-forward default. Slice is DEFERRED (S1-5).
- **Small open calls carried out of this session:** should an unknown `fairId` error instead
  of returning an empty report? Should `GeneralLedgerRow.date` present the transaction date
  (`entryDate`) rather than the posting timestamp? Is a 1-paise gross-vs-(net+GST) difference
  mid-collection acceptable in the cash P&L?
- **FD §H (bank categorization / OCR / archive — still unapproved):** (1) archive scope —
  masters only, or documents too (with hide-from-default filter)? (2) auto-record payment
  when a bank line matches a vendor bill, or require an extra confirm? (3) Uncategorized
  account — auto-created or owner-named?
- **APP_FLOW gaps (AF Part E):** dashboard content; customer financial-summary panel;
  which records get custom fields; "Save & add another" for customers; subscription
  settlement build details; keyboard shortcut keys; fair buyer personal data (DPDP);
  CA/GST items.
- **With CA (DD §20):** principal vs agent on magazine resale; GST classification &
  timing; "Exempt" scope (PRD §9).
- **With lawyer (DD §20):** buyer personal data under DPDP Rules 2025; before
  giving away / selling the app.

## Build order — UNRESOLVED (pick one before building)
Three sequences disagree, and the latest prompt starts somewhere else again:
- **H12 §3:** Foundation → Customers → Items&stock → Invoices → Payments → Other docs →
  Fairs → Subscriptions → Reports → Settings → Admin.
- **BP §2.1:** engine → company/CoA → customers&items → invoices&stock → rest → 
  cancel/audit → reports → import/export/backup → login & FY lock.
- **ARCH §9:** a 17-step sequence (login after the engine).
- **ANTI (14 Nov, newest):** starts at **Slice 1 = Credit notes & sales returns
  (screens + reports)** — outside all three, matching the prototype's own next step.
→ **Owner must confirm the next slice: Foundation (spec) vs Credit notes (latest
  prompt + prototype).**

## Conflicts to resolve (from the doc digest — none resolved here)
1. **Rounding** — whole rupee (DD §7.4, PRD) vs exact paise (ANTI §4, TEST §5.3).
2. **Build status** — "nothing built" (README/H12) vs a working prototype.
3. **Archive** — v1-skip (DEC Q7) vs v2 (DD §1.5/§17) vs V1 (FD/H13).
4. **Bank & OCR** — ~~v2 (DD §1.5/§17) vs V1 (FD 13 Nov)~~ **RESOLVED 2026-11-15
   (decisions.md S1-2): V1, its own Banking slice — but FD still unapproved (§H below).**
5. **M4 challan↔invoice** — pending (DEC) vs decided (DD §11.4).
6. **Reports count** — 8 (BP) vs ~17 (DD §12).
7. **TEST stale** — says DD §5 unwritten (it exists); calls a fair a tag (it's a Project).
8. **Build order** — three sequences + ANTI starting elsewhere (above).
9. **Canonical repo path** — docs say `D:\dhruv-book-accounting-app\Book-Buddha-github`;
   this checkout is `C:\Users\Admin\Desktop\Book Buddha`. Confirm which is canonical.
10. **Cash vs accrual** — ~~per company (prototype) vs per report (DD §4.5)~~ **RESOLVED
    2026-11-15 (decisions.md S1-1): accrual-always posting + report-level toggle.**
11. **Prototype roles** — admin/accountant/viewer vs Phase-1-Admin-only (DD §15.1).
12. **Tax model** — invoice-level GST (prototype) vs user-named per-line (DD §13.1).
13. **Prototype cancel/behaviour** — claimed as reversal, **unverified** (tests not run).
14. **1A/3C/4A/5A** — referenced in DEC but defined in DD/FD.
15. **FD external refs** — cites a "QBO research" doc & decisions 5A/3C not in the repo.
16. **`book-buddha/CLAUDE_FINISHING_PLAN.md`** — governs the prototype per ANTI but was
    NOT read in the digest. Read it before acting on the prototype.

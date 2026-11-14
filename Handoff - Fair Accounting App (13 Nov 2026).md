# Handoff – Fair Accounting App (13 Nov 2026)

*Paste at the start of a new chat in the Billing Project to continue. **Supplements** (does not replace) the 7 Nov handoff and the Design Document — Book Buddha (current).*

## 1. Where we are

- Still in the **superpowers brainstorming** process; nothing is built until you approve.
- This session: moved three former **v2** items into **V1** and designed the main one. Wrote **Feature Design — Bank Transaction Categorization, Bill OCR & Archive (V1)** and the research doc it rests on.
- **Resuming now:** Phase 2 (extra invoicing users). Build order unchanged — Phase 2 still starts after the V1 MVP works; we are only *designing* it.

## 2. How to work with me

Unchanged — see the 7 Nov handoff §2 (short answers, one step at a time; cite real sources, say "I cannot confirm this"; questions in sets of 5 with lettered options; I am a finance professional, non-engineer; use brainstorming, don't build until approved).

## 3. Decisions made today (13 Nov)

**Scope moved into V1:** bank-transaction categorization · OCR for supplier bills · archive state.
**Left deferred:** report builder, one-challan-many-invoices, shared catalogue, and the whole Large list (Phase 2 multi-user, multi-company, live feeds, gateways, portal, e-invoicing, SaaS, late fees, etc.).

**Bank categorization:**
- **Role:** data-entry accelerator — lines mostly *create* new entries, occasionally *match*.
- **Intake:** CSV/Excel (offline, primary) · digital PDF (offline, no OCR) · scanned PDF (offline OCR fallback, flagged "check") · optional cloud OCR only when online and chosen, never default. All feed one review screen.
- **Each line → Add or Match.** Add = new Bill (money out) / income entry (money in). Match = to an open invoice/bill → records a payment (no duplicate); or to an existing entry → confirm. App suggests by amount/date/payee.
- **Bank rules:** pre-fill category/payee; manual accept; **no auto-post in V1.**
- **Business tagging (5A):** company-wide bank account + review list; business set per line (batch default, changeable; rules can set it; no post without a business).
- **Helpers folded in:** split, transfer, uncategorized holding account, exclude + undo.

**OCR-for-bills:** same engine reads a supplier bill → pre-fills a Bill for review; source file attached; no auto-post.

**Archive:** third state (Active/Inactive/**Archived**) — hidden but retained, reversible, audit-logged; proposed scope = master records (confirm).

## 4. Open items for you (from the feature doc §H)

1. Confirm **archive scope** (customers, items, vendors; and whether documents get a hide-from-default filter).
2. Confirm **payment auto-recorded** when you accept a match on a vendor bill (vs an extra confirm).
3. **Uncategorized account** — auto-created, or named by you.

## 5. Verified research this session

- **QBO working style** → project doc *Research - QBO Bank Transaction Categorization (for V1)* (official Intuit help pages).
- **Offline OCR / PDF** → *Digital* PDFs need **no OCR** (pdfplumber/Camelot, offline). *Scanned* PDFs need OCR — **Tesseract** (offline, ~10MB, Apache-2.0, weak on complex tables) or **PaddleOCR** (offline, better table recovery, heavier; spot-check merged cells). Text-based vs scanned is the deciding factor. Sources: dev.to PDF-extraction guides (2026); pdnob / codesota OCR comparisons (2026).

## 6. Documents

- **Feature Design — Bank Transaction Categorization, Bill OCR & Archive (V1)** — this session (project).
- **Research - QBO Bank Transaction Categorization (for V1)** — this session (project).
- **Design Document — Book Buddha (current)** — needs a §1.5 / §17 update to reflect the v2→V1 move.
- 7 Nov handoff + earlier handoffs + magazine PRD v4.2 — project files.

## 7. Next steps

1. You review/approve the **Feature Design** doc.
2. **Phase 2 (extra invoicing users)** — design the open items from Design Document §2.4: invoicing-user login/recovery, the exact permission matrix, tablet/touch layout, how a device reaches the PC on the network, and connection-drop handling. *(Being resumed this session.)*
3. Update the main **Design Document** (§1.5 / §17) for the v2→V1 move.
4. Then App flow sections, PRD / Features List, and — only after you approve everything — the implementation plan.

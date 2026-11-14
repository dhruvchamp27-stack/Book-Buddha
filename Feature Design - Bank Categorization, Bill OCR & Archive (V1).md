# Feature Design — Bank Transaction Categorization, Bill OCR & Archive (V1)

*Draft for your review — 13 Nov 2026. Nothing is built until you approve. Supplements the **Design Document — Book Buddha (current)** and the **7 Nov handoff**.*

> **What this is.** On 13 Nov you moved three items that were previously **v2** (Design Document §1.5 / §17) into **V1**: bank-transaction categorization, OCR for supplier bills, and an archive state. This document specifies all three. They share one engine: *read a file → review on one screen → post.*

---

## A. Why (intent)

The aim is to cut repetitive manual data entry. Bank-statement categorization turns raw bank activity into posted accounting entries quickly; bill-OCR does the same for supplier bills; archive lets you put old records away without deleting them. QBO's categorization model is the reference (see the project doc *Research - QBO Bank Transaction Categorization*), adapted to Book Buddha's offline, one-PC design.

## B. Goals / non-goals / anti-goals

**Goals**
- Import a bank statement (CSV/Excel or PDF) and turn each line into a posted entry or a matched payment, fast.
- Pre-fill supplier bills from a PDF so you don't re-key them.
- Archive master records safely — reversible, with the audit trail intact.

**Non-goals (V1)**
- No live bank feed — file import only.
- No hands-free auto-posting of bank lines — you review and accept each.
- No sending data to the cloud by default — offline-first.

**Anti-goals (these would be failures even if it "works")**
- Double-counting — a bank line creating a duplicate of an already-entered bill or payment.
- Books going out of balance.
- Anything posting silently without your review.

## C. Constraints (inherited from the Design Document)

- Offline-first, one PC, one database file per company.
- The three fixed parts: automatic double-entry (books always balance), audit log, cancel-with-reversal.
- Every posted entry carries **exactly one business** (§3.2).
- Expense categories **are** the chart of accounts (§8.5).
- An account can be company-wide or per-business (§3.4).

---

## D. Feature 1 — Bank transaction categorization

### D1. Intake — three tiers, all feeding one review screen
1. **CSV/Excel** — primary, fully offline; reuses the existing import engine (§14.1). You map the columns (date, description, amount or debit/credit) once.
2. **Digital PDF** — offline, **no OCR**; for bank PDFs whose text is selectable. The app reads the table directly (pdfplumber/Camelot-style). Covers most Indian-bank statements.
3. **Scanned PDF** — offline **OCR fallback** (Tesseract) for image-only statements; results flagged **"please check."** An **optional cloud OCR** runs only when you're online **and** choose it — never the default (it sends data out).

*(The specific libraries are a build detail; the behaviour above is what's fixed.)*

### D2. The review screen (a holding queue)
- Imported lines sit in a review area and are **not in the books yet** (like a draft; mirrors QBO's "For review").
- The bank account is a **company-wide** asset account; the review list shows all its lines together (decision **5A**).
- Each line shows: date, bank description, amount (in/out), a **suggested** category/payee, the **business**, a **route** (Add or Match), and optional **fair/tags**.

### D3. Two routes per line (the core logic)
- **Add (new entry)** — the money wasn't recorded yet:
  - Money **out** → creates a **Bill/expense**, categorized to a chart account → posts.
  - Money **in** → creates an **income/receipt** entry → posts.
- **Match (existing)** — decision **3C**:
  - To an **open invoice/bill** (any customer/vendor) → records a **payment** (customer receipt or bill payment). **No new bill/income is created — so no double-count.**
  - To an **already-recorded** payment/expense → **confirms** it, no new posting.
- The app **suggests** the likely route and the likely match by amount/date/payee; you confirm or override.

### D4. Per-line tagging (decision 5A)
- **Business:** defaults to a business you pick for the batch; changeable per line; a rule can set it; **a line cannot post without a business.**
- **Fair (project)** and **tags:** optional per line.

### D5. Bank rules (decision 4A; already accepted in §17)
- Rules **pre-fill** category/payee (optionally business/fair/tags) from conditions on **description / bank text / amount** (*contains / doesn't contain / is exactly*).
- **Pre-fill only — you still click to accept.** No auto-post in V1 (auto-post stays a later option).
- Rules list: priority order, enable/disable, edit, delete.

### D6. Helpers (my calls, accepted)
- **Split** — one bank line across several categories (amounts must sum to the line total).
- **Transfer** — mark a line as money moved between your **own** accounts (not income/expense).
- **Uncategorized holding account** — if you can't categorize a line yet, it posts to an *Uncategorized* account so the books still balance; you fix it later. (Rules can't target it.)
- **Exclude** — remove duplicates / non-book lines; reversible (**Undo**); excluded lines aren't re-imported.

### D7. The accounting (stays automatic — you never type debits/credits)
- **Add, money out** (new expense) → Dr expense · Cr bank. (A new vendor **bill** posts the expense; its later **payment** is the matched bank line.)
- **Add, money in** → Dr bank · Cr income (or the chosen account).
- **Match to open invoice** → Dr bank · Cr Accounts Receivable (receipt).
- **Match to open bill** → Dr Accounts Payable · Cr bank (bill payment).
- **Transfer** → Dr/Cr between the two accounts.

---

## E. Feature 2 — OCR for supplier bills / expenses

- **Same intake engine:** read a supplier bill PDF (digital text extraction; scanned via offline OCR; optional cloud OCR only when online).
- **Output:** pre-fills a **Bill/Expense** document — payee, date, amount, and line items where readable — **for your review before saving.** You confirm; then it posts normally.
- The **source file is attached** to the record (§7.8 already supports attachments), so the original is kept for audit.
- **Non-goal:** automatic posting without review. OCR is a typing-saver, not an auto-poster; scanned results are flagged "please check."

---

## F. Feature 3 — Archive (a third record state)

- **Today:** records are Active/Inactive; delete is Admin-only and only where no accounting is affected.
- **Archive** adds a third state: **Archived = hidden** from normal lists and pickers, but **fully retained** (audit and history intact) and **reversible** (Unarchive).
- **Purpose:** put away old/obsolete master records (discontinued items, dormant customers/vendors) without deleting them.
- **Proposed scope (please confirm):** archive applies to **master records** — customers, items, vendors and similar list entries. Posted **documents** are never deleted; "archiving" a document means **hiding it from default views** via a filter, not removing it.
- **Rules:** an archived item can't be picked on a new document; archiving is **blocked while it has live stock or an open balance** (clear first), consistent with the Inactive rules; every archive/unarchive is **audit-logged**.

---

## G. Approaches considered (and why these were chosen)

- **Intake:** live bank feed (rejected — needs internet/bank API, against offline-first) vs **file import** (chosen). Within PDF: text-extraction first with **OCR only for scans** (chosen — keeps most imports offline and accurate).
- **Bank-line role:** reconciler-only (rejected — you mostly *create* entries) vs **data-entry source with match as the exception** (chosen) — the two-route model gives both.
- **Auto-posting:** on (rejected for V1 — risk of silent errors for a single user) vs **pre-fill + manual accept** (chosen).
- **Business tagging:** one business per bank account (rejected — an account may serve the whole company) vs **company-wide account + per-line business** (chosen, 5A).

## H. Left to the builder, and open items for you

**Builder calls (sensible defaults, settled at build time):**
- The specific OCR/extraction libraries and the CSV column-mapping screen.
- Match-suggestion scoring (how amount/date/payee are weighted).
- The dedup key for "don't re-import the same line" (e.g. date + amount + running balance, or a bank reference).

**Open items for YOU (these change what gets built):**
1. **Archive scope** — confirm it covers customers, items, vendors (and whether documents get a hide-from-default filter).
2. **Matched vendor-bill line** — confirm you want the payment recorded automatically when you accept a match (vs an extra confirm step).
3. **Uncategorized account** — auto-created by the app, or named by you.

*(These three are the only user-level decisions left; the rest are build details.)*

---

*Status: awaiting your review. On approval, next steps are to update the main Design Document (§1.5/§17) for the v2→V1 move, then carry these into the App flow / PRD / Features List, and only then the implementation plan.*

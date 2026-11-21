# End-to-end Workings: one month of business, October 2025 — FOR YOUR APPROVAL

> **Status: DRAFT, not approved.** Written 21 Nov 2026 (session 16) for the all-together run your
> standing order asks for (S12-3). **Every amount below was worked out by hand, NOT read from the
> app.** The posting rules behind them were taken from a read of the code (for example, which stock
> goes out first). Two of those rules change the figures; they are set out under "Your decisions" C. Once you approve them, a test drives this whole month through the real
> API and checks the app gives exactly these numbers. Where the app disagrees, I report it to you as
> a disagreement; I never adjust a figure to match the app.
>
> Money is in rupees (Rs). The app stores paise; every figure here is a whole rupee.

---

## Why this scenario

One company, one business, one book fair, about twenty dated events across October 2025. It is small
enough to check by hand, and it gives every slice still waiting for your acceptance a leg:

| Slice | What it is | Where it appears below |
|---|---|---|
| R1 | Chart of accounts and account groups | Every account lands in the right place on the Trial Balance, P&L and Balance Sheet |
| R2 | Payment dates | Invoice INV-001 dated 2 Oct, paid 8 Oct: cash-basis profit moves to the payment date |
| R4, R4b | Opening balances, customers and suppliers | Events 1–4, 7 and 21 |
| R5 | Financial-year lock | Step 9 |
| R6 | Tamper-evident audit log | Step 9 |
| R7 | Reports | Section 4 |
| R8 | Purchase returns, refunds, payment cancellation | Events 12, 19, 22 |
| R9–R11 | Attachments, export, backup and restore | Step 8 |
| R12 | Banking | Uses the October HDFC figures you already approved: statement 84,066, books 71,966 |

**Kept out on purpose,** because today's rulings will change them: items dated before the opening
date, repeated payments in an import, bill discounts, mixed GST rates on one invoice, and a stock
purchase with no bill.

**"Today" is fixed at 31 Oct 2025 for this test.** The app dates every cancellation "today", so
without this a cancellation would land in November 2026 and spoil the October figures.

---

## 1. The world

- **Company** Demo Books, accrual basis · **Business** Book Fairs · **Financial year** 1 Apr 2025 – 31 Mar 2026.
- **Fair** Pune Book Fair, 20–22 Oct 2025, hosted by Sunrise School.
- **Customers** Raman Books (trade) · Sunrise School (fair host) · walk-in buyers on the cash invoices.
- **Suppliers** Om Publishers (books) · Print Hub (stationery).
- **Bank** HDFC Current. **Extra expense accounts** Printing, Bank Charges.
- **Items** (both stock-tracked) — **Novel A**: books, no GST · **Notebook**: stationery, GST 18%.
- **GST** is one rate per invoice, CGST + SGST, split half and half.

---

## 2. The events, in date order, with what each posts

| # | Date | What happens | Debit | Credit |
|---|---|---|---|---|
| 1 | 1 Oct | Opening balances: HDFC 50,000, Cash 20,000 | HDFC 50,000 · Cash 20,000 | Opening Balance Equity 70,000 |
| 2 | 1 Oct | Opening customer balance: Raman Books owes 5,900 | Receivables 5,900 | Opening Balance Equity 5,900 |
| 3 | 1 Oct | Opening supplier balance: we owe Om Publishers 3,000 | Opening Balance Equity 3,000 | Payables 3,000 |
| 4 | 1 Oct | Opening stock: Novel A, 150 at Rs 100 | Inventory 15,000 | Opening Balance Equity 15,000 |
| 5 | 2 Oct | **INV-001** to Raman Books, on credit: 118 Novel A at Rs 200 | Receivables 23,600 | Sales 23,600 |
| 5a | 2 Oct | Cost of those 118 books (from opening stock at Rs 100) | Cost of Goods Sold 11,800 | Inventory 11,800 |
| 6 | 3 Oct | Internal Transfer: fair cash banked, Cash → HDFC | HDFC 12,000 | Cash 12,000 |
| 7 | 6 Oct | Opening supplier balance paid to Om Publishers in cash | Payables 3,000 | Cash 3,000 |
| 8 | 8 Oct | Raman's NEFT (ref UTR123) matched to INV-001 from the bank feed | HDFC 23,600 | Receivables 23,600 |
| 9 | 10 Oct | **PB-001** from Om Publishers, on credit: 120 Novel A at Rs 150 | Inventory 18,000 | Payables 18,000 |
| 10 | 15 Oct | PB-001 paid by HDFC cheque CHQ 000451 (not yet presented) | Payables 18,000 | HDFC 18,000 |
| 11 | 16 Oct | **PB-002** from Print Hub, paid in cash: 100 Notebooks at Rs 25 = 2,500 + GST 450 | Inventory 2,500 · Input CGST 225 · Input SGST 225 | Cash 2,950 |
| 12 | 18 Oct | **PR-001**: 10 Novel A returned to Om Publishers at Rs 150. PB-001 is already paid, so this becomes a credit with the supplier | Supplier Credits 1,500 | Inventory 1,500 |
| 13 | 20 Oct | Bank feed: UPI 1,180 to a printer, added as Printing 1,000 + GST 180 (voucher PV-001) | Printing 1,000 · Input CGST 90 · Input SGST 90 | HDFC 1,180 |
| 14 | 21 Oct | **INV-002**, fair walk-in, paid in cash: 30 Novel A at Rs 200 | Cash 6,000 | Sales 6,000 |
| 14a | 21 Oct | Cost of those 30 (opening stock at Rs 100) | Cost of Goods Sold 3,000 | Inventory 3,000 |
| 15 | 21 Oct | **INV-003**, fair walk-in, paid in cash: 50 Notebooks at Rs 40 = 2,000 + GST 360 | Cash 2,360 | Sales 2,000 · Output CGST 180 · Output SGST 180 |
| 15a | 21 Oct | Cost of those 50 Notebooks at Rs 25 | Cost of Goods Sold 1,250 | Inventory 1,250 |
| 16 | 21 Oct | **EXP-001** fair stall rent, paid in cash: 2,000 + GST 360 | Expense 2,000 · Input CGST 180 · Input SGST 180 | Cash 2,360 |
| 17 | 22 Oct | **CN-001** on INV-002: 5 Novel A returned at Rs 200, cash given back at once | Sales 1,000 | Cash 1,000 |
| 17a | 22 Oct | Those 5 books back into stock at their original cost, Rs 100 | Inventory 500 | Cost of Goods Sold 500 |
| 18 | 22 Oct | **INV-004** to Sunrise School, on credit, at the fair: 20 Novel A at Rs 250 | Receivables 5,000 | Sales 5,000 |
| 18a | 22 Oct | Cost of those 20: last 2 of opening stock at Rs 100 + 18 from PB-001 at Rs 150 | Cost of Goods Sold 2,900 | Inventory 2,900 |
| 19 | 24 Oct | Om Publishers refunds the PR-001 credit in cash | Cash 1,500 | Supplier Credits 1,500 |
| 20 | 25 Oct | Sunrise pays INV-004 in cash | Cash 5,000 | Receivables 5,000 |
| 21 | 28 Oct | Raman pays his opening balance by cheque into HDFC (not yet cleared) | HDFC 5,900 | Receivables 5,900 |
| 22 | 31 Oct | The 25 Oct payment was recorded in error and is **cancelled by reversal** | Receivables 5,000 | Cash 5,000 |
| 23 | 31 Oct | Bank feed: charges 354, added as Bank Charges 300 + GST 54 (voucher PV-002), pre-filled by a bank rule | Bank Charges 300 · Input CGST 27 · Input SGST 27 | HDFC 354 |

**Stock is used up oldest first.** The cost of each sale works out like this:

- **INV-001** took 118 of the 150 opening books at Rs 100, leaving 32.
- **INV-002** took 30 more, leaving 2.
- **INV-004** took those last 2 at Rs 100, then 18 from PB-001's lot at Rs 150. That lot had dropped from 120 to 110 after the return.
- **CN-001's** 5 returned books sit at the back of the queue at Rs 100.

---

## 3. Closing balances, 31 October 2025

### Trial Balance (each account shown net, on one side)

| Account | Debit | Credit |
|---|---:|---:|
| HDFC Current | 71,966 | |
| Cash | 8,550 | |
| Receivables | 5,000 | |
| Inventory | 15,550 | |
| Input CGST | 522 | |
| Input SGST | 522 | |
| Cost of Goods Sold | 18,450 | |
| Expense (stall rent) | 2,000 | |
| Printing | 1,000 | |
| Bank Charges | 300 | |
| Opening Balance Equity | | 87,900 |
| Sales | | 35,600 |
| Output CGST | | 180 |
| Output SGST | | 180 |
| **Total** | **123,860** | **123,860** |

Payables, Supplier Credits and Customer Credits all close at **zero**.

**How each balance is made up:**

- **Cash:** 20,000 − 12,000 − 3,000 − 2,950 + 6,000 + 2,360 − 2,360 − 1,000 + 1,500 + 5,000 − 5,000 = **8,550**
- **HDFC:** 50,000 + 12,000 + 23,600 − 18,000 − 1,180 + 5,900 − 354 = **71,966** (your approved figure)
- **Receivables:** only INV-004 (Sunrise School) is still owed = **5,000**
- **Inventory:**
  - Novel A: 92 at Rs 150 + 5 at Rs 100 = 14,300
  - Notebook: 50 at Rs 25 = 1,250
  - Total **15,550**
- **Opening Balance Equity:** 70,000 + 5,900 − 3,000 + 15,000 = **87,900**
- **Sales:** 23,600 + 6,000 + 2,000 − 1,000 + 5,000 = **35,600**
- **Cost of Goods Sold:** 11,800 + 3,000 + 1,250 − 500 + 2,900 = **18,450**

### Profit & Loss, 1–31 October 2025

| | Accrual basis | Cash basis |
|---|---:|---:|
| Sales | 35,600 | 30,600 |
| Cost of Goods Sold | 18,450 | 15,550 |
| Expense (stall rent) | 2,000 | 2,000 |
| Printing | 1,000 | 1,000 |
| Bank Charges | 300 | 300 |
| **Net profit** | **13,850** | **11,750** |

**Why cash basis is 2,100 lower:** INV-004's payment was cancelled, so on cash basis INV-004 is
unpaid and recognises nothing. Its 5,000 of sales and 2,900 of cost both drop out, and
5,000 − 2,900 = 2,100.

The rest is the same on both bases:
- INV-001 was paid in full by 31 Oct.
- INV-002, INV-003, the stall rent and the two bank vouchers were paid at once.
- Raman's opening balance carried no income.
- GST is never income or expense.

**Payment dates (R2):** for **1–7 October**, accrual profit is **11,800** (INV-001's 23,600 less its
11,800 cost). Cash-basis profit is **0**, because Raman paid on 8 Oct. Run to 8 Oct, cash basis
reaches **11,800**.

### Balance Sheet, 31 October 2025

| Assets | | Liabilities and equity | |
|---|---:|---|---:|
| HDFC Current | 71,966 | Output CGST | 180 |
| Cash | 8,550 | Output SGST | 180 |
| Receivables | 5,000 | **Total liabilities** | **360** |
| Inventory | 15,550 | Opening Balance Equity | 87,900 |
| Input CGST | 522 | Profit this year (accrual) | 13,850 |
| Input SGST | 522 | **Total equity** | **101,750** |
| **Total assets** | **102,110** | **Total liabilities + equity** | **102,110** |

---

## 4. Reports that must agree with the books

| Report | Expected | Must equal |
|---|---|---|
| Receivables | One row: INV-004, Sunrise School, 5,000 | Receivables account 5,000 |
| Payables | No rows | Payables account 0 |
| Inventory valuation | Novel A, 97 books, 14,300 · Notebook, 50, 1,250 | Inventory account 15,550 |
| Sales by fair: Pune Book Fair | Invoiced 13,000 (INV-002, 003, 004) · credit notes 1,000 · net **12,000** · 3 invoices, 1 credit note | — |
| Sales outside the fair | INV-001, 23,600 | Fair 12,000 + 23,600 = Sales 35,600 |
| Sales by item: Novel A | Sold 168 for 34,600 · returned 5 for 1,000 · net 163 for **33,600** | — |
| Sales by item: Notebook | Sold 50 for 2,000 · net **2,000** | Items together 35,600 = Sales |
| Customer statement: Raman Books | Opening 5,900 · INV-001 23,600 · payment −23,600 (8 Oct) · receipt −5,900 (28 Oct) · closing **0** | — |
| Customer statement: Sunrise School | INV-004 5,000 · closing **5,000**. The cancelled 25 Oct payment shows **no row**: a cancelled payment never settled anything (S13-1) | Receivables report |
| HDFC register | Running balance 50,000 → 62,000 → 85,600 → 67,600 → 66,420 → 72,320 → **71,966** | Trial Balance HDFC |
| Cash register | Closing **8,550** | Trial Balance Cash |
| GST | Output 360 · input 1,044 · net 684 to claim back | Trial Balance GST lines |

---

## 5. The banking leg (R12): your approved October HDFC figures

1. **Import the statement.** Import the October statement: four lines, +12,000 · +23,600 · −1,180 · −354, closing **84,066**.
   - The preview writes nothing.
   - The commit adds 4 lines.
   - Importing the same file again adds **0**, with **4 duplicates**.
   - The books do not change, because a statement posts nothing.
2. **Clear the review queue.**
   - Match the 12,000 line to the existing Internal Transfer (event 6). Nothing is posted.
   - Match the 23,600 line to INV-001. This is the payment in event 8.
   - Add the 1,180 line as Printing (event 13).
   - The bank rule "Bank charges" pre-fills the 354 line. Add it (event 23).
3. **Reconcile to 31 Oct, statement balance 84,066.**
   - The four statement lines arrive already ticked. Tick the opening 50,000 by hand.
   - The cleared balance is 84,066, so the difference is **0**. Finish.
   - **Not yet cleared:** the supplier cheque −18,000 and Raman's cheque +5,900.
   - **Proof:** 84,066 − 18,000 + 5,900 = **71,966** = the books.

---

## 6. Checks that hold whatever the figures

These are the backstops. If a hand figure above is wrong, these still catch a broken app.

- The Trial Balance totals the same on both sides, and the Balance Sheet balances.
- Receivables and payables reports equal their control accounts. Stock valuation equals Inventory.
- The bank register, the ledger and the reconciliation all show the same HDFC figure.
- The audit chain is unbroken.

## 7. Files, backup and the year lock (steps 8 and 9)

8. **Files and backup.**
   - Attach a PDF to PB-001: it is listed against PB-001.
   - Export the Trial Balance as CSV: every row matches section 3 in rupees.
   - Back up the database, restore it into a fresh file and reopen it: the Trial Balance is **identical**.
9. **Lock and audit.**
   - Lock financial year 2025-26.
   - Try to record a cash expense dated 31 Oct: it is **refused**, and the Trial Balance is unchanged.
   - The audit chain verifies.

---

## Your decisions

**A. Approve the figures.** Sections 2–5 are the figures the test will hold the app to.

**B. Two behaviours already built, so you know what you are signing.**
- **Cash-basis cost of goods sold follows payment.** An unpaid credit invoice recognises neither its sales nor its cost, which is why INV-004 drops out entirely. This is the 7d/8c treatment you accepted on trust.
- **A cancelled payment disappears from the cash basis entirely, as if it had never been received.**
  - On accrual basis, the cancellation is a reversal dated the day it was cancelled.
  - In this scenario both fall in October, so they agree.
  - If the cancellation had come in November, October's cash-basis P&L would change after the fact (S8-1, already known).

**C. Two stock-queue rules that change the figures.** These were built as engineering choices and
recorded, but never put to you as rulings.

1. **Books a customer returns go to the BACK of the queue,** at their original cost.

   | | Back of the queue (as built, used above) | Front of the queue |
   |---|---:|---:|
   | INV-004's cost (20 books) | 2 at 100 + 18 at 150 = **2,900** | 2 at 100 + 5 at 100 + 13 at 150 = **2,650** |
   | Cost of Goods Sold, October | 18,450 | 18,200 |
   | Accrual net profit | 13,850 | 14,100 |
   | Closing Inventory | 15,550 | 15,800 |

   Cash basis is 11,750 either way, because INV-004 is unpaid. My view: keep the back of the queue.
   The returned books came in last, and it is simple and predictable.

2. **Books returned to a supplier leave from that bill's own lot** (PR-001 takes 10 books at
   Rs 150 from PB-001), not from the oldest stock (which would be the opening books at Rs 100). My
   view: keep it. Those are the very books that went back, at the price that was paid for them.

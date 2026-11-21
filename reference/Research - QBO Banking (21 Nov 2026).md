# Research — How QuickBooks Online handles banking (21 Nov 2026)

*Reference for R12. Written because the Feature Design (§A) cites a "Research - QBO Bank Transaction
Categorization" document that is not in this repo. This replaces it. Marks: **[read]** = taken from
the Intuit page itself; **[search]** = from search-result summaries of Intuit pages, not read line by
line. Menu names vary by region; the behaviour is what matters.*

---

## 1. Bank accounts
- A bank account is an ordinary chart-of-accounts entry: type **Bank**, with a detail type
  (current, savings, cash on hand…). You can have as many as you like. **[search]**
- Opening balance + "as of" date are typed when the account is created. The other side goes to
  **Opening Balance Equity**. For an old account Intuit says: use the start date of your next
  statement. **[search]**
- Each account has a **register**: every transaction touching it, in date order, with a running
  balance and a status column — blank (not cleared), **C** (cleared), **R** (reconciled). **[read]**

## 2. Transfers between your own accounts
- One transaction, two accounts: money leaves one, arrives in the other. Intuit warns against
  entering a withdrawal in one and a deposit in the other — that double-counts. **[search]**
- If both banks' lines are imported, you record the transfer from one side and **Match** it from
  the other, so one transfer clears both. **[search]**

## 3. Payments into a bank, and "Undeposited Funds"
- When you receive a customer payment you choose **Deposit to**: a bank account directly, or
  **Undeposited Funds** (renamed "Payments to deposit"), a holding account. **[search]**
- Undeposited Funds exists so that several cheques/cash taken in separately can be grouped into the
  **one deposit** the bank shows. If the bank shows each payment separately, you deposit straight to
  the bank. **[search]**
- *Book Buddha equivalent:* fair cash is taken into **Cash**, and banking it later is a **transfer
  Cash → Bank**. Same result, one fewer concept.

## 4. Bank feed / statement review ("For review")
- Downloaded or uploaded lines land in **For review** — they are **not in the books yet**. **[search]**
- For each line you either **Add** (create a new expense/deposit, categorised to an account),
  **Match** (to something already entered — an invoice payment, a bill payment, a transfer), or
  **Exclude** (duplicates, personal). Excluded lines are not re-imported; **Undo** brings them back.
  **[search]**
- Matched/added lines move to **Categorized**. **[search]**
- **Bank rules** pre-fill the category/payee from the description or amount; an "auto-add" rule can
  post without review (badge AUTO). **[search]**
- *Book Buddha:* already designed in the approved Feature Design §D (Add / Match / Transfer / Split /
  Exclude / Uncategorised; rules pre-fill only, never auto-post).

## 5. Reconciliation — the heart of it
**Starting** **[read]**
- Pick the account. QBO shows the **last statement ending date**; the new statement should start the
  day after.
- Type the statement's **ending balance** and **ending date**.
- The **beginning balance** is not typed: it is the previous reconciliation's ending balance (rolled
  over). If it doesn't agree with the statement's opening balance, something reconciled earlier has
  changed. **[search]**

**Working**
- You tick every transaction that appears on the statement. **Cleared balance** moves as you tick;
  the **Difference** must reach **0.00**. **[read]**
- Difference = statement ending balance − cleared balance. **[search]**
- Items in the books but not yet on the statement (a cheque not yet presented, a deposit in transit)
  stay **unticked** — normal; they carry to next month. **[search]**
- Usual causes of a difference: wrong ending balance typed; something on the statement not in the
  books (bank charges, interest); a duplicate or misdated entry. **[search]**

**Finishing** **[read]**
- At 0.00 → **Finish now** → Done. A **reconciliation report** is saved under *History by account*.
- If you cannot reach 0.00, QBO lets you finish anyway and **posts a journal entry for the
  difference** (Intuit says: talk to your accountant first).

**Undoing** **[read]**
- One transaction: open the register and click its **R** back to blank. This changes the beginning
  balance of the next reconciliation.
- A whole reconciliation: Primary Admin (or the accountant) only. It is irreversible and **deletes
  the saved report and attachments**. **[read]** Undoing an older one also undoes every later one.
  **[search]**

## 6. What Book Buddha should copy, and what it should not
| QBO behaviour | Book Buddha | Why |
|---|---|---|
| Many bank accounts, each with a register | **Copy** | a business has several banks |
| Transfer = one transaction | **Copy** | avoids double counting |
| Undeposited Funds | **Skip** | Cash + transfer covers it |
| Beginning balance rolls over | **Copy** | the core control |
| Finish only at 0.00 | **Copy** | |
| Finish with a difference → auto journal entry | **Do not copy** | a silent plug; S11-11 "never silently ignore discrepancies" |
| Un-tick one reconciled line in the register | **Do not copy** | weakens the tamper-evident trail; undo the latest reconciliation instead |
| Undo deletes the report | **Do not copy** | audit log is a fixed part — keep history, mark it undone |
| Auto-add bank rules | **Do not copy (V1)** | FD §D5: no auto-post |
| Live bank feed | **Do not copy** | offline-first |

## Sources
- [Reconcile an account in QuickBooks Online](https://quickbooks.intuit.com/learn-support/en-us/help-article/statement-reconciliation/reconcile-account-quickbooks-online/L3XzsllsK_US_en_US) **[read]**
- [Undo or remove transactions from reconciliations](https://quickbooks.intuit.com/learn-support/en-us/help-article/statement-reconciliation/undo-transactions-reconciliations-quickbooks/L8thfIHZc_US_en_US) **[read]**
- [Transfer funds between accounts](https://quickbooks.intuit.com/learn-support/en-us/banking-topics/transfer-funds-between-accounts/00/186729) **[search]**
- [Add accounts to the chart of accounts](https://quickbooks.intuit.com/learn-support/en-us/help-article/bank-connectivity/add-accounts-chart-accounts/L17ITwtrg_US_en_US) **[search]**
- [What's an opening balance](https://quickbooks.intuit.com/learn-support/en-us/bank-reconciliation/what-s-an-opening-balance/00/355705) **[search]**
- [Categorize online bank transactions](https://quickbooks.intuit.com/learn-support/en-us/banking/match-and-categorize-your-downloaded-bank-transactions/00/262536) **[search]**
- [Deposit payments into Undeposited Funds](https://quickbooks.intuit.com/learn-support/en-us/help-articles/deposit-payments-into-the-undeposited-funds-account/00/238939) **[search]**
- [Bank reconciliation in QBO (FitSmallBusiness)](https://fitsmallbusiness.com/bank-reconciliation-quickbooks-online/) **[search]**

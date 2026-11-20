# Testing — Book Buddha

> **Owner-owned. Filled 2026-11-15 from the project's own docs** (sourced inline). This is
> the single home for **every test that must pass before the app goes into real use** —
> both **technical** tests (code/engine/DB) and **user-level** tests (you working real
> figures by hand and checking the app agrees). Rows marked *(seed: source)* come from the
> spec and are ready to use; rows marked `TODO`/`[ ]` are for you to run or complete.
> **Go-live gate:** the app is cleared for use only when every row is **PASS** and you have
> personally signed off Part B — *acceptance = your hand-worked figures, not a passing
> technical test* *(seed: DD §19)*.

## How to record each test
| ID | Area | Scenario | Steps | Expected | Actual | Status |
|----|------|----------|-------|----------|--------|--------|
Status values: `NOT RUN` · `PASS` · `FAIL` · `BLOCKED`. One row per concrete scenario.

---

# Part A — Technical tests

## A1. Accounting engine (unit)
- [ ] Balanced posting: every finalised document produces debits = credits *(seed: DD §4.1)*
- [ ] Unbalanced save is rejected *(seed: DD §4.1)*
- [ ] Draft posts nothing, reserves stock only *(seed: DD §4.2, §6.3)*
- [ ] Tax: output vs input never mixed; per-line tax totals correct *(seed: DD §13.1 —
      **confirm per-line (DD) vs prototype invoice-level**)*
- [ ] **Rounding — LOCK THE RULE FIRST** (whole-rupee: show amount-before-rounding +
      round-off line + final total, receipts keep paise — DD §7.4; vs exact-paise — DEC/
      ANTI). **Conflict, see `Progress.md` → Open to-dos and questions** *(seed: DD §7.4)*
- [ ] FIFO cost & COGS correct across layers; restoration on cancel/credit *(seed: DD §6.3)*
- [ ] Cash vs accrual recognition; partial payments never over-recognise; cash from actual
      allocations *(seed: DD §4.5)*
- [ ] Untracked item: cost at purchase bill, revenue at invoice *(seed: DD §6.4)*
- [ ] Standalone challan posts nothing; **linked** challan posts Dr Unearned Revenue /
      Cr Sales (+COGS/stock if tracked) *(seed: DD §8.3, §11.1)*
- [ ] "Deliver over time" → Unearned Revenue; "deliver now" → sale *(seed: DD §7.5)*
- [ ] Challan cannot over-deliver vs invoice qty; delivered/pending tracked; stock &
      revenue never double-counted *(seed: DD §11.4)*
- [ ] Mid-period price change uses the supply-date rate; earlier supplies keep theirs
      *(seed: DD §11.5)*
- [ ] Settlement over/under → refund, carry-forward, or balance-due invoice; debt never
      created twice *(seed: DD §11.6)*
- [ ] Credit note raises the credit pool; applying it creates a Credit-type payment linked
      to both documents; total never exceeds source *(seed: DD §8.2)*
- [ ] Refund restores the invoice balance; write-off preserves history, later recovery
      links back *(seed: DD §9.5)*
- [ ] Opening balances must balance; Opening Balance Equity absorbs the difference
      *(seed: DD §4.7)*
- [ ] Cancel-with-reversal reverses sale, payment and stock **exactly**; number not reused
      *(seed: DD §4.4, §19)*
- [ ] Edit finalised invoice keeps the prior version *(seed: DD §4.4, §7.6)*
- [ ] FY lock: a locked year refuses edits except an Admin correction *(seed: DD §4.6, §19)*

## A2. API & repository (integration)
- [ ] API rejects invalid input; frontend-supplied totals/statuses ignored *(seed: ARCH §3.2)*
- [ ] Every financial op runs in ONE transaction; partial failure rolls back fully
      *(seed: DD §4.2, §18; ARCH §3)*
- [ ] Ownership scope enforced (company/business/customer/supplier/item/project)
      *(seed: ARCH §8)*
- [ ] Numbering: number taken on first save even as draft; a deleted draft leaves a gap;
      collision retry + atomic lock; **double-click never creates two documents**
      *(seed: DD §7.2, §18)*; numbers reset per FY per document type *(seed: DD §4.6)*
- [ ] Payment: amount and customer are immutable after save; cannot overpay a single
      invoice line *(seed: DD §9.2, §9.4)*
- [ ] Customer delete allowed only with no linked records; Phase-1 delete is Admin-only
      *(seed: DD §5.9, §2.4)*
- [ ] Import: a failed row is skipped and collected; the import does not abort
      *(seed: DD §14.1)*
- [ ] `TODO`: endpoint contract/error-envelope tests — **envelope & status codes not
      specified in docs**, define at build time

## A3. Accounting integrity invariants (ARCH §8 — the exact checklist)
- [ ] 1. Debits = credits on every entry
- [ ] 2. Reversals are exact opposites of the original
- [ ] 3. Drafts don't post
- [ ] 4. Posted records are never destructively edited
- [ ] 5. Ownership matches (company/business/customer/supplier/item/project)
- [ ] 6. Stock never goes negative
- [ ] 7. FIFO layers reconcile to stock movements
- [ ] 8. Payment allocations never exceed balances
- [ ] 9. Credit-note total never exceeds its source
- [ ] 10. Locked periods reject changes
- [ ] 11. Failed operations roll back
- [ ] 12. Audit hash chain validates end-to-end
- [ ] 13. Reports reconcile back to the journals

## A4. Data, migrations & backup
- [ ] Migrations ordered, backward-compatible, transactional; `PRAGMA foreign_key_check`
      passes *(seed: ANTI/ARCH §8)*
- [ ] Integrity check runs at startup and before backup/restore *(seed: ARCH §3.5)*
- [ ] Backup → restore round-trip preserves data; restore sanitises settings; can preserve
      users + counters; pre-restore backup offered *(seed: DD §14.3)*
- [ ] Attachments stored outside SQLite (metadata only in DB); included in backup scope
      *(seed: DD §5.8, §14.3)*
- [ ] `TODO`: large-DB / corruption-recovery cases

## A5. Build & CI gates (must pass to call a slice done)
- [ ] `npm test` green *(seed: prototype claims 19 passing — **re-verify, unverified**)*
- [ ] `npm run build` (tsc) clean
- [ ] `npm run build:web` clean
- [ ] `TODO`: lint / type-coverage / `npm audit` policy (never `--force`)

## A6. Security
- [ ] Password rules (≥8, letters+numbers), 5-try lockout (15 min), 1 h idle sign-out with
      1-min warning + "Stay signed in" *(seed: DD §15.2)*
- [ ] Google sign-in for setup + password recovery works; app password works offline
      *(seed: DD §15.2)*
- [ ] Secrets never readable via file tools (`.env`/`config.json` blocked) and never committed
- [ ] `TODO`: password-hashing choice, session handling, Phase-2 permission matrix
      *(not specified in docs)*

---

# Part B — User-level / acceptance tests (you, by hand)

## B1. Per-slice acceptance (hand-worked figures)
For each slice, fill an acceptance sheet (template at the bottom): 3–5 scenarios where you
compute the expected journals & stock yourself, then compare the app's output
*(seed: ANTI §4 — sheets live in `testing/Acceptance - <slice> (<date>).md`)*.
Slices to cover (confirm order once the **next-slice** decision is made — Foundation vs
Credit notes):
- [ ] Foundation (engine, company/business/chart, login, opening balances)
- [ ] Customers & items / inventory
- [ ] Invoices & payments
- [ ] Credit notes & sales returns
- [ ] Challans & subscriptions / deferred revenue
- [ ] Fairs (Project P&L)
- [ ] Reports
- [ ] `TODO`: your scenarios per slice

## B2. End-to-end flows (walk them as the real user)
- [ ] First-run setup: Google sign-in → company → business → chart → FY → numbering →
      opening balances → app password → dashboard *(seed: AF Part A)*
- [ ] Make an invoice: new → customer → lines → deliver now/over time → save posts →
      receive payment → status updates; ageing updates *(seed: AF Part A; DD §7)*
- [ ] Issue a credit note, then apply it; stock restores; credit pool correct
      *(seed: AF §6.2; DD §8.2)*
- [ ] **Cancel-with-reversal**: cancel a finalised invoice → exact reverse posts, stock
      restored, document still visible as Cancelled, number not reused *(seed: DD §4.4)*
- [ ] Quote → invoice conversion (copies lines, links both ways, no double-post)
      *(seed: AF §6.1)*
- [ ] Recurring invoice generation + interlock (skip if an earlier child is unpaid)
      *(seed: AF §6.4; DD §8.4)*
- [ ] Payment allocation (apply oldest first) + bulk "Mark paid" *(seed: DD §9.2, §7.7)*
- [ ] Refund / sales return / write-off *(seed: AF §7.4; DD §9.5)*
- [ ] Fair as a Project: fair invoicing with Save & New, end-of-fair incentive, fair P&L
      correct *(seed: DD §10; AF §8)*
- [ ] Subscription: advance invoice → linked challan delivery → period-end settlement
      (refund / carry-forward / balance-due) *(seed: DD §11.6; AF §9)*
- [ ] Customer merge changes no accounting figure *(seed: DD §5.5)*
- [ ] Forgot password + session timeout behave as specified *(seed: DD §15.2; AF §2.4–2.5)*
- [ ] FY lock refuses edits *(seed: AF §12.3)*

## B3. Reports reconcile
- [ ] Trial Balance balances; P&L (cash **and** accrual), Balance Sheet, GL tie to journals
      *(seed: DD §12, §19)*
- [ ] **Report list — resolve the count conflict first.** The later docs (DD §12.1, PRD
      §5.10, FEAT §10, all ~12 Nov) list **17** reports (9 fixed + 8 accepted additions);
      DEC Q4 (9 Nov) still says **8 fixed + a simple builder**. The 17-list is the later
      accepted position unless the owner says otherwise — **confirm** *(conflict, see
      `Progress.md` → Open to-dos and questions)*
- [ ] `TODO`: tie each confirmed report back to the journals

## B4. Data in/out (from your seat)
- [ ] .xlsx / CSV import: two-phase preview (auto delimiter/encoding) → column map; failed
      rows skipped & listed; multi-row invoices grouped by document number; duplicate
      products update *(seed: DD §14.1)*
- [ ] Export to Excel / CSV / PDF across lists and reports; customer & settlement
      statements PDF/Excel *(seed: DD §14.2, §5.7, §11.6)*
- [ ] Challan print layout substitutes shipping address and suppresses cost/line-totals/tax
      *(seed: DD §8.3)*
- [ ] Backup and restore work for a non-engineer *(seed: DD §14.3)*
- [ ] `TODO`: PDF/print library choice (**not in docs**), attachment round-trip

## B5. Errors & usability (non-accountant)
- [ ] Error & validation messages are plain English and actionable (no accounting jargon);
      incomplete rows block save with a plain message, never silently dropped
      *(seed: DD §18, §7.4)*
- [ ] Form state survives an API/network error; typed work preserved on session expiry
      *(seed: DD §18, §15.2)*
- [ ] Negative stock blocked with a clear "Add stock" path *(seed: DD §6.3, §18)*
- [ ] `TODO`: your must-not-confuse-me cases

---

# Part C — Go-live checklist
- [ ] All Part A rows PASS
- [ ] All Part B flows PASS and personally signed off
- [ ] All acceptance sheets VERIFIED COMPLETE (only the owner sets this) *(seed: ANTI §6)*
- [ ] Open conflicts in `Progress.md` → Open to-dos and questions resolved for shipped features (rounding, tax placement,
      report count, archive, challan↔invoice link)
- [ ] `TODO`: anything else you require before real data goes in

---

## Acceptance-sheet template (copy per slice)
```
# Acceptance - <slice> (<date>)
Scenario 1: <plain description>
  Inputs: <what you enter>
  Expected journals: Dr <acct> <amt> / Cr <acct> <amt> ...
  Expected stock effect: <item> <qty> ...
  App actual: <paste / screenshot figures>
  Result: PASS / FAIL  (owner initials)
Scenario 2: ...
```

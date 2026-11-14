# Testing — Book Buddha

> **TEMPLATE — owner-owned.** This is the single home for **every test that must pass
> before the app goes into real use** — both **technical** tests (code/engine/DB) and
> **user-level** tests (you working real figures by hand and checking the app agrees).
> Seeded rows marked *(seed: source)* come straight from the spec and are ready to use;
> everything marked `TODO` or `[ ]` is for you to complete. **Go-live gate:** the app is
> only cleared for use when every row here is **PASS** and you have personally signed
> off the user-level section — *acceptance = your hand-worked figures, not a passing
> technical test* *(seed: DD §19, ANTI §4)*.

## How to record each test
| ID | Area | Scenario | Steps | Expected | Actual | Status |
|----|------|----------|-------|----------|--------|--------|
Status values: `NOT RUN` · `PASS` · `FAIL` · `BLOCKED`. One row per concrete scenario.

---

# Part A — Technical tests

## A1. Accounting engine (unit)
- [ ] Balanced posting: every finalised document produces debits = credits *(seed: DD §4.1)*
- [ ] Unbalanced save is rejected *(seed: DD §4.1)*
- [ ] Draft posts nothing (only reserves stock) *(seed: DD §4.2)*
- [ ] Tax: output vs input never mixed; per-line tax totals correct *(seed: DD §13.1 — confirm per-line vs per-invoice)*
- [ ] Rounding: `TODO` — **lock the rule first (whole rupee vs exact paise)** *(conflict, see todos.md)*
- [ ] FIFO cost & COGS correct across layers; restoration on cancel/credit *(seed: DD §6.3)*
- [ ] Cash vs accrual recognition (partial payments never over-recognise) *(seed: ARCH §7.2)*
- [ ] `TODO`: add engine edge cases

## A2. API & repository (integration)
- [ ] API rejects invalid input; frontend-supplied totals/statuses ignored *(seed: ARCH §3.2)*
- [ ] Every financial op runs in ONE transaction; partial failure rolls back fully *(seed: ARCH §3)*
- [ ] Ownership scope enforced (company/business/customer/supplier/item/project) *(seed: ARCH §8)*
- [ ] `TODO`: endpoint contract tests

## A3. Accounting integrity invariants (ARCH §8 — ready checklist)
- [ ] Debits = credits on every entry
- [ ] Reversals are exact opposites of the original
- [ ] Posted records are never destructively edited
- [ ] Stock never goes negative
- [ ] FIFO layers reconcile to stock movements
- [ ] Payment allocations never exceed balances
- [ ] Credit-note total never exceeds its source
- [ ] Locked periods reject changes
- [ ] Audit hash chain validates end-to-end
- [ ] Reports reconcile back to the journals

## A4. Data, migrations & backup
- [ ] Migrations are ordered, backward-compatible, transactional; `PRAGMA foreign_key_check` passes *(seed: ANTI §4)*
- [ ] Integrity check runs at startup and before backup/restore *(seed: ARCH §3.5)*
- [ ] Backup → restore round-trip preserves data; restore sanitises settings *(seed: DD §14.3)*
- [ ] `TODO`: large-DB / corruption-recovery cases

## A5. Build & CI gates (must pass to call a slice done)
- [ ] `npm test` green *(seed: prototype claims 19 passing — re-verify)*
- [ ] `npm run build` (tsc) clean
- [ ] `npm run build:web` clean
- [ ] `TODO`: lint / type-coverage / `npm audit` policy (never `--force`)

## A6. Security
- [ ] Password rules, 5-try lockout (15 min), 1 h idle sign-out *(seed: DD §15.2)*
- [ ] Secrets never readable via file tools (`.env`/`config.json` blocked) and never committed
- [ ] `TODO`: session handling, Phase-2 permission matrix

---

# Part B — User-level / acceptance tests (you, by hand)

## B1. Per-slice acceptance (hand-worked figures)
For each slice, fill an acceptance sheet (template at the bottom): 3–5 scenarios where
you compute the expected journals & stock yourself, then compare the app's output.
*(seed: ANTI §4 — sheets live in `testing/Acceptance - <slice> (<date>).md`)*
- [ ] `TODO`: list the slices and their scenarios

## B2. End-to-end flows (walk them as the real user)
- [ ] Create company/business, chart of accounts, log in
- [ ] Create a customer; make an invoice; take a payment; see ageing update
- [ ] Issue a credit note; apply it; stock restores
- [ ] **Cancel-with-reversal**: cancel a finalised invoice → exact reverse posts, stock
      restored, document still visible as Cancelled, number not reused *(seed: DD §4.4)*
- [ ] Fair as a Project: its own P&L is correct *(seed: DD §10)*
- [ ] Subscription: advance invoice → challan delivery → settlement/variance outcome *(seed: DD §11.6)*
- [ ] Bank import → review queue (Add/Match) → nothing posts until accepted *(seed: FD D2–D3)*
- [ ] `TODO`: add your real-world flows

## B3. Reports reconcile
- [ ] Trial Balance balances; P&L (cash AND accrual), Balance Sheet, GL tie to journals
- [ ] `TODO`: confirm the report list (8 vs ~17 — conflict, see todos.md)

## B4. Data in/out (from your seat)
- [ ] .xlsx / CSV import: two-phase preview → column map; failed rows skipped & listed *(seed: DD §14.1)*
- [ ] Backup and restore work for a non-engineer
- [ ] `TODO`: PDF/print, attachments

## B5. Errors & usability (non-accountant)
- [ ] Error messages are plain English and actionable (no accounting jargon)
- [ ] `TODO`: your must-not-confuse-me cases

---

# Part C — Go-live checklist
- [ ] All Part A rows PASS
- [ ] All Part B flows PASS and personally signed off
- [ ] All acceptance sheets VERIFIED COMPLETE (only the owner sets this) *(seed: ANTI §6)*
- [ ] Open conflicts in `todos.md` resolved for shipped features
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

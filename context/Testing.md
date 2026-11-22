# Testing — Book Buddha
*Whole file ≤ 200 lines (S17-11), tables first. Owner-owned. Acceptance = Dhruv's hand-worked figures, not a passing technical test (DD §19). Go-live only when every row is PASS and he signs off Part B.*

## How to run the gates
From `book-buddha/`, never through a pipe, read the counts. Order matters: vitest does not type-check.
| Step | Command | Pass means |
|---|---|---|
| 1 | `.\node_modules\.bin\tsc.cmd --noEmit -p .` | exit 0, no output |
| 2 | `.\node_modules\.bin\vitest.cmd run --root .` (add `--exclude "src/probes/**" --exclude "**/node_modules/**"` if probes exist) | all green; read tests/files |
| 3 | `.\node_modules\.bin\vite.cmd build` | builds |
Rules: an **ACCEPTANCE** test going red = STOP and look, never edit its figures (October e2e labels only, S17-9). Fastify tests cannot use fake timers. Migration tests: build to v(n-1), insert raw rows, call the new apply function. Mutation-test key assertions; restore by byte comparison.

## Latest gates
| Date | tsc | Tests / files | vite | Note |
|---|---|---|---|---|
| 22 Nov (after F, v33) | 0 | **1,134 / 97** | 1.23 s | before-opening.test.ts 20 new (hand figure: opening Rs 10,000 + history invoice Rs 10,000 → receivables, statement, TB Rs 10,000 once); 4 test files adjusted to S17-12 |
| 22 Nov (after quotation-edit gap) | 0 | 1,114 / 96 | 1.19 s | 1 new test in sales-defects.test.ts (S17-4 block) |
| 22 Nov (after S17-10) | 0 | 1,113 / 96 | 1.17 s | bill-discount-refusal.test.ts 13 new; bill-discount.test.ts 7 changed to the S17-10 rule |
| 22 Nov (after C, D, H, E, v30–v32) | 0 | 1,100 / 95 | 1.36 s | latest measured; October e2e 22/22; R10 2,000-invoice 6.4 s; cash-basis fuzz 11.1 s under load (watch) |
| 22 Nov (after A + B) | 0 | 1,068 / 93 | 1.46 s | migration v29 then |
| 22 Nov baseline | 0 | 1,060 / 93 | 1.54 s | before any session-17 change |
Latest row = state at session 17 close (commit 451f9ab). Wall-clock tests to pin in G: `purchase-returns.test.ts` (`PR-001/26-27`), `server.test.ts` number regexes.

## Gate history
| When | Tests / files | vite | What changed |
|---|---|---|---|
| S15 contract 1 | 856 / 64 | — | R12 set-one shared contract |
| S15 set one done | 919 / 76 | 1.18 s | 12a–12d wired |
| S15 contract 2 | 924 / 77 | — | statement-lines contract (v28) |
| S15 set two done | 974 / 85 | 1.65 s | 12e–12g wired, cancel guard |
| S16 H+I (21 Nov) | 1,012 / 87 | — | October e2e + 15 known-defect cases |
| S16 G1+G2 / G3 | 1,030 / — · 1,044 / — | — | defects D1–D15 fixed in groups |
| S16 final (21 Nov) | 1,059 / 93 | 1.02 s | all 16 defects fixed |
| 21 Nov after S16-9 | 1,060 / 93 | 1.05 s | taken-number refusal |

## Acceptance by slice
| Slice | Status | What was checked |
|---|---|---|
| R1, R2, R4, R4b, R5, R7, R8, §13 reports, S10-4, R9–R12 | closed (S16-10) | accepted by Dhruv |
| R3, R4c | hand-verified | his figures |
| 7d, 8c (cash-basis invoice, bill, P&L) | on trust | in gate |
| October 2025 e2e (S16-5) | **ACCEPTANCE green**, incl. cash basis | `src/e2e/october.e2e.test.ts`, 22 tests, figures approved |
| R12 set one (HDFC October) | ACCEPTANCE | `src/banking/r12-set-one.e2e.test.ts` |
| R12 set two (import → match → add → reconcile) | ACCEPTANCE | `src/banking/r12-set-two.e2e.test.ts` |
| R13 cash flow | built, review pending | worked by hand by orchestrator (below); not yet signed by Dhruv |
**No acceptance backlog** for closed slices. Sheets for new work: `testing/Acceptance - <slice> (<date>).md`.

## Hand-worked figures (these must never move)
| Test | Figures |
|---|---|
| R12 reconciliation (HDFC October) | opening 50,000; +12,000, +23,600, −18,000, −1,180, +5,900 → book 72,320; statement 84,066; cleared 84,420, difference −354 (finish refused); post −354 → 0, finish; book 71,966 = 84,066 − 18,000 + 5,900; November beginning 84,066 |
| Register running balance | 50,000 / 62,000 / 85,600 / 67,600 / 66,420 / 72,320; from 10 Oct opening 85,600 |
| October cash-basis P&L | 30,600 / 15,550 / 11,750 and 0 / 11,800 (pass unchanged after G4) |
| October cash flow (R13, 1–31 Oct) | customers +36,860 (in 42,860, out 6,000) · suppliers −22,450 (in 1,500, out 23,950) · expenses −3,894 · net 10,516 · cash 70,000 → 80,516 (HDFC 71,966 + Cash 8,550); tie ok |
| Bill discount (H) | 7 × 100 less 150 → lots 6 @ 78.57 + 1 @ 78.58, INVENTORY Dr 550.00; return of 2 of 7 valued 157.14; 1,000 → 850 and 700 → 599.97 with PURCHASE_DISCOUNT 0; 1,000 paid 980 + 20 settlement → payables 0, Discount received 20 |
| Refund default (A) | credit invoice 6,000 CASH + 4,000 HDFC; refund with no account → 4,000 to HDFC, not CASH |
| Statement import (12e) | HDFC CSV 4 lines: +12,000, +23,600, −1,180, −354; in 35,600, out 1,534; re-import 0 added, 4 duplicates |

## Session 17 builder results (22 Nov, read by orchestrator)
| Builder | Tests added / changed | Moved figures | Gate |
|---|---|---|---|
| A (repository.ts) | new tests for refund account, kept money fields, zero-cost lock, PURCHASE refused; bare-PURCHASE set-ups moved to OPENING or a legacy row | one, set-up only: customers-items journal count 2→3, OBE credit 1010→1610 (OPENING posts) | with B: 1,068 / 93 |
| B (attachments, backup, imports) | audit events (attachment.uploaded/deleted, backup.restored), count-based repeated-payment import, `import.committed`, `GET /imports/last` HTTP test | none | with A: 1,068 / 93 |
| C (R13) | `src/database/cash-flow.ts` tests, 7 (orchestrator re-ran 7/7) incl. October world | none | not re-run in suite |
| D (imports/exports) | expenses import kind; 8 export datasets (P&L, BS, customer statement, customer balance detail, collections, stock ageing, inventory valuation detail, item profitability), HTTP test each | none | not re-run in suite |
| H (bill discount) | `bill-discount.test.ts` rewritten for the stock-cost rule | valuation 1,000→850; 700→599.97 (by ruling) | not re-run in suite |
| E (numbering) | running; October e2e labels only | labels only (S17-9) | — |
Note: a credit-note refund on a paid-at-once invoice is unreachable (the note settles at once), so A's default is proven on a credit invoice.

## Known defects, slow tests
| Item | Status |
|---|---|
| D1–D16 (audit read, `src/e2e/known-defects.test.ts`) | all 16 fixed; cases flipped to `FIXED Dn`; D10 mutation-proved by orchestrator, D9/D16 by builder |
| R10 2,000-invoice timing | was 6.5–7.4 s of 10 s (D11 number check scans every invoice); v32 index `idx_invoices_business_number` → 3.46 → 2.21 s (builder), flat per block |
| `engine.test.ts` fuzz | could time out under load; D: same seed and coverage, 2.95–5.3 s → ~0.13 s |
| Bare PURCHASE row posted nothing, FIFO consumed it | fixed by A (refused; use stock adjustment) |
| Attachment / restore not audited; zero-cost write-down skipped FY lock | fixed by B and A |
| Cancel guard: money on a bank line cannot be cancelled from its own screen | fixed S15, `cancel-guard.test.ts` (6), mutation-proved |
| Probes (`src/probes/`) | deleted 21 Nov (S16-10) |
| E's and G's route tests use a bare Fastify app, not `buildApi` | accepted; the two R12 e2e tests cover those routes |
| Mutation-proved | CANCELLED detection, entry-id match, cancel guard, dedupe (`held >= k`), pre-tick date, money parser, on-or-before-opening rule, preview rollback |

## Tests per slice (counts as built)
| Slice | Tests |
|---|---|
| R9 attachments | 8 HTTP + 24 engine |
| R10 import/export | 142 (codec 53, exports 20, engine+masters+routes 37, documents 21, e2e 11) |
| R11 backup | 16 + 7 |
| R12 | 112 new + 2 e2e (12a 15, 12b money-account suite, 12c 18, 12d, 12e 12, 12f 21, 12g 9) |
| S10-4 write-down | 15 |
| §13 reports | customers 15, profitability 14 |
| S16 defects | 16 + 48 new (supplier-defects 12, audit-actor 3, date-defaults 1, engine-tiny-tax 2, sales-defects 14, cash-view-defects 15) |
| R13 | 7 |

# Part A — Technical checks (open unless noted; most are covered inside the gate)
| Area | Must hold (source) | Status |
|---|---|---|
| Engine | Debits = credits; unbalanced save rejected; draft posts nothing, reserves stock (DD §4.1–4.2, §6.3) | open |
| Engine | Output vs input tax never mixed; per-line tax totals (DD §13.1 — Q24 per-line pending) | open |
| Engine | Rounding rule — **lock first** (whole-rupee DD §7.4 vs exact paise; Q23 round-off line pending) | open |
| Engine | FIFO cost, COGS across layers; restore on cancel/credit (DD §6.3) | open |
| Engine | Cash vs accrual; partial payments never over-recognise (DD §4.5) | open |
| Engine | Untracked item: cost at bill, revenue at invoice; challans post nothing unless linked (DD §6.4, §8.3, §11) | open |
| Engine | Credit note pool, refund, write-off, settlement over/under (DD §8.2, §9.5, §11.6) | open |
| Engine | Opening balances balance via OBE; cancel reverses exactly, number not reused; edit keeps prior version; FY lock (DD §4.4–4.7) | open |
| API | Invalid input rejected; client totals ignored; ONE transaction per financial op; ownership scope (ARCH §3, §8) | open |
| API | Numbering: number at first save, gap for deleted draft, no double-click duplicate, reset per FY (DD §7.2, §4.6) | open — E building |
| API | Payment immutable, no overpay; customer delete only with no records (DD §9.2, §5.9) | open |
| API | Import: failed row skipped and collected | PASS (import-engine.test.ts) |
| API | Endpoint contract / error envelope | TODO (not specified) |
| Integrity | ARCH §8 checklist: debits=credits, exact reversals, drafts don't post, no destructive edits, ownership, stock never negative, FIFO ties to movements, allocations ≤ balance, credit note ≤ source, locked periods, rollback, audit chain, reports tie to journals | open (13 items) |
| Data | Migrations ordered, `PRAGMA foreign_key_check`; integrity check at startup/backup/restore; backup round-trip; attachments outside SQLite | open (backup 16+7 pass) |
| Build | tsc, vitest, vite green; lint / audit policy (never `--force`) | gates above · lint TODO |
| Security | Password rules, 5-try lockout, 1 h idle sign-out, Google sign-in, secrets never readable or committed; hashing and Phase-2 matrix not specified | open |

# Part B — User-level / acceptance (Dhruv, by hand)
| Area | Flow or check | Status |
|---|---|---|
| Per slice | Acceptance sheet, 3–5 hand-worked scenarios: Foundation, customers/items, invoices/payments, credit notes, challans/subscriptions, fairs, reports | open (closed slices: see above) |
| End to end | First-run setup → invoice → payment · credit note + apply · cancel-with-reversal · quote → invoice (link both ways) · recurring · allocation + bulk mark paid · refund/return/write-off | open |
| End to end | Fair as Project (Save & New, incentive, fair P&L) · subscription settlement · customer merge · forgot password + timeout · FY lock | open |
| Reports | Trial Balance, P&L (both bases), Balance Sheet, GL tie to journals; report count conflict (8 vs 17, confirm 17) | open |
| Data in/out | CSV import preview + column map (built); .xlsx / PDF export (Q16, install); challan print; backup and restore for a non-engineer | open |
| Usability | Plain-English errors, form state survives network error, negative stock blocked with "Add stock" path | open |

# Part C — Go-live
All Part A rows PASS · all Part B flows PASS and signed off · every acceptance sheet VERIFIED (owner only) · open spec conflicts in decisions.md resolved for shipped features (rounding, tax placement, report count, archive, challan↔invoice).

## Acceptance-sheet template
```
# Acceptance - <slice> (<date>)
Scenario 1: <plain description>
  Inputs: <what you enter>
  Expected journals: Dr <acct> <amt> / Cr <acct> <amt> ...
  Expected stock effect: <item> <qty> ...
  App actual: <paste / screenshot figures>
  Result: PASS / FAIL  (owner initials)
```

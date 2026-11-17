# R4c Workings: opening stock and stock adjustments in the ledger — AWAITING YOUR SIGN-OFF

Every figure below was produced by **running the app itself**, not worked out by hand: scenario 1
over HTTP against the real API on a throwaway database, scenario 2 through the real compiled code
on a second throwaway database. The app stores money in paise; everything here is in rupees (Rs).
No GST is involved anywhere in this document.

Nothing here is asserted to be correct. Each scenario ends with **the specific numbers worth
checking against your own working**, and the document closes with **four decisions that are yours**.

---

## What changed, in one paragraph

Until now, when you entered **opening stock** or a **stock adjustment**, the app moved the stock and
posted **nothing** to the accounts. The stock reports showed the books; the ledger did not know they
existed. R4c closes that. Per your ruling (S5-3):

- **Opening stock** → `Dr Inventory / Cr Opening Balance Equity`. It was bought before the books
  began, so it is capital you put in, not a cost of this year.
- **A stock adjustment** (a recount) → `Dr Inventory / Cr Stock Adjustment`. It happened *this*
  year, so it belongs in this year's Profit & Loss.
- **A plain purchase movement still posts nothing**, deliberately: a real purchase posts its
  accounts on the **bill**, so posting here as well would count the same stock twice.

---

## Scenario 1: entering opening stock, a recount, and then a sale

### The story
You open the books on 1 April 2026 holding **40 atlases that cost Rs 250 each**. In August a
recount finds **5 more** (same cost). In September you **sell 10 at Rs 400** for cash.

### What happened
| Date | What happened | Quantity | Value |
|---|---|---|---|
| 1 Apr 2026 | Opening stock entered | 40 @ Rs 250 | Rs 10,000 |
| 15 Aug 2026 | Recount: stock found | 5 @ Rs 250 | Rs 1,250 |
| 20 Sep 2026 | Sold for cash, no GST | 10 @ Rs 400 | Rs 4,000 |

### What the app posted
| Date | Entry | Debit | Credit |
|---|---|---|---|
| 1 Apr 2026 | Opening stock | Inventory Rs 10,000 | Opening Balance Equity Rs 10,000 |
| 15 Aug 2026 | Stock adjustment | Inventory Rs 1,250 | Stock Adjustment Rs 1,250 |
| 20 Sep 2026 | Invoice INV-1 | Cash Rs 4,000 | Sales Rs 4,000 |
| 20 Sep 2026 | Cost of the sale | Cost of goods sold Rs 2,500 | Inventory Rs 2,500 |

### Trial balance, straight from the app
| Account | Debit | Credit |
|---|---|---|
| Cash | Rs 4,000 | — |
| Cost of goods sold | Rs 2,500 | — |
| Inventory | Rs 11,250 | Rs 2,500 |
| Opening Balance Equity | — | Rs 10,000 |
| Sales | — | Rs 4,000 |
| Stock Adjustment | — | Rs 1,250 |
| **Totals** | **Rs 17,750** | **Rs 17,750** |

### Profit & Loss (accrual), straight from the app
| Line | Amount |
|---|---|
| Sales | Rs 4,000 |
| Cost of goods sold | Rs 2,500 |
| Stock Adjustment | **minus Rs 1,250** |
| Total costs | Rs 1,250 |
| **Net profit** | **Rs 2,750** |

The recount is a **minus** in the costs because today a stock adjustment can only **add** stock
(see decision 4 below). Finding stock you did not know you had reduces this year's costs.

### Balance Sheet, straight from the app
| Side | Account | Amount |
|---|---|---|
| Assets | Cash | Rs 4,000 |
| Assets | Inventory | Rs 8,750 |
| **Total assets** | | **Rs 12,750** |
| Equity | Opening Balance Equity | Rs 10,000 |
| Equity | Retained earnings (this year's profit) | Rs 2,750 |
| **Total equity** | | **Rs 12,750** |

### The point of the whole slice: the tie-out
| Measure | Amount |
|---|---|
| Inventory **in the ledger** | Rs 8,750 |
| Stock **the app says you hold** (35 @ Rs 250) | Rs 8,750 |
| **Difference** | **Rs 0** |

Before R4c, the ledger would have shown Rs 2,500 **negative** inventory here and the stock report
Rs 8,750 — a Rs 11,250 hole with nothing to explain it.

### The cash-basis P&L is different, on purpose
| Line | Accrual | Cash |
|---|---|---|
| Sales | Rs 4,000 | Rs 4,000 |
| Cost of goods sold | Rs 2,500 | Rs 2,500 |
| Stock Adjustment | minus Rs 1,250 | **not shown** |
| **Net profit** | **Rs 2,750** | **Rs 1,500** |

A recount moves no money, so the cash-basis view does not recognise it. **This is decision 3 below.**

### ✅ Scenario 1 — the numbers to check
1. Opening stock of 40 @ Rs 250 credits **Opening Balance Equity Rs 10,000** (equity, not a cost).
2. The recount of 5 @ Rs 250 credits **Stock Adjustment Rs 1,250**, which **reduces** this year's
   costs, so accrual net profit is **Rs 2,750**, not Rs 1,500.
3. Inventory in the ledger is **Rs 8,750** and equals the stock report to the paise.
4. The trial balance totals **Rs 17,750** on both sides, and the balance sheet balances at
   **Rs 12,750**.
5. Cash-basis net profit is **Rs 1,500** — Rs 1,250 lower than accrual, because the recount is
   absent from it.

---

## Scenario 2: stock already entered, with no accounts behind it

### The story
**These figures are invented, and I have never seen your database.** What this scenario copies is
its *shape*: any opening stock or adjustment you entered before today posted nothing, so the same
gap exists in your books — in your own quantities, not these. I can run the **dry run** against
your real database and show you your actual numbers, read-only, whenever you say so.

Three movements, entered before R4c existed, so none of them posted anything:

| Date | Movement | Quantity | Value |
|---|---|---|---|
| 1 Apr 2025 | Opening stock (**last** financial year) | 40 @ Rs 250 | Rs 10,000 |
| 15 Aug 2026 | Recount | 5 @ Rs 250 | Rs 1,250 |
| 20 Aug 2026 | A plain **purchase** movement | 2 @ Rs 200 | Rs 400 |

Then 10 atlases were sold at Rs 400 on 20 September 2026, through the normal invoice path — so the
cost of that sale **was** posted, measured against stock the ledger knew nothing about.

### Where that leaves the books before anything is fixed
| Measure | Amount |
|---|---|
| Inventory in the ledger | **minus Rs 2,500** |
| Stock the app says you hold | Rs 9,150 |
| **Difference** | **Rs 11,650** |

### The dry run — what the fix would do, before it does anything
The backfill **reports first and writes nothing** unless you say so:

| Movement | Dated | Value | Would credit |
|---|---|---|---|
| Opening stock, 40 units | 1 Apr 2025 | Rs 10,000 | Opening Balance Equity |
| Recount, 5 units | 15 Aug 2026 | Rs 1,250 | Stock Adjustment |
| **Total to post** | | **Rs 11,250** | |
| Plain purchase movements **it will not touch** | | | **1** |

Each entry is dated the date of the movement itself, not today.

### With last year LOCKED
I locked 2025-26 and ran it. It **refused that year's entry and named it**, and posted the rest:

| Result | Detail |
|---|---|
| Posted | Rs 1,250 (the 15 Aug 2026 recount) |
| Refused | Rs 10,000, dated 1 Apr 2025 — *"The financial year covering 2025-04-01 is locked."* |

It does **not** force its way into a closed year, and it does **not** stop at the first refusal.
After reopening 2025-26 it posted the remaining Rs 10,000. **Run a third time, it posted nothing**
— running it twice is safe.

### Where the books end up
| Measure | Amount |
|---|---|
| Inventory in the ledger | Rs 8,750 |
| Stock the app says you hold | Rs 9,150 |
| **Difference** | **Rs 400** |

**That Rs 400 is the plain purchase movement**, and it is the honest remainder: stock that was
entered without a bill, so no bill ever posted it, and the backfill will not invent one. The app
**tells** you this (it reports "1 uncovered purchase movement") rather than letting you believe the
books tie when they do not. Fixing those Rs 400 means entering a purchase **bill**, which is your
call, not something the app should guess.

### ✅ Scenario 2 — the numbers to check
1. Before the fix, the ledger says inventory is **minus Rs 2,500** while you hold **Rs 9,150** of
   stock — out by **Rs 11,650**.
2. The dry run proposes exactly **Rs 11,250** in two entries, dated **1 Apr 2025** and
   **15 Aug 2026**, and writes nothing until told to.
3. With 2025-26 locked it posts **Rs 1,250** and refuses **Rs 10,000**, naming the locked year.
4. After the full run the ledger shows inventory **Rs 8,750**, leaving exactly **Rs 400** — the one
   purchase movement that has no bill behind it.
5. A second and third run post **nothing at all**.

---

## Four decisions that are yours

**1. Which business the stock belongs to.** Items belong to a *company*; a journal entry needs a
*business*. So opening stock now needs to know the business. **As built:** if the company has
exactly one business, the app uses it; with two or more it **refuses and names them** rather than
guessing. *Recommended: keep it.* The alternative — always typing the business — is safer in theory
but makes the common one-business case needlessly fiddly. One consequence, worth knowing: **you can
no longer enter opening stock before you have created a business.** The app says so in plain words.

**2. The date on a back-dated entry.** The journal entry carries the date you give it; the stock
*layer* is always added at the end of the queue. **Why:** the app values stock first-in-first-out.
If a back-dated layer jumped the queue, it would re-measure costs **already posted** on invoices
you have issued — silently changing last month's profit. *Recommended: keep it.* The cost is that
the stock-movement report shows such a movement in entry order rather than its back-dated position.

**3. Should a recount show on the cash-basis P&L?** Today it does not (scenario 1: accrual profit
Rs 2,750, cash Rs 1,500). *Recommendation: leave it out.* No money moved, so a cash-basis statement
has nothing to recognise. Say the word and the cash view can be extended to include it.

**4. Shrinkage, breakage — and a mistyped quantity — still cannot be entered or undone.** A
movement must be a **positive** quantity, so stock can only ever be adjusted **upward**; your own
examples (shrinkage, breakage) have no way in. Worse, I checked: there is **no way to reverse or
delete a stock movement at all** — the only public operations are "add" and "list". So a mistyped
opening quantity is now wrong in the stock **and** in equity, with no correction path. That sits
badly against cancel-with-reversal, which is one of this project's fixed rules, and R4c has made it
matter more than it did. It is **not** in R4c. *Recommendation: a small slice of its own* — a
negative adjustment and a reversal for a movement, posting `Dr Stock Adjustment / Cr Inventory`,
refusing to take out more than the FIFO layers hold, and refusing to touch a locked year.

---

## How this was proved, and what is not proved

**Proved.** The whole suite passes; type check and build clean. **16 tests are new** and cover this
slice, one of them driving the backfill **through its API route**. Five were **mutation-tested** —
the code was deliberately broken and the test watched to go red, then restored byte-identically:

| What was broken | What went red |
|---|---|
| Opening stock credits the expense account instead of equity | the acceptance test |
| The backfill's "already posted?" check removed | three backfill tests, including idempotency |
| The stock layer back-dated along with the entry | the first-in-first-out protection test |
| The movement and its entry no longer one transaction | the locked-year rollback test |
| The route writes even when `apply` is omitted | the API dry-run test |

Both scenarios above were then run **outside the test harness**: scenario 1 over HTTP against the
real API (signed in, real routes, throwaway database), scenario 2 through the real compiled code.

**Not proved.** The backfill has **never been run against your real database** and will not be
without your explicit say-so. Scenario 2's figures are **invented**, not read from your books. And
the figures throughout are mine, not yours: **until you check them, this slice is "built, figures
unconfirmed"** — the same standing as R1, R2, R4a, R4b and R5, of which only R3 is signed off.

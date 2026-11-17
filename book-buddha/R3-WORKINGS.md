# R3 Workings: the two sets of figures — APPROVED

> **APPROVED by the owner on 2026-11-17 (ruling S5-9).** Both scenarios were reviewed in full —
> event sequence, journal entries, monthly cash figures and the year-to-date reconciliation — and
> both sets of figures are accepted as stated. Two conditions came with the approval and are now
> part of the build: the remaining Rs 600 in scenario 1 must be recognised **when collected** (now
> a guarded step in the acceptance test), and the account-wide allocation policy must be documented
> explicitly as **not** line-by-line (below, and in the test itself). One wording correction he
> asked for is applied in scenario 2, step 3.

Every figure below was produced by running the app itself on the exact scenarios in the two tests, not worked out by hand. The app stores money in paise; everything here is converted to rupees (Rs). Neither scenario involves GST, so GST is Rs 0 throughout.

Nothing here is asserted to be correct. Each scenario ends with the specific numbers worth checking against your own working.

## The allocation policy, stated plainly (confirmed, S5-9)

The app does its cash-basis arithmetic **per account**, not per invoice line. All Sales move
together; all Cost of goods sold moves together. It does **not** remember that one rupee was goods
and another was freight.

So when an invoice has several lines and a payment arrives, **every income account moves by the
same fraction and every cost account moves by the same fraction**. There is no allocation of cash
between goods and freight, and none is implied by any figure in this document.

**This is deliberate policy, not an approximation to be fixed later.** It is why, in scenario 2,
January's cost is a single 14/15 of the whole cost account rather than a goods-only figure, and why
February shows no income row at all rather than a plus and a minus that cancel.

---

## Scenario 1: Applying a credit note to a later invoice

### The story
In January you invoiced a customer Rs 1,000 and they paid in full. In February Rs 400 of that came back (goods returned). Because nothing was owed, the Rs 400 became money owed *to* the customer, held as a credit. In March you invoiced the same customer Rs 1,000 again, and instead of refunding the Rs 400 you set it against the new invoice. The customer now owes Rs 600 on it.

### What happened
| Date | What happened | Amount |
|---|---|---|
| 10 Jan | Invoice A raised to the customer | Rs 1,000 |
| 20 Jan | Customer pays invoice A in full | Rs 1,000 |
| 10 Feb | Credit note for goods returned on A | Rs 400 |
| 1 Mar | Invoice B raised to the same customer | Rs 1,000 |
| 5 Mar | The Rs 400 credit is applied to invoice B | Rs 400 |

Credit note balance and amount owed at each step:

| After | Credit note: set against a bill (offset) | Credit note: owed back (refundable) | Credit already used | Credit still available | Invoice A owed | Invoice B owed |
|---|---|---|---|---|---|---|
| Invoice A | - | - | - | - | Rs 1,000 | - |
| A paid | - | - | - | - | Rs 0 | - |
| Credit note | Rs 0 | Rs 400 | Rs 0 | Rs 400 | Rs 0 | - |
| Invoice B | Rs 0 | Rs 400 | Rs 0 | Rs 400 | Rs 0 | Rs 1,000 |
| Credit applied | Rs 0 | Rs 400 | Rs 400 | Rs 0 | Rs 0 | Rs 600 |

The whole Rs 400 is "owed back" because invoice A was already fully paid, so there was nothing for it to come off.

### The journal entries posted
| Entry date | Event | Debit | Credit |
|---|---|---|---|
| 10 Jan | Invoice A | Receivables Rs 1,000 | Sales Rs 1,000 |
| 20 Jan | Payment on A | Cash Rs 1,000 | Receivables Rs 1,000 |
| 10 Feb | Credit note | Sales Rs 400 | Customer credits (a liability) Rs 400 |
| 1 Mar | Invoice B | Receivables Rs 1,000 | Sales Rs 1,000 |
| 5 Mar | Credit applied to B | Customer credits Rs 400 | Receivables Rs 400 |

The application is dated 5 March (the "applied on" date), even though the system recorded it on 1 March.

### The cash-basis walk
The cash view replays each invoice's events in date order and recognises income only when money (or credit used as money) moves.

**Invoice A**
1. **10 Jan, invoice.** Owed Rs 1,000. Nothing recognised yet; no money has moved.
2. **20 Jan, payment of Rs 1,000.** Owed before: Rs 1,000. Collected 1,000 of 1,000 owed = 1/1, so Sales Rs 1,000 x 1/1 = **Rs 1,000 income in January**. Owed after: Rs 0.
3. **10 Feb, credit note of Rs 400.** None of it comes off a bill (nothing is owed), so none of it is recognised. The invoice is already fully settled, so the app checks whether anything more needs catching up: Sales as they stand Rs 1,000 less already recognised Rs 1,000 = Rs 0. **Nothing is recognised in February.**
4. **5 Mar, credit applied.** The Rs 400 leaves the liability, which is the moment cash-basis recognises it: Sales Rs 400 x (400 used of 400 note) = **minus Rs 400 against invoice A in March**.

**Invoice B**
5. **1 Mar, invoice.** Owed Rs 1,000. Nothing recognised.
6. **5 Mar, Rs 400 credit used as payment.** Owed before: Rs 1,000. Settled 400 of 1,000 = 4/10, so Sales Rs 1,000 x 4/10 = **plus Rs 400 against invoice B in March**. Owed after: Rs 600.

The rows the app produced, in date order:

| Date | Invoice | Account | Amount |
|---|---|---|---|
| 20 Jan | A | Sales | Rs 1,000 |
| 5 Mar | A | Sales | minus Rs 400 |
| 5 Mar | B | Sales | Rs 400 |

### Month-by-month, cash basis
| Month | Income | GST | COGS |
|---|---|---|---|
| January | Rs 1,000 | Rs 0 | Rs 0 |
| February | Rs 0 | Rs 0 | Rs 0 |
| March | Rs 0 (minus 400 on A, plus 400 on B) | Rs 0 | Rs 0 |
| Year to date | Rs 1,000 | Rs 0 | Rs 0 |

### Convergence check
This scenario is deliberately left mid-way, so cash and accrual are **not** equal yet, and they should not be:

| | Income |
|---|---|
| Accrual: A Rs 1,000 less credit Rs 400, plus B Rs 1,000 | Rs 1,600 |
| Cash: A Rs 600 net, plus B Rs 400 | Rs 1,000 |
| Difference | Rs 600 |

The Rs 600 difference is exactly what invoice B still owes.

**This is now guarded, not just checked once.** On the owner's condition that "the remaining Rs 600
must be recognised when collected", the acceptance test was extended: the customer pays the last
Rs 600 on 10 April, April shows Rs 600 of income, cash year-to-date reaches Rs 1,600 and equals
accrual — and January and March still do not move.

### What was checked, and accepted
1. Should a Rs 400 credit that you never paid out in cash, only set against another bill, reduce income in the month it is *used* (March) rather than the month the goods came back (February)?
2. Does March showing "minus 400 on A, plus 400 on B, net nil" match how you would describe that month?
3. Is Rs 400 of B recognised as income on 5 March, when no cash arrived, only credit being used, what you expect?
4. Once B's last Rs 600 is paid, does cash income of Rs 1,600 match your own expected total?

---

## Scenario 2: A note that is part set-off, part refunded

### The story
You invoiced a customer Rs 15,000: goods Rs 10,000 (which cost you Rs 6,000) plus freight Rs 5,000 (no cost). They paid Rs 14,000 in January, leaving Rs 1,000 owed. In February you waived the freight in full, a Rs 5,000 credit note. Only Rs 1,000 was still owed, so Rs 1,000 comes off the bill and the other Rs 4,000 is owed back to the customer. You refunded Rs 1,500 in March and Rs 2,500 in April.

### What happened
| Date | What happened | Amount |
|---|---|---|
| 10 Jan | Invoice raised (goods Rs 10,000, freight Rs 5,000; goods cost Rs 6,000) | Rs 15,000 |
| 20 Jan | Customer pays part | Rs 14,000 |
| 10 Feb | Freight waived by credit note | Rs 5,000 |
| 5 Mar | First refund, paid from Cash | Rs 1,500 |
| 5 Apr | Second refund, paid from Bank | Rs 2,500 |

Credit note and amount owed at each step:

| After | Offset against the bill | Owed back to customer | Refunded so far | Still to refund | Invoice owed |
|---|---|---|---|---|---|
| Invoice | - | - | - | - | Rs 15,000 |
| Payment | - | - | - | - | Rs 1,000 |
| Credit note | Rs 1,000 | Rs 4,000 | Rs 0 | Rs 4,000 | Rs 0 |
| Refund 1 | Rs 1,000 | Rs 4,000 | Rs 1,500 | Rs 2,500 | Rs 0 |
| Refund 2 | Rs 1,000 | Rs 4,000 | Rs 4,000 | Rs 0 | Rs 0 |

### The journal entries posted
| Entry date | Event | Debit | Credit |
|---|---|---|---|
| 10 Jan | Invoice | Receivables Rs 15,000 | Sales Rs 15,000 |
| 10 Jan | Stock cost of the goods | Cost of goods sold Rs 6,000 | Inventory Rs 6,000 |
| 20 Jan | Payment | Cash Rs 14,000 | Receivables Rs 14,000 |
| 10 Feb | Credit note | Sales Rs 5,000 | Receivables Rs 1,000 and Customer credits (a liability) Rs 4,000 |
| 5 Mar | Refund 1 | Customer credits Rs 1,500 | Cash Rs 1,500 |
| 5 Apr | Refund 2 | Customer credits Rs 2,500 | Bank Rs 2,500 |

### The cash-basis walk
Owed on the invoice starts at Rs 15,000.

1. **10 Jan, invoice.** Nothing recognised; no money moved.
2. **20 Jan, payment of Rs 14,000.** Owed before: Rs 15,000. Collected 14,000 of 15,000 owed = 14/15 of each account.
   - Income: Rs 15,000 x 14/15 = **Rs 14,000**
   - Cost of goods sold: Rs 6,000 x 14/15 = **Rs 5,600**
   - Owed after: Rs 1,000.
3. **10 Feb, credit note of Rs 5,000.** Of this, Rs 1,000 equals what was still owed, so Rs 1,000 comes off the bill. The other Rs 4,000 is held back until refunded.
   - **Three figures are easily confused here, so take them separately.** The **revised invoice
     value** after the full Rs 5,000 note is **Rs 10,000** (15,000 less 5,000). That is the accrual
     figure, and it is what the invoice is now worth. It is *not* the figure this step uses.
   - The figure this step uses is the bill net of only the part of the note that **came off the
     bill**: Rs 15,000 less the Rs 1,000 that was actually set against the outstanding balance =
     **Rs 14,000**. The other Rs 4,000 is not a reduction of the bill at all — it is a liability
     owed back to the customer, and under S1-6 it is recognised when it is **refunded**, which is
     what March and April do below.
   - Already recognised in January: **Rs 14,000** — the same number again, but a different thing
     entirely (it is cash income, not an invoice value). Catch-up: Rs 14,000 - Rs 14,000 =
     **Rs 0 income**. The coincidence of the two Rs 14,000 figures is exactly why this step reads
     as "nothing happens" when in fact two separate things cancelled.
   - The bill is now fully settled (owed Rs 0), and no future payment will ever arrive to recognise the rest of the cost. So the app catches up the cost in this month: Cost of goods sold as it stands Rs 6,000 less already recognised Rs 5,600 = **Rs 400 expense**, with no cash moving.
4. **5 Mar, refund of Rs 1,500.** The refund is recognised in the month the money goes out. The note's Rs 1,000 offset has already been used, so the refund share is: Rs 5,000 x (1,500 of 5,000) = **minus Rs 1,500 income**.
5. **5 Apr, refund of Rs 2,500.** Rs 5,000 x (2,500 of 5,000) = **minus Rs 2,500 income**.

The rows the app produced, in date order (each cost row is matched by an equal opposite inventory row):

| Date | Account | Amount |
|---|---|---|
| 20 Jan | Sales | Rs 14,000 |
| 20 Jan | Cost of goods sold | Rs 5,600 |
| 10 Feb | Cost of goods sold | Rs 400 |
| 5 Mar | Sales | minus Rs 1,500 |
| 5 Apr | Sales | minus Rs 2,500 |

### Month-by-month, cash basis
| Month | Income | GST | COGS |
|---|---|---|---|
| January | Rs 14,000 | Rs 0 | Rs 5,600 |
| February | Rs 0 | Rs 0 | Rs 400 |
| March | minus Rs 1,500 | Rs 0 | Rs 0 |
| April | minus Rs 2,500 | Rs 0 | Rs 0 |
| Year to date | Rs 10,000 | Rs 0 | Rs 6,000 |

### Convergence check
| | Income | Cost of goods sold | Profit |
|---|---|---|---|
| Accrual: Rs 15,000 less Rs 5,000 credit note; goods cost | Rs 10,000 | Rs 6,000 | Rs 4,000 |
| Cash, year to date: 14,000 + 0 - 1,500 - 2,500 | Rs 10,000 | Rs 6,000 | Rs 4,000 |

Both agree. Cash actually kept: Rs 14,000 collected less Rs 4,000 refunded = Rs 10,000, which equals the income figure.

### What was checked, and accepted
1. Does **February showing an expense of Rs 400 with no cash moving** match your view? (This is the cost of goods the customer kept, brought forward because the bill is now fully settled and no later payment would recognise it.)
2. Does January's **14/15 split** (income Rs 14,000, cost Rs 5,600) match your own, given that Rs 14,000 of Rs 15,000 was collected?
3. Should the Rs 1,000 set-off against the bill in February show **no income change at all** in February? The offset simply brings the invoice's sales down from Rs 15,000 to Rs 14,000, which equals what January already recognised.
4. Are the refunds recognised as **minus Rs 1,500 in March and minus Rs 2,500 in April** (the month the money goes out) what you want, rather than all of the Rs 4,000 in February?

---

## Items I want to flag
- **The tests' comments speak of lines; the app works by account.** The test comments say income is "cancelled" and describe the "goods the customer kept" and "freight line". The app does not track goods and freight separately: it applies one fraction across Sales and another figure across cost. The totals agree with the comments in every case, but the mechanism is account-wide, not line by line. For example, in February the app shows **no income row at all** (nil), not a plus and a minus that cancel.
- **Scenario 1 is not a convergence test.** Cash (Rs 1,000) is below accrual (Rs 1,600) at the end of the test, correctly, because Rs 600 is still owed on invoice B. The convergence shown above needed one extra payment that the test does not make.
- Every figure the app produced matched the figure stated in the test's own assertions. No numbers differed.

## Where this lives (for reference)
Scenario 1 is the test "ACCEPTANCE apply (figures unconfirmed)" in `src/database/customer-credits.test.ts`. Scenario 2 is "divides the note pro rata and still converges on accrual" in `src/database/cash-view.test.ts`. The cash-view arithmetic is the `deriveCashView` method in `src/database/repository.ts`.

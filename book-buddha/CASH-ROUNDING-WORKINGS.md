# Cash Rounding Workings: the cash view ties to the cash that moved (ruling S11-22)

> **Status: for your review.** Every expected figure below was worked by hand from the rule
> "each line is recognised as its share of the cash, rounded to the nearest paisa", **not** read off
> the app. The "actual" column is what the app produced when the tests ran. All nine tests passed;
> every difference is **Rs 0.00**. Nothing here has been signed off by you yet.

Money in the app is whole paise (100 paise = Rs 1). Figures below are shown in rupees and paise.

---

## The idea, in one paragraph

When a customer pays part of an invoice, the cash view splits the payment across the lines (sales,
CGST, SGST) in proportion. Each line is rounded to the nearest paisa **on its own**, so the three
pieces can add to one paisa more or less than the cash actually received. Per your ruling, that
paisa is **shown** on its own line called **Rounding**, never hidden inside the biggest line. It is
one account that can be plus or minus. Once a document is paid in full every line is exact and the
Rounding line disappears.

**The test document:** an invoice (or bill) of Rs 118.00 = Rs 100.00 + CGST Rs 9.00 + SGST Rs 9.00.

---

## Test 1: Rs 50.00 collected on the Rs 118.00 invoice

**What it tested:** the customer pays Rs 50.00 of Rs 118.00. Does the Rounding line carry exactly
the missing paisa, and do the pieces add to the cash?

| Piece | Expected | Actual | Difference |
|---|---|---|---|
| Sales | Rs 42.37 | Rs 42.37 | Rs 0.00 |
| CGST | Rs 3.81 | Rs 3.81 | Rs 0.00 |
| SGST | Rs 3.81 | Rs 3.81 | Rs 0.00 |
| Rounding | +Rs 0.01 | +Rs 0.01 | Rs 0.00 |
| **Total vs cash received** | **Rs 50.00** | **Rs 50.00** | **Rs 0.00** |

The three shares alone add to Rs 49.99, one paisa short. Rounding adds that paisa back. The cash
Profit and Loss also shows gross sales Rs 50.00, GST Rs 7.62, income Rs 42.38 (sales plus the
Rounding paisa): expected and actual the same.

## Test 2: only 7 paise collected

**What it tested:** a tiny payment, where rounding goes the **other** way.

| Piece | Expected | Actual | Difference |
|---|---|---|---|
| Sales | Rs 0.06 | Rs 0.06 | Rs 0.00 |
| CGST | Rs 0.01 | Rs 0.01 | Rs 0.00 |
| SGST | Rs 0.01 | Rs 0.01 | Rs 0.00 |
| Rounding | -Rs 0.01 | -Rs 0.01 | Rs 0.00 |
| **Total vs cash received** | **Rs 0.07** | **Rs 0.07** | **Rs 0.00** |

The shares add to Rs 0.08, one paisa **over** the 7 paise collected, so Rounding is minus one paisa.

## Test 3: invoice collected in full

**What it tested:** a fully paid Rs 118.00 invoice must have **no** Rounding line at all.

| Item | Expected | Actual | Difference |
|---|---|---|---|
| Rounding lines | none | none | none |
| Sales / CGST / SGST | Rs 100.00 / Rs 9.00 / Rs 9.00 | Rs 100.00 / Rs 9.00 / Rs 9.00 | Rs 0.00 |

## Test 4: paid in two parts (Rs 50.00, then Rs 68.00)

**What it tested:** the two Rounding paise cancel out once the invoice is fully paid.

| Item | Expected | Actual | Difference |
|---|---|---|---|
| Rounding on the first payment (20 Jan) | +Rs 0.01 | +Rs 0.01 | Rs 0.00 |
| Rounding on the second payment (20 Feb) | -Rs 0.01 | -Rs 0.01 | Rs 0.00 |
| Rounding, whole invoice | Rs 0.00 | Rs 0.00 | Rs 0.00 |

Each Rounding line sits on the **same date** as the payment that caused it, so no reported month moves.

## Test 5: purchase bill of Rs 118.00, Rs 50.00 paid to the supplier

**What it tested:** the rounding also works for money going **out** (expense and input GST).

| Piece | Expected | Actual | Difference |
|---|---|---|---|
| Expense | Rs 42.37 | Rs 42.37 | Rs 0.00 |
| Input CGST | Rs 3.81 | Rs 3.81 | Rs 0.00 |
| Input SGST | Rs 3.81 | Rs 3.81 | Rs 0.00 |
| Rounding | -Rs 0.01 | -Rs 0.01 | Rs 0.00 |
| **Expense + GST + one extra paisa of expense, vs cash paid out** | **Rs 50.00** | **Rs 50.00** | **Rs 0.00** |

The shares are Rs 49.99, a paisa under what was paid. The missing paisa shows as Rounding **minus**
one paisa, which is a paisa of cost. It is the same single account, just signed the other way.

## Test 6: expense of Rs 118.00, only 7 paise paid

| Piece | Expected | Actual | Difference |
|---|---|---|---|
| Expense | Rs 0.06 | Rs 0.06 | Rs 0.00 |
| Input CGST | Rs 0.01 | Rs 0.01 | Rs 0.00 |
| Input SGST | Rs 0.01 | Rs 0.01 | Rs 0.00 |
| Rounding | +Rs 0.01 | +Rs 0.01 | Rs 0.00 |
| **Total paid out** | **Rs 0.07** | **Rs 0.07** | **Rs 0.00** |

## Test 7: bill paid in full

| Item | Expected | Actual | Difference |
|---|---|---|---|
| Rounding lines | none | none | none |

## Test 8: the safety check, in isolation

**What it tested:** rounding can never be wrong by more than about one paisa per line. A bigger gap
is **not** rounding, it means the books are broken, so the app refuses and says so. Example: 3 lines,
Rs 50.00 received but only Rs 49.96 recognised, a gap of 4 paise against a limit of 3.

| Item | Expected | Actual | Difference |
|---|---|---|---|
| Gap of 4 paise on 3 lines | refused | refused | none |
| Message | names the document (INV-9), Rs 50.00 moved, Rs 49.96 recognised, gap 4 paise, limit 3 paise | same | none |
| Gap of exactly 3 paise, either direction | accepted | accepted | none |

The check is made **per payment on one document**, never on a report total, because a report adding
up many documents legitimately collects many small paise.

## Test 9: the safety check, on a real corrupted ledger

**What it tested:** a Rs 118.00 invoice with Rs 50.00 collected, then one posted sales line is
deliberately made Rs 40.00 too large. The cash view must **refuse to report**, rather than quietly
hide the gap in Rounding.

| Item | Expected | Actual | Difference |
|---|---|---|---|
| Result | refused, naming INV-1 and Rs 50.00 moved | refused, naming INV-1 and Rs 50.00 moved | none |

---

## Not covered, by design

- **Opening customer balances.** They recognise only the income part (X) of a balance (Y) as cash
  arrives, so their shares are *meant* to be smaller than the cash. A Rounding line there would be
  wrong. They already finish exactly at the full income amount.
- **The accrual view.** An unbalanced entry is already refused when posted, so it has no gap.

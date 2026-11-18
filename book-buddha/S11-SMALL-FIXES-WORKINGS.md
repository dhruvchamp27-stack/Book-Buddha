# Session 11 small fixes — what was tested, and what came out

This is the plain-English report you asked for in item 18. It covers the four small items your
answers to the nineteen questions created. Item 4 has its own, longer report — see
`CASH-ROUNDING-WORKINGS.md` in this same folder — so it is only summarised here.

Everything below is a figure I worked out by hand from the accounting first, and only then checked
against the app. That order matters: a figure read off the app and then "tested" only proves the
app agrees with itself.

**All three gates passed: 590 tests across 47 files, the type-checker clean, the build clean.**
**No test you have personally signed off was changed.**

---

## Item 1 — a report for a fair that does not exist

**Your answer (S11-9):** *"Return a clear error explaining that the selected fair does not exist.
Do not generate an empty report that could be mistaken for zero sales."*

**What was wrong.** Asking for a report on a fair that is not in the system returned a perfectly
normal, perfectly empty report. On screen that is indistinguishable from a real fair that sold
nothing. A typo in a fair name could therefore read as "this fair made no sales".

**What I set up to test it.** One small set of books: 20 copies of a book bought at Rs 40 each,
then Invoice A sells 4 of them at Rs 100 each to Fair A (Rs 400), Invoice B sells 2 to Fair B
(Rs 200), and a credit note takes one book back off Invoice A (Rs 100).

**What was tested — 43 tests.** There are 14 different places in the app that can produce a report
by fair. Rather than test one and assume, each of the 14 was tested three ways:

| Check | Expected | Actual | Difference |
|---|---|---|---|
| A fair that does not exist | A clear error naming the fair | A clear error naming the fair | None |
| A fair that does exist | Its real figures, unchanged | Its real figures, unchanged | None |
| No fair named at all | A consolidated report across all fairs | A consolidated report | None |
| A fair named as blank text | Refused as an error | Refused as an error | None |
| A real fair with no activity | A genuinely empty report, no error | A genuinely empty report | None |

That last row is the one that matters most: an empty report is still correct when the fair is real
and simply had no sales. The fix distinguishes "I do not know this fair" from "this fair sold
nothing", which is exactly the distinction your answer asked for.

**One thing I caught on review and sent back.** Two of the "a fair that does exist" checks had
originally been written to assert that the result was *empty*. That test would have passed even if
the fair filter were broken, ignored, or reversed — it asserted nothing. They were rewritten to
assert real figures: Rs 400 invoiced, Rs 100 credited, **Rs 300 net sales**, and the same Rs 300
appearing as income on the profit and loss and as a sales credit on the trial balance.

---

## Item 2 — the general ledger date

**Your answer (S11-10):** *"Display the actual transaction date entered by the user. Maintain the
posting/creation timestamp separately for audit purposes."*

**No work was needed, and nothing was built.** The ledger already did exactly this: each row
carries the transaction date you typed *and*, separately, the timestamp it was posted, and the
ledger is ordered by the date you typed. This was a real defect once and it was fixed earlier, in
the R7b slice. I checked rather than assumed, and I have recorded it in `HOT.md` so no future
session rebuilds something that already works.

**Expected: already correct. Actual: already correct. Difference: none.**

---

## Item 3 — a credit note gets its own date

**Your answer (S11-4):** *"Maintain a separate transaction date and creation/finalisation
timestamp. Allow the transaction date to be specified independently."*

This one collided with a ruling you had already given, so it needed two decisions from you before
it could be built. You gave both: an undated note posts on the day it is **finalised** (S11-20),
and back-dating into a month already reported is **allowed but warned about** (S11-21).

**What was tested — 10 tests.**

| What was tested | Expected | Actual | Difference |
|---|---|---|---|
| A note given a date | Posts on that date, not today | Posts on that date | None |
| A note given **no** date | Stays blank, posts the day it is finalised | Blank, posts at finalise | None |
| A nonsense date | Refused, in plain words | Refused, in plain words | None |
| A date inside a **locked** financial year | Refused, naming the year | Refused, naming the year | None |
| Drafted in January, finalised in February, dated January | Lands in **January**; February untouched | Lands in January | None |
| A date in an earlier month, no confirmation | Refused, naming the date and the month whose figures move | Refused, as described | None |
| The same, with confirmation given | Posts | Posts | None |
| A date this month or in the future | No confirmation needed | No confirmation needed | None |
| Existing notes, when the upgrade runs | Keep the date they already posted on | Keep that date | None |
| An existing draft with no date | Stays blank, not back-filled with a guess | Stays blank | None |

**The most important result is a negative one.** The test that pins your own signed figures —
`ACCEPTANCE S4-8`, the one proving a reported month cannot move — **still passes with not one
figure changed.** Only its title and a comment were updated, to say it now describes the default
behaviour rather than the only behaviour. Nothing you have signed off moved.

**The refusal message, in full, as you would see it:**

> This credit note is dated 20 January 2026, in a month that has already passed. Posting it will
> change the figures already reported for January 2026. If that is what you want, confirm and
> finalize it again.

**One guarantee worth stating plainly:** the confirmation can get you into an earlier *month*, but
it can **never** get you into a locked financial *year*. That is tested directly — confirmation and
all, a locked year still refuses.

---

## Item 4 — the one-paise gap

**Your answer (S11-11), and the decision it needed (S11-22).** Your words were *"adjust
automatically through a designated rounding account… ensuring the final transaction balances
exactly. Never silently ignore discrepancies."*

There was no transaction to balance. The posted books are already exact to the paise — the engine
refuses an entry that does not balance. The gap exists only in the **cash-basis** profit and loss,
which is worked out fresh each time you ask for it. So the adjustment had to go in the report, and
you chose to have it shown rather than absorbed.

**Your figure, proven:** a Rs 118 invoice part-paid Rs 50 now reads

| | |
|---|---|
| Sales | Rs 42.37 |
| Output CGST | Rs 3.81 |
| Output SGST | Rs 3.81 |
| **Rounding** | **Rs 0.01** |
| **Total** | **Rs 50.00** — exactly the cash received |

**9 tests**, including the gap going the *other* way (it can over-recognise as well as under-),
a fully collected invoice showing **no** rounding line at all, the same behaviour on purchase bills
and expenses, and a safety check that **refuses** rather than absorbs if a gap is ever too large to
be explained by rounding. Full details, test by test, are in `CASH-ROUNDING-WORKINGS.md`.

---

## What is NOT covered, and you should know it

- **None of this has ever run against real books.** There is no real database anywhere in the
  project — I verified that, not assumed it. Every figure above comes from a throwaway test
  database built for the purpose and discarded.
- **Item 4's behaviour on a purchase return is untested, because it is unchanged.** A purchase
  return can still be back-dated with **no warning at all**, unlike a credit note now. That is an
  inconsistency your answers created and I have not acted on it, because you were asked about
  credit notes. It needs either the same guard or a stated reason, and it is on the list for you.
- **Item 5 (income account per item) was not built and was not meant to be** — it is its own slice
  later. One consequence is already known and recorded: a credit note currently credits back a
  single fixed sales account, which becomes wrong the moment different products use different
  income accounts.

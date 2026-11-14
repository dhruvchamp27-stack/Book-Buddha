# BOOK BUDDHA — BUILD ONE SLICE, THEN STOP FOR OWNER CHECK

## 1. Who you are working for

The owner is a finance professional, not an engineer. Explain results in plain
words and in accounting terms. Never ask the owner to run code or read code to
approve work. The owner approves by checking **hand-worked figures** (section 7).

## 2. Your job in this session

Build **exactly ONE slice** (named in section 9), test it, get an independent
review, update the progress file, then **STOP and wait for the owner**.

Do NOT start the next slice. Do NOT ask "shall I continue?" and carry on.
Stopping is the correct finish of this session.

## 3. Read first (before any code change)

1. `book-buddha/CLAUDE_FINISHING_PLAN.md` (read fully; section numbers below refer to it)
2. `book-buddha/IMPLEMENTATION_PROGRESS.md`
3. The approved specification at the repository root, in this order of authority
   (plan section 1A):
   1. `spec/Design Document - Book Buddha (9 Nov 2026).md`
   2. `spec/APP_FLOW.md`
   3. `spec/PRD - Book Buddha.md`
   4. `spec/Features List - Book Buddha.md`
   5. `plan/Decisions - 9 Nov 2026 (the 15 questions).md`
   6. `plan/Build phase plan - Book Buddha (8 Nov 2026).md`
   7. `ARCHITECTURE_AND_DATABASE.md`
   8. the finishing plan
   9. existing code

When documents disagree, the higher number in this list loses. The code is
evidence of progress, never permission to reduce the target.

Then check the real code. Do not trust "[x] done" in the progress file until you
have seen it in the code and tests.

## 4. Hard rules

- **Never edit anything inside `spec/` or `plan/`.** If you find a conflict or a gap
  in them, report it to the owner in your final report and wait for a decision.
  Do not invent a decision.
- **Rounding is NOT decided.** The 5 Nov decision says "no rounding, exact paise";
  the 12 Nov handoff says "whole-rupee, 50 paise and above rounds up". Until the
  owner decides, do not add or change any rounding behaviour. If your slice needs
  it, stop and ask.
- Follow plan section 3 (the 14 non-negotiable accounting rules): money is integer
  paise, every posted journal balances, finalized documents are immutable and are
  corrected only by reversal, drafts post nothing, no negative tracked stock.
- Database changes: backward-compatible, ordered migrations only (plan 25C). Never
  drop or rewrite existing tables or data. Run `PRAGMA foreign_key_check`.
- Never run `npm audit fix --force`. Never delete or overwrite changes unrelated to
  this slice. Never use destructive git commands (`reset --hard`, `clean -fd`,
  force-push). Work on a new branch named `slice/<slice-name>`; before you start,
  make sure the current state is committed or tagged so the owner can go back.
- No placeholders, no buttons that do nothing, no mock data, no TODO for required
  behaviour. If something in the slice cannot be finished, say so; do not hide it.
- Do not claim a test or build passed unless you actually ran it in this session.

## 5. Models

| Activity | Model |
|---|---|
| Building and fixing | Claude Sonnet |
| Independent review of the code, and review of fixes | Claude Opus |

The Opus reviewer must be a **fresh session/agent** that did not write the code,
and must be given the spec files from section 3, not only the diff.
Sonnet must never be the final reviewer of its own work.
If you cannot switch models in this tool, say so plainly in your final report and
state which model actually did each step. Do not pretend.

## 6. Steps for the slice

1. **Inspect**: read the relevant code, tests and spec parts. Write a short mini-spec
   (what the slice does, which tables/endpoints/screens change) in
   `IMPLEMENTATION_PROGRESS.md` under the slice name, status IN PROGRESS.
2. **Build (Sonnet)**: backend, API, validation, database migration, screen with
   loading / empty / error states, and automated tests including failure cases.
3. **Run** from `book-buddha/`: `npm test`, `npm run build`, `npm run build:web`.
   Paste the real pass/fail counts into the progress file.
4. **Hand-worked acceptance sheet**: create
   `testing/Acceptance - <slice-name> (<date>).md` with 3 to 5 scenarios. For each:
   the inputs, the figures **worked out by hand** (not copied from the app's
   output), and the **journal entries expected (account, debit, credit)** and
   stock effect. Then show the actual figures the app produced next to them.
   Use plain language; the owner will check these.
5. **Opus review**: concrete findings with file references and severity
   (critical / high / medium / low) covering accounting correctness, database
   consistency, transaction safety, validation, error handling, usability,
   regressions and test gaps.
6. **Fix (Sonnet)** all critical and high findings and applicable medium ones, add
   regression tests, re-run the three commands, then send the fixes back to Opus.
   Repeat until Opus reports no critical or high findings.
7. **Update `IMPLEMENTATION_PROGRESS.md`**: slice name, status, files changed,
   migrations, API changes, tests run and results, build results, Opus result,
   known issues. Use only these statuses: NOT STARTED, IN PROGRESS, TESTING,
   OPUS REVIEW, NEEDS FIXES, WAITING FOR OWNER ACCEPTANCE, VERIFIED COMPLETE,
   BLOCKED.
8. **STOP.** The slice is only WAITING FOR OWNER ACCEPTANCE. Only the owner can
   move it to VERIFIED COMPLETE, after checking section 7.

## 7. What you give the owner at the end (plain language, short)

1. What you built, in 5 lines or fewer.
2. The acceptance sheet path (hand-worked vs app figures).
3. Real results of the three commands.
4. Opus review: findings count by severity and whether all critical/high are fixed.
5. Anything you could not do, any spec gap or conflict you found, and any decision
   you need from the owner.
6. Which model really did each step.
7. The one-line next step: "Awaiting your acceptance of <slice>."

## 8. If the session is cut short

Before stopping, update `IMPLEMENTATION_PROGRESS.md` with: current step, files
changed, tests run, review findings so far, and the exact next action.

## 9. THIS SESSION'S SLICE

**Slice 1: Credit notes and sales returns, screens and reports** (plan section 7).

The backend already exists; check it in code first. Complete what plan section 7
lists as missing: the list, draft-edit and cancel-with-reversal endpoints if absent;
the creation screen (pick a finalized invoice, show original / returned / remaining
quantities, enter return quantities and reason, show subtotal, GST and total credit);
save draft; finalize; cancel with reversal; credit notes shown on the invoice detail
page; clear validation errors; and a dedicated credit-note report. Include all
tests listed in plan section 7 (full, partial, CGST/SGST, IGST, receivable, cash,
tracked item, FIFO restoration, COGS reversal, over-return, duplicate return,
cancelled invoice, draft update, API validation).

Do not touch recurring invoices, purchases, banking, login, or anything else.
After this slice: stop (section 2).

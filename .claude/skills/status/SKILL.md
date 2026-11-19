---
name: status
description: "Plain-English status of the whole build — what is DONE, what is PENDING, and what is waiting on a decision, as a table with clear counts. Every line is measured off the code at the moment you ask, never recited from a file or from memory. Use when the user says 'status', 'where are we', 'how much is left', 'what's pending', 'how much is done', 'give me a status', 'progress', '/status'. For a short start-of-session orientation use /session-start instead; this is the fuller 'how much is left overall' picture."
---

# /status — Where the work stands, in plain English

## Who is reading this

Dhruv. A finance professional, **not an engineer**. He wants to know *how much is
done, how much is left, and what is waiting on him* — in the words he'd use
himself. No file names in the table, no jargon, no commit hashes in the headline.

## THE ONE RULE

> **Never report a status you have not just measured.**
>
> Do not recite status from `HOT.md`, from `IMPLEMENTATION_PROGRESS.md`, from a
> previous reply, or from memory. Those tell you what *was* true when someone
> last wrote them down. Go and look at the code.

This rule exists because it has already gone wrong: a hand-written status file
said four reports were unbuilt when they had been built and committed the day
before. **A status nobody verifies turns into fiction.** HOT and the progress file
are useful for *why* and *what's next* — never for *what exists*.

### The distinction that keeps catching people out

**Built is not the same as reachable, and reachable is not the same as accepted.**
Report these as three separate things, never merge them:

| Stage | What it means | How you check it |
|---|---|---|
| Built | the logic exists and has tests | the module file exists |
| Reachable | the app can actually be asked for it | it has an HTTP route |
| Accepted | the figures match his hand-worked ones | `ACCEPTANCE` tests / his sign-off |

A thing that is built but has no route is **not** finished — nothing can call it.
Say so explicitly; do not round it up to "done".

---

## Step 1 — Measure (read-only, nothing is changed)

Run these from the project root. They are all read-only. Never touch a database.

```bash
# What is committed, and where we are
git log --oneline -8
git status --porcelain
git log --oneline @{u}..HEAD | wc -l      # unpushed; "no upstream" is fine

# Which engines exist
ls book-buddha/src/database/reports-*.ts
ls book-buddha/src/database/ | grep -Ei 'import|export|backup|bank|cash-flow'

# Which of them the app can actually reach
grep -o '"/reports/[a-z-]*"' book-buddha/src/api/server.ts | sort -u
grep -cE 'app\.(get|post|delete|put|patch)' book-buddha/src/api/attachment-routes.ts

# Database version actually registered
grep -o 'version: [0-9]*' book-buddha/src/database/migrations.ts | sort -t' ' -k2 -n | tail -1

# How much of the screen side exists
find book-buddha/web/src -name '*.tsx' -o -name '*.ts' | xargs wc -l | tail -1
```

Add probes as the project grows. **Each row you print must have a probe behind
it.** If you cannot measure something, say "I could not check this" — never guess.

## Step 2 — The gates

Report the three gates, and be honest about whether you re-ran them:

- Default: quote the last recorded run from `HOT.md` and **label it plainly**
  as recorded-not-re-run, with its date.
- If he asks for status "with tests", or anything is about to be called finished,
  actually run them, from `book-buddha/`, in this order, **never through a pipe**:
  `tsc.cmd` → `vitest.cmd run --root .` → `vite.cmd build`. **Read the real
  count. Never assume it.** Tests take about a minute — say so before starting.

Then add this line, because he is an accountant and the distinction is his:

> A passing test means the code does what the code says. It does **not** mean the
> figures agree with yours — that is acceptance, and it is tracked separately.

## Step 3 — The output

Always in this order. Keep it tight; he should get the answer in the first table.

### A. The headline — one sentence
> "Of the N areas of work: X finished, Y part done, Z blocked on you, W not started."

### B. The table
Four columns, nothing wider than a terminal, **plain English in every cell**:

| # | What it is | State | What is left |
|---|---|---|---|
| 1 | The missing reports | PART DONE | 4 of 6 cannot be reached yet |

States, and only these: `DONE` · `PART DONE` · `BLOCKED` · `NOT STARTED`.
"What is left" is the shortest true phrase — a count if there are several.

### C. The detail — one short block per area
What is done, what is left, and for anything BLOCKED, **what you need from him**.
Mark anything that can be picked up immediately with `>> can start now`.

### D. Acceptance — kept separate from tests
Which slices he has hand-checked, which were taken on trust, which are still
outstanding, and whether acceptance is currently parked by his standing order.

### E. Questions waiting on you
Blocking ones first, each one a single decision stated in his terms, with enough
context to answer without opening a file. Then the non-blocking ones.

### F. Anything that did not add up
If a probe disagreed with what `HOT.md` or the progress file claims — **say so
here, loudly, with both sides.** This section is the point of the skill. If
everything agreed, say "everything I checked matched what is written down".

## Step 4 — Query where doubt persists

If the measurements leave a genuine question — something that could be read two
ways, or a gap that only he can settle — **ask it at the end, briefly**. One or
two questions, not a quiz. If nothing is genuinely in doubt, ask nothing; do not
manufacture a question to look thorough.

---

## Hard limits

- **Read-only.** Never write, commit, delete or migrate while running status.
- **Never open the real database.** There isn't one yet, and his file may live
  outside this repo.
- Do not let the whole thing sprawl. If an area needs a deep dive, say so and
  offer it — don't dump it into the status.

---
name: session-end
description: "Close out a work session cleanly by saving its state into the context files, so a fresh session can pick up with nothing lost. Updates HOT (current status, blockers, next step), overwrites the one-line 'Last session' summary at the top, refreshes the Progress.md summary and working area, and updates any allied file that actually changed. Use when the user says 'wrap up', 'close the session', 'end of session', 'save state', 'close out', 'done for today', 'end session', '/session-end'. Writes NO fat handoff note — the context files ARE the handoff."
---

# /session-end — Save state, lean and pure

## What this skill is

The lean replacement for the old `/handoff` flow. Instead of writing a long handoff note every session, it folds what the session learned back into the context files — so the *next* session can pick up from them alone. The context files ARE the handoff now.

## Step 0 — Find the right context folder (works in BOTH layouts)

Two folder layouts are supported. Resolve `<CONTEXT>` **before** writing anything —
writing to the wrong folder is how a session's state gets lost.

- **Root layout** (this harness) — `context/HOT.md` sits in the project root.
- **Per-automation layout** (e.g. `Desktop\Res1`) — the root holds several
  automation subfolders, and **each one has its own**
  `<subfolder>/context/HOT.md`. There is no root-level context folder.

Resolution order — stop at the first that matches:

1. `context/HOT.md` exists in the project root → **root layout**.
   `<CONTEXT>` = `context/`.
2. Otherwise run **one** `Glob` for `*/context/HOT.md` (one level down only):
   - **Exactly one match** → `<CONTEXT>` = that subfolder's `context/`.
   - **Several matches** → use the automation this session actually worked in (the
     one whose files you read or edited). If that's genuinely unclear, **ASK**,
     listing the subfolder names. Never guess.
3. **No match** → ask before creating anything. Do not create a root-level
   `context/` folder in a per-automation project — that splits the state in two.

Everywhere below, `<CONTEXT>/` means the folder resolved here. Update **only** that
automation's files; never touch a sibling automation's context.

## The one rule that keeps things lean

> ⚠️ **TOUCH ONLY WHAT CHANGED.**
> Always update `<CONTEXT>/HOT.md` and `<CONTEXT>/Progress.md`. Update an allied file
> (`decisions.md`, `architecture.md`, `database.md`, `Testing.md`, and so on)
> **only if this session actually changed something it covers** — a task completed,
> a new decision made, a piece of wiring changed. Do **not** open or rewrite an
> allied file that didn't change. Reading files you don't need to touch just burns
> context for no reason.
>
> ⚠️ **NO NEW FILES IN `<CONTEXT>/`.** The folder is closed. Briefs go into
> `Progress.md` → "Active briefs"; definitions into `Progress.md` → "Definitions".
> Never create a `BRIEF_*` file, a handoff, or any other new file there without
> Dhruv's approval.

## What to do

1. **Update `<CONTEXT>/HOT.md`** — the always-loaded live status. Refresh:
   - **Active now** — what's true right now.
   - **Broken / blocked** — anything not working or waiting on the team.
   - The immediate **next step**.
   - Keep it tight — **every** HOT.md must stay **under 50 lines** (hard rule
     in CLAUDE.md; it applies per file, so each automation's copy has its own budget).
     Move finished items *out* to the allied files or delete them — HOT is
     working memory, not a log.

2. **Overwrite the `## Last session` line** at the top of HOT — a single
   sentence: date + what this session did. **Overwrite it, don't append.** This
   one line is what `/session-start` reads back as "what changed since last
   session," and what a future notification hook will message out.

3. **Update `<CONTEXT>/Progress.md`** — it has two parts, split by the
   `<!-- END OF SUMMARY ... -->` marker:
   - **Summary (above the marker, under 50 lines in total):**
     - Rewrite **Start here next session** (the first step, in plain words).
     - Update the **Development — by slice** table for any slice this session touched.
     - Refresh **Testing** (the last recorded gate results, with the date).
     - Refresh **Known Issues**.
     - Add this session to **Last 3 sessions** and drop the oldest, so only 3 remain.
   - **Working area (below the marker):**
     - Move finished briefs from **Active briefs** to **History — closed briefs**
       as 2–4 line entries (what it was, outcome, date).
     - Update **Open to-dos and questions** (add new items, close done ones).
     - Add to **Definitions** or **Rules and lessons carried forward** only if this
       session made one.
   - Keep the summary under 50 lines. If it is over, move detail down into the working area.

4. **Update any allied file that changed** (per the rule above):
   - A new decision + its reasoning → `<CONTEXT>/decisions.md`.
   - Changed wiring / structure → `<CONTEXT>/architecture.md`.
   - Changed database shape → `<CONTEXT>/database.md`.
   - Changed test approach → `<CONTEXT>/Testing.md`.

5. **Write NO per-session record.** No handoff note, no SESSIONS.md, no lean note.
   The record of "what happened" lives in HOT's `Last session` line, the
   `Last 3 sessions` list in `Progress.md`, the allied files, and the logs — and
   will later be messaged out by a notification hook.

6. **Confirm before finishing** — briefly tell the user which files you updated
   (full paths, and in a per-automation project name the automation), and what the
   next session's first step is, so they can review (they review after; you edit).

## Optional — check session health first

If the session felt long or degraded, suggest running `/warm-context-analysis`
before closing, to get an honest keep-going-vs-restart read. Keep it a separate
step; don't fold its logic in here.

## What this skill is NOT

- **Not `/handoff`.** It does not write a handoff note. If you catch yourself
  drafting a multi-paragraph summary file, stop — that's the old system.
- **Not a full rewrite of every context file.** It touches only what changed.
- **Not a git step.** Committing / summaries for git come later (git is built last).

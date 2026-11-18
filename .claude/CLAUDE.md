# CLAUDE.md — Book Buddha

## Purpose / Who this is for
Book Buddha is a local, offline-first, **double-entry** accounting app for a single
PC. It is general-purpose but organised **fair-wise** (a Book Fair is one kind of
customer-linked Project with its own P&L). It is built for a **non-accountant** —
the accounting is handled underneath. You are helping a finance professional who is
**not an engineer**: default to plain English, walk through any non-trivial command,
and reference exact file paths.

**Status:** spec stage — spec complete and approved, **nothing is built** yet. Next
is the Foundation build slice (pending technology decisions). Source of truth:
`spec/Design Document - Book Buddha (9 Nov 2026).md`.

## Where you are (orient yourself)
You are the coding assistant for Dhruv, who is building Book Buddha to senior-engineer
standard. He may describe things in simple or finance terms; translate those into sound
engineering and explain your choices briefly. Act as a senior developer, a senior
designer, and a full-stack web developer at once.

Interact with him where a decision needs his input, but carry the build through
yourself: keep working in a loop, iterating until the task is genuinely done. The final
decision always stays with Dhruv. Work only inside this repo; never touch anything
outside its folder.

**Always read first:** before any task, read `context/HOT.md` — current status,
blockers, next step. Allied files (`architecture.md`, `database.md`, `decisions.md`,
`todos.md`) are loaded **only when a task needs them**, not at startup.

## How we build (fixed)
- **spec → plan → build. No code before a confirmed plan.** Acceptance = the user's
  hand-worked figures, not a passing technical test.
- Vertical slices, one at a time: flow review → lock mini-spec → mini build-plan →
  build → test → accept → next.
- **Fixed parts (never bend):** double-entry (automatic) · audit log
  (tamper-evident) · cancel-with-reversal.
- **Use lower models where you can.** Sonnet for writing code and non-trivial
  research; Haiku for file search, context extraction, and other supporting or
  routine tasks.
- Use Sonnet for code writing and development and haiku for very non trivial work like file search and update. 
  You review the work done and make necessary tests pass, at each session end make the commits and push with proper message. Use Opus 5.5 as advisor where               
  needed. 

## Hard rules
1. **Never expose secrets** — API keys, passwords, tokens, `.env` files. Enforced in
   code: `.claude/hooks/protect-files.py` blocks Read/Edit/Write on patterns in
   `.claude/hooks/protected-files.txt`. The hook does NOT block Bash, so the
   instruction still governs there. If a secret is needed, ask the user for the value.
2. **Terminal:** proceed with non-dangerous commands; most importantly - ask first before anything that
   installs or deletes, unless the user explicitly asked for that specific action.
3. **Git is ENABLED but gated.**
   - All work happens on the **`Prototype`** branch. Never work on `main`. If
     you find yourself on `main`, stop and `git switch Prototype`.
   - Read-only git (`status`, `log`, `diff`, `show`) is fine once terminal
     permission is granted.
   - Propose write actions (`add` by explicit path, `commit`, `push` to a feature
     branch) with WHY/WHAT/RISK/HOW TO VERIFY and get approval each time.
   - Never `git add -A` / `.` / `-u` — stage by explicit path. One commit = one idea.
   - Never force-push, `reset --hard`, `clean -fd`, or rewrite pushed history.
   - Never commit/push to `main`. Enforced by `.git/hooks/pre-commit` and `pre-push`.
4. **Announce before committing; ask again before pushing.** State (a) exact paths,
   (b) branch, (c) commit message, (d) why they are one commit. "Yes, commit" is not
   "yes, push".
5. **`context/HOT.md` stays UNDER 50 lines.**
6. **Work one small step at a time** — WHY/WHAT/RISK/HOW TO VERIFY, wait for
   confirmation before any risky or destructive action.
7. **Never overwrite or delete important files without approval.**
8. **Off-topic work = a scratch session** — say so up front, commit nothing, output
   to the scratchpad or a path the user names.

## Note on two realities
The repo root is spec-stage, but the nested `book-buddha/` folder holds an earlier
working prototype (TypeScript / Vite / SQLite / React). Treat designs as **Target**
(approved spec) or **Current prototype** (existing code) — do not assume a target
screen or table already exists in the prototype. See `context/architecture.md`.

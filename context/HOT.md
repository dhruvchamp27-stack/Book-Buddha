# HOT — Book Buddha

## Last session
Harness installed on new PC (2026-11-14). Project context files seeded from repo docs.

## The project in one line
Local, offline-first, double-entry accounting app for one PC, organised fair-wise,
built for a non-accountant. Spec stage — spec approved, nothing built yet.

## Active now
**Next slice is unconfirmed** — the spec order says **Foundation** (engine + company /
businesses / chart of accounts + login); the newest prompt (14 Nov) + the prototype
say **Credit notes & sales returns**. Owner must pick. Source of truth:
`spec/Design Document - Book Buddha (9 Nov 2026).md`.

## Broken / blocked
- 4 technology decisions still officially pending (stack, who-builds, install/launch,
  test basis) — see `context/todos.md`.
- Two realities to reconcile: spec-stage target vs the working prototype in
  `book-buddha/` (self-reports passing tests; unverified).
- ~16 doc conflicts catalogued in `context/todos.md` (rounding, archive, build order…).

## Standing rules
- spec → plan → build. No code before a confirmed plan. Acceptance = hand-worked
  figures, not a passing technical test.
- Fixed parts (never bend): double-entry (automatic), tamper-evident audit log,
  cancel-with-reversal.
- Work one small step at a time; WHY / WHAT / RISK / HOW TO VERIFY before risky actions.
- Never work on `main`; use the working branch. Keep this file under 50 lines.

## Open items
- Confirm the outstanding technology decisions (see `plan/` Decisions doc and
  `context/decisions.md`).
- Phase-2 / V1-feature design items (bank categorization, bill OCR, archive) are
  being designed, not built — see `context/todos.md`.

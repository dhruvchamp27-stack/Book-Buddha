# Prompt — next session (Screen design: components first) — 12 Nov 2026

Paste at the start of a new chat in the Billing Project.

---

I'm building **Book Buddha**, a local, offline-first, double-entry accounting app for one PC. I'm a finance professional with a no-code background — not an engineer. **Spec is complete and approved. Nothing visual is built yet.**

Read first (in my `C:\Users\Admin\Desktop\Book Buddha` folder) — the design doc is the source of truth:
- `spec/Design Document - Book Buddha (9 Nov 2026).md`
- `spec/APP_FLOW.md` (screen-by-screen — the basis for the screens)
- `spec/PRD - Book Buddha.md`, `spec/Features List - Book Buddha.md`
- `reference/Invoice Ninja — Actual App Flow (reference).md` (UX reference only)
- `handoffs/Handoff - Book Buddha (paused 12 Nov 2026 session 2).md`

How to work with me:
- Short answers, one step at a time, confirm before moving on. No guessing; cite real sources; say "I cannot confirm this" when unverifiable.
- Questions in sets of up to 5, one decision each, lettered options; I answer "1A, 2B".
- Full section content in the message (plain text, not cards). Save files to the folder.

**Goal of this track:** design the app's screens in **Claude Design**, module by module, grounded in `APP_FLOW.md`. This is UI/visual design only — independent of the tech stack and the existing code prototype (those are decided separately).

**Step 1 — BEFORE designing anything: build a component inventory and save it as a file.**
- Go through `APP_FLOW.md` screen by screen. For each screen, list the UI components it needs (e.g. text input, dropdown, date field, data table, tabs, status badge, modal/dialog, toast/notification, primary/secondary buttons, search bar, filter chips, file upload, etc.) and its states (loading / empty / error).
- Then produce a **deduped master component list** — every unique component used across the app, each with a one-line purpose and where it's used.
- Save as `design/Component inventory - Book Buddha.md` (create the `design/` folder). Show me the full content in the message for approval first.
- No guessing — components come from `APP_FLOW.md`; flag any screen where the flow is silent on a detail.

**Step 2 — only after I approve the inventory:** pick one module and design its screens in Claude Design, reusing the inventory's components. Main screen first, then its states. One module at a time, each approved before the next.

Do not open Claude Design until the component inventory file is approved.

---

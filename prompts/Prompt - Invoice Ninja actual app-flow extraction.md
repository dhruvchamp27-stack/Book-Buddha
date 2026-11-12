# Prompt — Invoice Ninja: actual app-flow extraction (reference for Book Buddha)

## Role & goal
You are documenting how **Invoice Ninja actually flows**, screen by screen, click by click, so I can use its UX as a reference while designing my own app (Book Buddha). Produce a factual reference document — **not** opinions, not a redesign. I like how Invoice Ninja flows; capture exactly what it does.

## Source of truth & honesty rules
- Document **only what you can actually observe** in the running Invoice Ninja app (and/or the screenshots/exports provided). State the **Invoice Ninja version** you inspected.
- For anything you cannot verify by observation, write **"cannot confirm"** — never guess, never invent a screen, button, or link target.
- Cite where each observation came from (screen name / screenshot filename).

## What to produce
One Markdown document titled **"Invoice Ninja — Actual App Flow (reference)"**, in this exact structure:

### 1. Primary journeys (arrow maps)
Short arrow flows for the main paths: login, create invoice, record payment, create client, create product, quote→invoice, recurring invoice, expense/bill, reports, settings.

### 2. Screen-by-screen detail
For **every** screen/state below, list:
- **Purpose** — what the screen is for.
- **On-screen content** — the fields, columns, tabs, badges actually shown.
- **Every clickable element → where it links** — for each button, menu item, row action, tab, icon: its label and **the exact screen/dialog it opens or the action it performs**. This is the most important part — be exhaustive and precise about click targets and navigation.
- **Primary action** / **Secondary actions**.
- **Loading / empty / error states** — what the app shows while loading, when there's no data, and on validation/save/network failure (quote the actual message text where visible).
- **Branches / decision points** — where the flow splits.

Cover these modules (skip any Invoice Ninja does not have, and say so):
1. Login / password recovery
2. Dashboard
3. Clients — list, create/edit, client detail (tabs), statement, merge (if present)
4. Products — list, create/edit, stock (if present)
5. Invoices — list, create/edit, line items, bulk actions, lifecycle/status, mark paid, cancel/delete
6. Payments — list, enter payment, allocation across invoices, refunds, credits
7. Quotes — list, create, convert to invoice
8. Recurring invoices
9. Credit notes
10. Expenses / Vendors / Bills / Purchase orders (whichever exist)
11. Projects / Tasks (if present) — note how projects attach to invoices
12. Reports — list, how a report is run, filters/customize, export
13. Settings — numbering, custom fields, tax, company/branding, users/roles, import/export, backup

### 3. Secondary flows
Returning user, forgot password, bulk operations, import, settings changes.

### 4. Global states & patterns
Reusable patterns: how lists behave (search/sort/filter/pagination/column controls), how dialogs/confirmations work, how Save & New / autosave / drafts behave, keyboard shortcuts (if any), toast/notification style.

### 5. Click/link map (quick index)
A compact table: **Screen → Element → Opens/Links to → Notes.** One row per clickable element, so I can scan navigation at a glance.

## Output format
- Plain Markdown, headings and bullets, no code.
- Precise and literal. Quote actual button/label/message text in "quotes".
- If observation is partial, mark the screen **"partially observed"** and list what's missing.

## What NOT to do
- Do not redesign, critique, or suggest improvements.
- Do not describe features that aren't actually in the version you inspected.
- Do not include any of my personal/business data — this is a UX-flow reference only.

# Book Buddha

Local, offline-first, **double-entry** accounting app for one PC. General-purpose, organised **fair-wise** (a Book Fair is one kind of customer-linked Project with its own P&L). Built for a non-accountant; the accounting is handled underneath.

**Status:** spec stage — spec complete and approved, **nothing is built**. Next: the Foundation build slice (pending 4 technology decisions).

## Source of truth
`spec/Design Document - Book Buddha (9 Nov 2026).md` — read this first. The PRD, Features List and App flow are derived from it.

## Structure
| Folder | Contents |
|---|---|
| `spec/` | Design Document (source of truth), `APP_FLOW.md`, `PRD - Book Buddha.md`, `Features List - Book Buddha.md` |
| `plan/` | Build phase plan, Decisions (the 15 questions) |
| `handoffs/` | Session handoffs (latest: paused 12 Nov 2026 session 2) |
| `reference/` | Invoice Ninja inspection + actual app-flow reference (reference only — not the spec) |
| `prompts/` | Prompts for other AIs / next sessions |
| `testing/` | Test notes |
| `ARCHITECTURE_AND_DATABASE.md` | Target architecture, database model, and current prototype comparison |

## Fixed parts (never bend)
Double-entry (automatic) · audit log (tamper-evident) · cancel-with-reversal.

## How we build
Vertical slices, one at a time: flow review → lock mini-spec → mini build-plan → build → test → accept → next.
Order: Foundation (accounting engine + company/businesses/chart of accounts + login) → Customers → Items & stock → Invoices → Payments → Other documents → Fairs → Subscriptions → Reports → Settings → Admin.

**Rule:** spec → plan → build. No code before a confirmed plan. Acceptance = your hand-worked figures, not a passing technical test.

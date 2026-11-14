# TRD — Technical Requirements Document (Book Buddha)

> **TEMPLATE — to be completed by the owner / build team.** No native TRD existed in
> the repo, so this is a skeleton. Anchors that the repo already states are noted in
> *(italics with a source)*; everything marked `TODO` is for you to fill. Keep the
> authoritative technical narrative in `ARCHITECTURE_AND_DATABASE.md`; this file is the
> working requirements checklist derived from it.

## 1. Purpose & scope
- What this document governs: `TODO`
- In scope / out of scope (Phase 1 vs Phase 2): `TODO` *(spec: Phase 1 single-user
  Admin; Phase 2 invoicing users — DD §2.3–2.4)*

## 2. Platform & runtime
- Target OS / form factor: local, offline-first, single PC *(README)*
- Runtime: `TODO` *(prototype: Node 22+ / 24 — book-buddha/README.md)*
- Desktop packaging: `TODO — DECISION PENDING (Tauri vs Electron)`

## 3. Technology stack (confirm — officially "pending")
- Language / framework / DB: `TODO — formally unconfirmed` *(prototype uses
  TypeScript · Fastify 5 · better-sqlite3 13 · Zod 4 · React 19 · Vite 7 · Vitest 3)*
- Rationale / constraints: `TODO`

## 4. Architecture requirements
- Layered architecture (presentation → API/auth → application/accounting → repository
  → SQLite) *(ARCH §3–§4)* — see `architecture.md`.
- API validates ALL input; frontend never sets totals/statuses *(ARCH §3.2)*.
- Every financial operation = one DB transaction, all-or-nothing *(ARCH §3)*.
- `TODO`: module boundaries, API contract, error model.

## 5. Data & storage
- One SQLite file per company; integer paise; ISO dates; FKs ON; explicit indexes
  *(ARCH §3.5)* — see `database.md`.
- Migrations: ordered, backward-compatible, transactional, with
  `PRAGMA foreign_key_check` *(ANTI §4)*.
- Backup / restore: user-selectable scope; restore sanitises settings; integrity
  check before backup/restore *(DD §14.3, ARCH §3.5)*.
- `TODO`: retention, file locations, attachment storage (files outside SQLite).

## 6. Security & auth
- Google sign-in (setup/recovery) + daily app password (≥8, letters+numbers);
  lockout 15 min after 5 tries; auto sign-out after 1 h idle *(DD §15.2)*.
- Ownership checks at every cross-entity boundary *(ARCH §8)*.
- Secrets never committed; `.env` blocked by `.claude/hooks/protect-files.py`.
- `TODO`: session storage, password hashing, Phase-2 permission matrix.

## 7. Accounting engine requirements
- Automatic balanced double-entry; reject unbalanced saves *(DD §4.1)*.
- Cancel-with-reversal (exact reverse, stock restored, number never reused)
  *(DD §4.4)*.
- Tamper-evident hash-chain audit log from day one *(DEC Q9)*.
- FIFO costing; negative stock blocked; cash & accrual *(DD §6, §4.5)*.
- `TODO`: rounding rule — **DECISION PENDING (whole rupee vs exact paise)**.

## 8. Non-functional requirements
- Performance / data volume: `TODO`
- Offline behaviour / no network dependency: `TODO` *(cloud OCR optional only — FD)*
- Reliability / crash recovery: `TODO`
- Logging & observability: `TODO` *(system_logs table — ARCH §5)*

## 9. Build, test & CI gates
- Must pass before a slice is "done": `npm test`, `npm run build`, `npm run build:web`
  (run in `book-buddha/`) *(IMPLEMENTATION_PROGRESS, ANTI)*.
- See `Testing.md` for the full test plan.

## 10. Open technical decisions
See `todos.md` → "Technology decisions still officially pending" (stack, who-builds,
install/launch, test basis) and PDF/OCR library choice.

# Book Buddha

Book Buddha is an offline-first accounting application for small businesses that need
simple invoices, customer balances, inventory, fairs, and reliable double-entry
accounting without depending on a cloud service.

## Current capabilities

- Companies, businesses, customers, items, and fairs
- Cash-basis and accrual-basis accounting modes per company
- Draft, quotation, finalized, and cancelled invoices
- Invoice dates, due dates, discounts, extra charges, notes, and payment terms
- GST invoice-level taxes: CGST/SGST and IGST
- Customer payments, partial payments, receivables, and ageing
- FIFO inventory, stock validation, COGS, and inventory accounting
- Trial Balance, Profit & Loss, Balance Sheet, General Ledger, fair-sales, and stock reports
- Quotation-to-draft-invoice conversion
- SQLite persistence with additive schema migrations
- Fastify API and React/Vite frontend

## Technology

- TypeScript
- SQLite through `better-sqlite3`
- Fastify and Zod
- React and Vite
- Vitest

All monetary values are stored as integer paise. Finalized financial records are
immutable; corrections are made through controlled reversals.

## Requirements

- Windows, macOS, or Linux
- Node.js 22 or newer (Node 24 is currently verified)
- npm
- Visual Studio C++ Build Tools on platforms where `better-sqlite3` must compile

## Quick start

```powershell
cd D:\dhruv-book-accounting-app\book-buddha
npm ci
npm test
npm run build
npm run build:web
```

Start the API:

```powershell
npm run start:api
```

Start the frontend development server in another terminal:

```powershell
npm run dev:web
```

Read [SETUP.md](./SETUP.md) for database, development, and troubleshooting details.
Read [REQUIREMENTS.md](./REQUIREMENTS.md) for the product specification and roadmap.
Read [IMPLEMENTATION_PROGRESS.md](./IMPLEMENTATION_PROGRESS.md) before continuing feature work.

## Validation

The normal verification commands are:

```powershell
npm test
npm run build
npm run build:web
```

Do not run `npm audit fix --force` without reviewing the advisories first because
forced dependency upgrades may introduce breaking changes.

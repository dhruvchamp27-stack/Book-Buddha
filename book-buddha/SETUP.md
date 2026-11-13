# Book Buddha setup guide

## Prerequisites

Install:

1. Node.js 22 or newer
2. npm
3. Visual Studio Build Tools with **Desktop development with C++** if npm needs
   to compile `better-sqlite3` on Windows

Verify Node and npm:

```powershell
node --version
npm --version
```

## Install

From the project directory:

```powershell
cd D:\dhruv-book-accounting-app\book-buddha
npm ci
```

Use `npm ci` for a clean install from the lockfile. Use `npm install` only when
intentionally changing dependencies.

## Verify the project

```powershell
npm test
npm run build
npm run build:web
```

## Run locally

Build the backend first:

```powershell
npm run build
npm run start:api
```

In a second terminal, run the web development server:

```powershell
npm run dev:web
```

The API is Fastify-based and the web client is Vite-based. The application is
designed for local/offline use; keep the SQLite database on a trusted local
machine and back it up before upgrades.

## Database

The repository initializes SQLite schema objects at startup and applies additive
migrations for older databases. Existing databases must be backed up before
running a newer build.

Money is stored in integer paise. Do not introduce floating-point money fields.
Finalized invoices and journal entries must not be edited in place.

## Troubleshooting

### `better-sqlite3` build failure

Install the Visual Studio C++ Build Tools, then remove and reinstall dependencies:

```powershell
Remove-Item node_modules -Recurse -Force
npm ci
```

### Tests fail after a schema change

Use a fresh temporary database in tests. For a real database, make a backup first
and confirm that the migration is additive, transactional where possible, and
backward compatible.

### Dependency vulnerabilities

Run `npm audit` and review each advisory. Do not use `npm audit fix --force`
automatically.

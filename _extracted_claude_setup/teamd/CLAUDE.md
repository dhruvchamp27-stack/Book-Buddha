# CLAUDE.md — Team D's personal Automations Folder(Repo)

---

# Purpose/ Who this is for

You are helping **Team D** the external CPA / bookkeeping firm. The team includes Puneet, Manish, Dhruv. They are NOT engineers. Default to plain English, walk through any non-trivial command, and reference exact file paths so they can navigate.

Their primary work:
- Monthly close of books and other accounting tasks
- Cross-validation of output generated through any automation vs actual output
- Bank reconciliation, AR/AP aging, GL coding
- Drafting automation for repetitive accounting tasks

---

## Where you are (orient yourself)

Folder map

| Folder | What goes here |
|---|---|
| `notes/` | Markdown notes — session close summaries, meeting notes, observations |
| `automation/` | Python scripts, Excel templates, automation drafts |

Each folder needs to have its own "README" with format and naming conventions. In the "README" write in the explanatory manner; all the technical aspects of the project
including the python libraries used and other technical aspect or feature used in the automation. Include everything that is necessary for a CPA/CA to understand the codebase and related files and maintain the automation for longer time. 

## Naming conventions (match AC's documentation system)

- **Date-prefixed:** `YYYY-MM-DD_short-slug.md` (e.g., `2026-05-15_april-close-summary.md`)(short slug - maximum of 4 words)
- **Period-specific validation:** `YYYY-MM_what-was-compared.md` (e.g., `2026-03_pnl-ac-vs-qbo.md`)
- **Tenant-specific:** never put full PII in filenames, reference by unit number or pseudonym

---

## Hard rules

1. **NEVER advise to commit secrets and guide user with what needs to be pushed and what to be given other way round(manually)** — API keys, passwords, tokens, .env files, FCCB credentials, QBO secrets, AppFolio passwords. The `.gitignore` blocks the common patterns but stay alert.
2. **Terminal is allowed for non-dangerous commands** — read-only inspection, running scripts, read-only git. Ask first for anything that installs, deletes, overwrites, or reaches outside the project folder. *(aligned 2026-11-13 with AC_Automation hard rule 2, which this used to contradict.)*

3. **NEVER read/edit sensitive or secrets files like `.env` or any similar files containing any keys or credentials. (Ask for permissions to read/edit in such files from the user.)

---

## Soft rules / recommendations

- When something looks production-worthy (a script, a workflow, a doc), save it in the right folder (`automation/` or `notes/`) and tell the user to ping Puneet or Manish. *(2026-11-13: `handoffs/` is retired — state now lives in `context/HOTcontext.md`, written by `/session-end`.)*

- When unsure, ask before acting.
- When asked for something complex, walk through plain English first, code second(MUST REMEMBER).

----


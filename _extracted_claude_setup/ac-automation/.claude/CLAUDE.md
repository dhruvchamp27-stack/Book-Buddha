# CLAUDE.md — Team D's personal Automations Folder (Repo)

---

# Purpose / Who this is for

You are helping **Team D**, the external CPA / bookkeeping firm. The team includes Puneet, Manish, Dhruv. They are NOT engineers. Default to plain English, walk through any non-trivial command, and reference exact file paths so they can navigate.

Their primary work:
- Monthly close of books and other accounting tasks
- Cross-validation of output generated through any automation vs actual output
- Bank reconciliation, AR/AP aging, GL coding
- Drafting automation for repetitive accounting tasks

---

## Where you are (orient yourself)

**Always read first:** before any task, read `context/HOTcontext.md` — current status, blockers, next steps.

Folder map:

| Folder | What goes here |
|---|---|
| `context/` | `HOTcontext.md` and allied context files — the repo's memory / handoff system |
| `notes/` | Markdown notes — session close summaries, meeting notes, observations |
| `automation/` | Python scripts, Excel templates, automation drafts |

Each folder needs its own **README** covering its format and naming conventions. Write the README in an explanatory style, documenting all the technical aspects of the project — the Python libraries used and any other techniques or features the automation relies on. Include everything a CPA/CA needs to understand the codebase and related files and to maintain the automation over the long term.

## Naming conventions (match AC's documentation system)

- **Date-prefixed:** `YYYY-MM-DD_short-slug.md` (e.g., `2026-05-15_april-close-summary.md`) (short slug — maximum of 4 words)
- **Period-specific validation:** `YYYY-MM_what-was-compared.md` (e.g., `2026-03_pnl-ac-vs-qbo.md`)
- **Tenant-specific:** never put full PII in filenames; reference by unit number or pseudonym

---

## Hard rules

1. **Never share or expose secrets** — API keys, passwords, tokens, `.env` files, FCCB credentials, QBO secrets, AppFolio passwords. The `.gitignore` blocks common patterns, but stay alert. If a secret is needed, tell the user what to handle manually rather than putting it anywhere tracked.
2. **Can proceed with terminal anytime for any non dangerous commands or anytime when it does not involve something to install or delete** — ask the user first **(If the user explicitly said to install or delete something, you can proceed with it for that specific task or part)** for that specific task.
3. **Never read `.env`, `*.env`, `.env.*`, or the `.env` folder into context.** If a secret is needed, ask the user to supply the value directly — never open the file. *(2026-11-13: this is now enforced in code, not just instruction — `.claude/hooks/protect-files.py` is wired into `.claude/settings.json` on Read/Edit/Write and blocks every pattern listed in `.claude/hooks/protected-files.txt`. The hook does NOT block Bash, so `cat .env` would still work — the instruction remains the guard there.)*
4. **Git is ENABLED but gated.** *(relaxed 2026-09-04 — replaces the old "No git actions by Claude" rule)*
- **All work happens on the `Dhruv` branch.** Never work on `main`. If you find yourself on `main`, stop and switch back: `git switch Dhruv`.
- Claude MAY run **read-only** git commands (`status`, `log`, `diff`, `remote -v`, `branch --list`, `show`) once terminal permission is granted for the session.
- Claude MAY **propose** write actions (`add` by explicit path, `commit`, `switch -c`, `push` to a feature branch) but must state WHY / WHAT / RISK / HOW TO VERIFY and get explicit approval **each time**.
- **Never** `git add -A`, `git add .`, or `git add -u`. Stage by explicit path only. One commit = one idea — a sweep-commit fuses unrelated changes into a lump, and a lump cannot be reviewed or undone selectively.
- **Never** force-push, `git reset --hard`, `git clean -fd`, or rewrite already-pushed history.
- **Never** commit or push to `main` / `master`. Two guards enforce this, installed 2026-09-04: `.git\hooks\pre-commit` refuses any commit made while on `main`, and `.git\hooks\pre-push` refuses any push to `main`. They are **not** interchangeable — only the push guard catches `git push somebranch:main` or a merge into `main`, because in those cases no commit was ever made *on* main. Overrides exist (`TEAMD_ALLOW_MAIN_COMMIT=1`, `TEAMD_ALLOW_MAIN_PUSH=1`) and are for deliberate, rare use by a human — Claude must never set them.
- Hard rule #1 still governs: nothing containing keys, credentials, or real vendor/property names gets staged.
5. **Announce before committing; ask again before pushing.** *(added 2026-09-04)*
- Before ANY commit, Claude must tell the user in plain English: **(a)** the exact file paths going in, **(b)** the branch they will land on, **(c)** the proposed commit message, and **(d)** why those files belong together as ONE commit. Only after the user confirms does the commit run.
- **Pushing is a separate permission.** After a commit lands, Claude must ask again before `git push`. Never treat one approval as covering both — "yes, commit" is not "yes, push".
- If Claude is unsure whether a file belongs in the commit, it stays OUT and gets raised with the user rather than swept in.
6. **Each project's `context/HOTcontext.md` stays UNDER 50 lines.**
7. **Work one small step at a time** — explain WHY / WHAT / RISK / HOW TO VERIFY, and wait for confirmation before any risky or destructive action.
8. **Never overwrite or delete important files without approval** — ask permission to read or edit such files.
9. **Off-topic work = a scratch session — say so up front, and commit nothing.** *(added 2026-10-28)*
- "Off-topic" = anything outside the invoice pipeline, its docs, its context files, or this repo’s own setup. If Claude is unsure, it asks instead of guessing.
- Claude says it in one line BEFORE starting: "This looks off-topic for AC_Automation — I will treat it as a scratch session, so nothing gets committed."
- In a scratch session Claude does the work but makes **no git writes** — no `add`, `commit`, `push`, or branch creation. Read-only git (`status`, `log`, `diff`) is still fine.
- Output goes to the scratchpad or a path the user names, and Claude states the full path. The user decides later whether any of it belongs in the repo.
- **Only the user lifts this**, with an explicit "commit this anyway" naming the file. Claude never decides mid-session that the work became on-topic.

---

## Session startup checks

First turn, check both and report in ONE line.

- **Headroom** (token compressor) — `curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/stats` = `200` means up. If not: `headroom init hook ensure --profile init-ac_automation-9fcab3f2 --marker headroom-init-claude` (~1s, idempotent, silent), then re-check. Still down → say so and carry on; it only means "no compression", never a broken session. Never reinstall or re-route. Routing lives in `.claude/settings.local.json` — gitignored, never commit.
- **CBM** (codebase index) — up if the `mcp__codebase-memory-mcp__*` tools are listed. Claude CANNOT start it mid-session; if absent, say so and ask for `/mcp` or a restart. Fallback works without MCP: `codebase-memory-mcp cli --quiet index_status "{\"project\":\"<ID>\"}"` — use it rather than reading whole files. Index refresh happens at session END (`session-end` step 4), not here.

---

## Soft rules / recommendations

- ### Codebase Memory — CBM MCP

Use the **CBM Codebase Memory MCP** as the primary way to understand and navigate the codebase.

- Before reading large source files, use CBM to index/search the relevant code and identify the files, symbols, dependencies, and implementation areas involved.
- Prefer targeted CBM queries over repeatedly reading entire files.
- Use CBM to retrieve relevant code context when investigating existing functionality, tracing dependencies, or deciding where to make changes.
- Only read the full source file when the required context cannot be obtained through CBM or when the actual file contents are necessary for making/editing the change.
- Keep CBM's index up to date when files are added or substantially changed.
- Do not repeatedly re-read large files if the required context is already available through CBM.

**Goal:** Minimize unnecessary full-file reads while maintaining enough context to make accurate changes.
**Principle:** Use CBM for discovery and context; use the actual files for verification and modification.
- ###
- When something looks production-worthy (a script, a workflow, a doc), make sure it's saved in the right folder (`automation/` or `notes/`) and flag it to Puneet.
- When unsure, ask before acting.
- When asked for something complex, walk through plain English first, code second (MUST REMEMBER).
- Delegate routine or heavy work (cron-job-like or otherwise non-trivial tasks) to a **Sonnet or Haiku** sub-agent to keep the main context window clean. Manage the split between Opus and Sonnet sensibly for the work at hand.
- You can use Codebase Memory MCP for querying the codebase in order to find any specific  functions.
- Delegate non trivial tasks or code improvements tasks to sonnet or haiku agent and review their work done. Use sonnet 5 if delegating. (MUST REMEMBER). Brainstorm with the user on the improvements and bug fixes and once finalised what to fix, allot  it to sonnet with proper understanding in all sense. Can also use haiku for searching the codebase for any reason like specific searches or bug finding
---
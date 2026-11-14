# New-PC Claude Code setup — Book Buddha (14 Nov 2026)

Rebuilt the Claude Code harness from the `claude-setup-2026-11-13` bundle, adapted to
Book Buddha (generic harness — **not** the Team D / AC_Automation invoice project).
Writes were confined to the global settings folder (`C:\Users\Admin\.claude`) and this
project folder.

## Installed / configured

### Global layer — `C:\Users\Admin\.claude\`
- `CLAUDE.md` (5 core behaviour rules), `settings.json` (model, dark/fullscreen, ~80
  built-in skills off, Superpowers enabled). Old empty `settings.json` backed up to
  `settings.json.bak`.
- `config\harness.config.json` (hard-block + approval + protected-folder rules).
- `hooks\`: `approval-hook.ps1`, `protected-folders-hook.ps1`, `logging-hook.ps1`,
  `session-context-hook.ps1`. **Hook paths rewrote** `Dhruv Champaneria` → `Admin`.
- `skills\`: `session-start`, `session-end`, `hybrid-explain`.
- Hooks **tested green** (7/7): rm -rf / Remove-Item -Recurse / git push --force BLOCK;
  single-file delete ASK; listing ALLOW; edit to `config/` BLOCK; edit to source ALLOW.

### Project layer — `Book Buddha\.claude\`
- `CLAUDE.md` (Book Buddha purpose + git gate to branch `Prototype`; you added the
  "who you're helping" section).
- `settings.json` wires **only** project hooks (SessionStart → session-context;
  PreToolUse → protect-files). The global 3 are registered globally only → no
  double-firing.
- `hooks\`: `session-context-hook.ps1`, `protect-files.py`, `protected-files.txt`
  (generic tripwire list: .env variants, auth_state.json, config.json, *.sqlite/*.db).
- `skills\`: `session-start`, `session-end`, `cleanup`, `hybrid-explain`,
  `i-have-adhd`, `warm-context-analysis` (all `<name>\SKILL.md`, verified loadable).
- **Context system renamed `HOTcontext.md` → `HOT.md`** everywhere (hook + skills +
  config). SessionStart auto-load verified.

### Context system — `Book Buddha\context\`
- `HOT.md` (35 lines), `architecture.md`, `database.md`, `decisions.md`, `todos.md`
  — seeded from the repo docs (via a Haiku sub-agent digest), conflicts flagged, not
  invented.
- `PRD.md`, `app-flow.md` — real copies of `spec/PRD` and `spec/APP_FLOW`.
- `TRD.md`, `design-system.md`, `Testing.md` — **templates** to complete.

### Git safety
- Identity (repo-local): `Dhruv <dhruvchamp25@gmail.com>`. On branch **`Prototype`**.
- `.git\hooks\pre-commit` (blocks commits on main/master) + `pre-push` (blocks pushes
  whose destination ref is main/master). **Tested:** commit-on-main BLOCKED,
  push-to-main BLOCKED, push-to-Prototype ALLOWED.
- `.gitignore` created; 15 sensitive patterns verified via `git check-ignore`
  (.env*, config.json, auth*.json, *.sqlite/*.db, *.xlsx, __pycache__, venv,
  node_modules, .claude/logs, .claude/settings.local.json, the extracted bundle + zip).
- Override env vars (human-only, deliberate): `BOOKBUDDHA_ALLOW_MAIN_COMMIT=1`,
  `BOOKBUDDHA_ALLOW_MAIN_PUSH=1`.

### Plugins / MCP / memory
- **Superpowers** — active.
- **Headroom** — not running (`/stats` = 000). Optional; = no compression only.
- **Codebase-Memory MCP** — not used (no `.mcp.json` in this project).
- **Memory** — imported an adapted `protected-file-placeholder-workflow`; skipped the
  AC-specific `deferred-investigate-commit-autodeny`. Folder:
  `C:\Users\Admin\.claude\projects\C--Users-Admin-Desktop-Book-Buddha\memory\`.

## Skipped / not applicable
- TeamD umbrella layer; AC_Automation invoice specifics (codebase-memory MCP, branch
  `Dhruv`, invoice config protection).

## Still to do by hand
- **git on PATH**: only GitHub Desktop's bundled git was present; you're installing Git
  Bash — once done, `git` works in terminals. (Hooks already fire via any git here.)
- If the `Book Buddha` folder ever moves, update the two **absolute** hook paths in
  `Book Buddha\.claude\settings.json` (`$CLAUDE_PROJECT_DIR` is empty in this app, so
  absolute paths were used).
- `claude login` — not needed (already logged in).
- Fill the three templates (`TRD.md`, `design-system.md`, `Testing.md`) and re-customize
  context wording where AC phrasing remains in some skills.

## Open project questions surfaced (recorded in `context/todos.md`)
- Next build slice unconfirmed: **Foundation** (spec) vs **Credit notes** (14 Nov prompt
  + prototype).
- ~16 doc conflicts (rounding whole-rupee vs exact-paise; archive v1/v2/V1; "nothing
  built" vs working prototype; 3 build orders; GST per-line vs per-invoice; canonical
  repo path `D:\…` vs this `C:\…` checkout; etc.).

# The setup prompt

Open Claude Code on the new PC, in the folder you want to work in, and paste
everything between the two lines below as your first message. It tells Claude to
rebuild this whole system from the bundle sitting next to it.

Before you paste: unzip this bundle somewhere and have the path ready. Claude
will ask for it if you forget.

---------------------------------------- COPY FROM HERE ----------------------------------------

You are setting up my Claude Code environment on a new PC from an exported
bundle. The bundle is at: <PASTE THE UNZIPPED FOLDER PATH HERE>

Read `README-SETUP.md` and `MANUAL-STEPS.md` in that bundle first. They describe
what each piece is. Then do the work below, **one numbered step at a time**,
telling me WHY / WHAT / RISK / HOW TO VERIFY before each step and waiting for my
confirmation. Do not run ahead.

Ground rules for this whole job:
- Never open, read, or copy any file containing credentials — `.env`, `*.env`,
  `auth.json`, `auth_state.json`, `.credentials.json`, `config.json`. If you
  need a value from one, ask me to paste it.
- Never commit anything unless I explicitly say so.
- Tell me immediately if a step is blocked rather than working around it.
- Windows paths use backslashes; adapt everything if this is a Mac.

**Step 1 — Survey.** Report back: which OS and Windows username, whether Claude
Code is logged in, whether `C:\Users\<me>\.claude\` already exists, and what is
already in it. If anything there would be overwritten, list it and stop for my
decision. Do not overwrite anything without asking.

**Step 2 — Global layer.** Copy `global/CLAUDE.md`, `global/settings.json`,
`global/config/`, `global/hooks/`, and `global/skills/` into the user `.claude`
folder. Then search every copied file for the old username
`Dhruv Champaneria` and replace it with the username on this PC — the hook
paths inside `settings.json` are absolute and WILL break otherwise. Show me the
list of files you changed.

**Step 3 — Hooks, and prove they work.** The hooks give me a real guard rail,
not just instructions:
- `approval-hook.ps1` — two tiers read from `harness.config.json`.
  `hardBlockPatterns` refuse a command outright with exit code 2;
  `approvalRequiredPatterns` ask for confirmation.
- `protected-folders-hook.ps1` — refuses edits to `config/` and `logs/`,
  anchored to the project root, so a repo's own `src/config` stays editable.
- `logging-hook.ps1` — appends every tool call to `.claude/logs/<date>.log`.
- Both guards prefer the current project's
  `.claude/config/harness.config.json` when it exists and fall back to the
  global one, so a project can be stricter than the default. They fail OPEN:
  if no config can be read they allow the command, because a global hook that
  crashes would break every project.

After wiring them, **test them before trusting them**. Write a small PowerShell
test that pipes fake payloads into each hook and checks the exit code — a
recursive force delete must BLOCK (exit 2), a single-file delete must ASK, a
plain listing must ALLOW, an edit to the project's `config/` must BLOCK, and an
edit to an ordinary source file must ALLOW. Show me the pass/fail table. Do not
tell me the hooks work until that table is green.

**Step 4 — Avoid double-firing.** If a project also wires its own copies of
`approval-hook`, `protected-folders-hook` or `logging-hook` in
`.claude/settings.json`, every command gets guarded twice and I get two prompts.
Register these three GLOBALLY only, and remove them from any project's
`settings.json`. Keep project-only hooks (for example `protect-files.py` and
`session-context-hook.ps1`) wired at the project level.

**Step 5 — Plugins and MCP.** Install:
- Superpowers: `/plugin marketplace add anthropics/claude-plugins-official`
  then `/plugin install superpowers@claude-plugins-official`
- Headroom (token compressor, optional):
  `/plugin marketplace add headroomlabs-ai/headroom` then
  `/plugin install headroom@headroom-marketplace`. Let it generate its own
  `settings.local.json` — do not copy mine, it hard-codes a machine-specific
  profile ID. Verify with
  `curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/stats`
  (200 = up; anything else just means no compression, never a broken session).
- Codebase-Memory MCP, if the project has a `.mcp.json` naming it. Index once
  after install. Confirm the `mcp__codebase-memory-mcp__*` tools are listed.

Report which of these are up and which are not. Do not pretend one works if you
have not seen it respond.

**Step 6 — The context system.** This replaces fat handoff notes. Each project
keeps a `context/` folder:
- `HOTcontext.md` — the live state, **hard limit 50 lines**. Sections: a one
  line `## Last session`, `## The project in one line`, `## Active now` with
  the single next step, `## Broken / blocked`, `## Standing rules`.
- `decisions.md` — why a choice was made, numbered per session (S1-1, S1-2...).
- `todos.md`, `architecture.md` — loaded only when a task needs them.

If this project already has handoff notes, session summaries, or any other
scattered state, **convert them**: read them, distil them into the structure
above, and show me the proposed `HOTcontext.md` for approval before writing it.
Keep it under 50 lines even if that means dropping detail into `decisions.md`.
Never invent status — if something is unclear, list it as an open question
rather than guessing.

Also install a SessionStart hook that reads `context/HOTcontext.md` and injects
it automatically, so a new session is oriented without reading files. The
bundle's `session-context-hook.ps1` does this; point it at the right path.

**Step 7 — Skills.** After copying, run `/` and confirm these are listed:
`session-start`, `session-end`, `cleanup`, `hybrid-explain`, `i-have-adhd`,
`warm-context-analysis`. Common failures to check for:
- a skill file not named exactly `SKILL.md` will not load;
- a skill folder nested inside `commands/` instead of `skills/` will not load;
- a skill folder nested inside another skill's folder will not load.
Fix any you find and tell me what was wrong.

**Step 8 — Git safety.** If this is a git repo:
- set my identity, and switch off `main` onto a working branch;
- **git hooks are not cloned** — recreate `.git/hooks/pre-commit` (refuses a
  commit made while on `main`) and `.git/hooks/pre-push` (refuses a push to
  `main`). They are not interchangeable: only the push guard catches
  `git push somebranch:main` or a merge, because no commit was ever made *on*
  main in those cases. Test both by trying a real commit and push on `main` and
  showing me that each is refused.
- check `.gitignore` covers, at minimum: `.env` and variants, `*.sqlite` /
  `*.db`, `*.xlsx`, `config.json`, `auth*.json`, `__pycache__/`, `venv/`,
  `.claude/logs/`, `.claude/settings.local.json`, and any debug-output folder.
  Verify each with `git check-ignore -v <path>` and show me the results — do
  not just add lines and assume.

**Step 9 — Memory.** Tell me the full path of your memory folder for this
project, then copy the files from the bundle's `memory/` into it. Confirm by
listing what you can recall.

**Step 10 — Final verification.** Run through and show me evidence for each:
- `/session-start` produces a briefing from HOTcontext
- the skill list is complete
- the hook test table is green
- a deliberate `git commit` attempt on `main` is refused
- `git check-ignore` confirms the sensitive patterns
- Headroom and the MCP server respond, or are clearly reported as not installed

Then write a short note at `notes/<today>_new-pc-setup.md` recording what was
installed, what was skipped, and anything I still need to do by hand.

Finally, remind me of the things that cannot be automated: `claude login`, and
carrying across `config.json`, `.env`, and any database or spreadsheet by hand.

----------------------------------------- COPY TO HERE -----------------------------------------

## If you only want the short version

> Set up my Claude Code environment from the bundle at `<PATH>`. Read
> `README-SETUP.md` and `MANUAL-STEPS.md` first, then work through it one step
> at a time, explaining WHY / WHAT / RISK / HOW TO VERIFY and waiting for my
> confirmation each time. Never open `.env` or `config.json`. Test the hooks
> before telling me they work, and show me the evidence.

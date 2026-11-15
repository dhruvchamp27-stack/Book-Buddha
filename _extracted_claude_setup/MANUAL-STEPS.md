# Manual steps - the things that cannot travel in a zip

Nothing in this bundle is a secret. That is deliberate. The items below were left
out on purpose and have to be done by hand on the new PC.

---

## 1. Your Claude login (REQUIRED)

**Left out:** `.credentials.json` - this is your personal OAuth token.

**Do instead:** open a terminal on the new PC and run

```
claude login
```

Never copy `.credentials.json` between machines, and never put it in a repo.

---

## 2. Headroom - the token compressor (OPTIONAL but you use it daily)

**Left out:** `settings.local.json`, because it hard-codes a Windows path and a
profile ID generated for this specific machine.

**Do instead:**

1. Install the Headroom plugin:
   ```
   /plugin marketplace add headroomlabs-ai/headroom
   /plugin install headroom@headroom-marketplace
   ```
2. Let Headroom generate its own `settings.local.json` for the project. If you
   need to write it by hand, `ac-automation/settings.local.json.example` shows
   the shape - replace `<YOUR-WINDOWS-USER>` and regenerate the
   `--profile init-...` value rather than reusing the old one.
3. Check it is running:
   ```
   curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:8787/stats
   ```
   `200` means up. Anything else just means no compression - never a broken
   session.

**Important:** `settings.local.json` is gitignored on purpose. Never commit it.

---

## 3. Codebase-Memory MCP (OPTIONAL)

**Left out:** the index itself (it lives in
`%USERPROFILE%\.cache\codebase-memory-mcp` and holds real vendor and property
names from the source).

**Do instead:** install the `codebase-memory-mcp` server so the `.mcp.json` in
`ac-automation/` can find it, then rebuild the index once:

```
codebase-memory-mcp cli index_repository --repo-path "C:\Users\<YOU>\Desktop\TeamD-Git\AC_Automation"
```

---

## 4. The project's own secrets (REQUIRED before the pipeline runs)

None of these are in the bundle and none should ever be:

- `config.json` - paths and settings for the invoice pipeline
- `.env` - credentials
- `reader_settings.bat`
- `invoice_queue.xlsx`
- the SQLite database (holds real vendor and property names)

Carry these across by hand - a USB drive, or your password manager for the
credentials. Do not email them and do not commit them.

An `.env.template` already exists in the AC_Automation repo showing which keys
are needed.

---

## 5. Git identity and the branch guards

**Do on the new PC:**

```
git config user.name  "Dhruv Champaneria"
git config user.email "karmacpa1@gmail.com"
git switch Dhruv
```

The two guards that stop commits and pushes to `main` live in `.git\hooks\` -
**git hooks are not cloned**, so after cloning the repo on the new PC you must
copy `pre-commit` and `pre-push` across by hand, or recreate them. Without them
the "never touch main" rule is only an instruction, not an enforcement.

---

## Quick checklist

- [ ] `claude login`
- [ ] global `.claude` files copied
- [ ] TeamD umbrella copied
- [ ] AC_Automation `.claude` + `.mcp.json` copied
- [ ] Superpowers plugin installed
- [ ] Headroom installed (optional)
- [ ] Codebase-Memory installed and indexed (optional)
- [ ] memory files placed in the project memory folder
- [ ] `config.json` / `.env` / database carried over by hand
- [ ] git identity set, on branch `Dhruv`
- [ ] `.git\hooks\pre-commit` and `pre-push` recreated
- [ ] `/session-start` runs and shows the briefing

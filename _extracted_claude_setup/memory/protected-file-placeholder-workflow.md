---
name: protected-file-placeholder-workflow
description: "How to handle values from protected files (config.json, .env, xlsx) without opening them"
metadata:
  node_type: memory
  type: feedback
  originSessionId: 50fbf2ef-4047-4147-b907-4a93becf2a1c
  modified: 2026-10-14T09:01:51.406Z
---

When a value is needed from a protected file (`config.json`, `.env`, `invoice_queue.xlsx`, `Vendors&Properties.xlsx`), never open the file. Instead either (a) ask Dhruv for the value in chat, or (b) leave a clearly-marked placeholder in the code/file (e.g. `# TODO(Dhruv): paste DB path here`) for him to fill in manually. He chooses which per value.

**Why:** CLAUDE.md hard rule #3 forbids reading these files; this is the agreed way to still get the values needed.

**How to apply:** Default to a labelled placeholder for things that live in a file anyway; ask in chat for one-off values. Confirmed 2026-10-14.

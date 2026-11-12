# Round 5 status note (9 Nov 2026)

Checked on 9 Nov against the files on disk.

## Usable
The written / code findings in both round-5 files are sound and answer the open items:
- `IN-round5-codebase-corrections.md` — items 6 (8 skipped theme tokens), 9 (real delete-modal
  wording: title "Confirmation", body "Are you sure?", button "Continue"; both earlier quotes were
  paraphrases), 10 (a zero-total DRAFT invoice is allowed; earlier "blocked" claim confused draft
  with issue), 11 (Pass 7 catch-all, 12 patterns), 12 (all 268 settings across 26 tabs, plus 13 in
  no tab).
- `IN-round5-visual-corrections.md` — text parts of items 2 (locked-invoice mechanism/styling),
  3 (11 designs confirmed from DB; font is a SINGLE GLOBAL setting, not per-design), 5 (motion:
  drawer 300ms ease-in-out, modal fade, toasts spring, tabs/rows no motion), 7 (status pill radius
  4px, colour = 15% opacity bg + solid text), 8 (keyboard shortcuts in the running web app).

## NOT delivered — do not trust the screenshot claims
`IN-round5-visual-corrections.md` claims the duplicate screenshots were re-captured and lists new
MD5s and new files (`17-pass4-locked-invoice.png`, `design-01..11`, `email-01..04`). On disk this
is false:
- `IN-ui-screenshots/` still holds only files `01-16`; the claimed new files do not exist.
- MD5 (run 9 Nov) shows the duplicates are unchanged: `01=02=03=08` (`e39e0b9a`),
  `06=07=12` (`d0ee3c45`), UX `13=14` (`96cd1967`), `18=19` (`2778f568`).
- So there is still no real dark-mode shot, no locked-invoice shot, no design renders, no email
  renders.

**Treat any `[SEEN ...]` claim in `IN-round5-visual-corrections.md` as unverified.**

## Decision
Parked by the user (option 2): proceed on the text/code findings. Revisit the screenshots only at
the UI / look-and-feel phase, with a fresh request that the AI actually save the images and paste
their real MD5s.

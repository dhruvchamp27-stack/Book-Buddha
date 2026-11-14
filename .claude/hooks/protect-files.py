#!/usr/bin/env python3
"""Claude Code PreToolUse hook: block Read/Edit/Write on protected files.

What it does
------------
Before Claude Code reads, edits, writes, or notebook-edits a file, this
script checks the target path against a plain-text list you maintain
yourself (protected-files.txt, next to this script). If the path matches,
the tool call is denied and Claude is told why. Everything else proceeds
normally.

What it does NOT cover
-----------------------
Only the direct file tools: Read, Edit, Write, MultiEdit, NotebookEdit.
It does not inspect Bash commands (e.g. `cat secret.env` or `rm file`) --
blocking those reliably needs a separate Bash-matching hook, since a shell
command can reference a file in many disguised ways. Keep this in mind if
"protected" needs to mean "completely unreachable" rather than "the normal
file tools won't touch it."

Configure it
-------------
Edit protected-files.txt (same folder as this script). One pattern per
line. Blank lines and lines starting with # are ignored. Patterns use
shell-glob syntax (fnmatch), matched against the absolute file path with
forward slashes:
    .env                -> blocks a file named exactly ".env" anywhere
    .env*                -> blocks .env, .env.local, .env.production, etc.
    secrets/**            -> blocks everything under any "secrets" folder
    **/config/prod.json   -> blocks that one file at any depth
    /Users/me/vault/**    -> blocks everything under one specific folder

Wire it up
----------
Add this to .claude/settings.json (create the file if it doesn't exist):

    {
      "hooks": {
        "PreToolUse": [
          {
            "matcher": "Read|Edit|Write|MultiEdit|NotebookEdit",
            "hooks": [
              {
                "type": "command",
                "command": "python3",
                "args": ["${CLAUDE_PROJECT_DIR}/.claude/hooks/protect-files.py"]
              }
            ]
          }
        ]
      }
    }

Place this script (and protected-files.txt) at .claude/hooks/ in your
project, and make sure python3 is on PATH.

WINDOWS NOTE (AC_Automation): `python3` is normally NOT on PATH on Windows.
This project wires the hook with the `py` launcher instead, in the same
single-string "command" style the other hooks in settings.json use:

    "command": "py \"$CLAUDE_PROJECT_DIR/.claude/hooks/protect-files.py\""
"""

from __future__ import annotations

import fnmatch
import json
import sys
from pathlib import Path

CONFIG_FILENAME = "protected-files.txt"

# Which tool_input field holds the path, per tool.
PATH_FIELDS_BY_TOOL = {
    "Read": "file_path",
    "Edit": "file_path",
    "Write": "file_path",
    "MultiEdit": "file_path",
    "NotebookEdit": "notebook_path",
}


def load_patterns() -> list[str]:
    config_path = Path(__file__).resolve().parent / CONFIG_FILENAME
    if not config_path.exists():
        return []
    patterns = []
    for raw_line in config_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        patterns.append(line.replace("\\", "/"))
    return patterns


def normalize(path_str: str) -> str:
    """Forward slashes throughout, so Windows backslash paths still match
    patterns written with forward slashes."""
    return path_str.replace("\\", "/")


def is_protected(file_path: str, patterns: list[str]) -> str | None:
    """Return the matching pattern if file_path is protected, else None."""
    normalized = normalize(file_path)
    name = normalized.rsplit("/", 1)[-1]
    for pattern in patterns:
        if fnmatch.fnmatch(normalized, pattern) or fnmatch.fnmatch(name, pattern):
            return pattern
    return None


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        # Can't read the event: fail open (don't block) rather than guess.
        return 0

    tool_name = payload.get("tool_name", "")
    field = PATH_FIELDS_BY_TOOL.get(tool_name)
    if field is None:
        return 0  # Not a tool this hook watches.

    file_path = payload.get("tool_input", {}).get(field)
    if not file_path:
        return 0

    patterns = load_patterns()
    if not patterns:
        return 0  # Nothing configured as protected yet.

    matched = is_protected(file_path, patterns)
    if matched is None:
        return 0  # Not protected; let the normal permission flow decide.

    reason = (
        f"Blocked by protect-files.py: '{file_path}' matches the protected "
        f"pattern '{matched}' in {CONFIG_FILENAME}. Remove or adjust that "
        f"line in {CONFIG_FILENAME} if this file should be accessible."
    )
    print(
        json.dumps(
            {
                "hookSpecificOutput": {
                    "hookEventName": "PreToolUse",
                    "permissionDecision": "deny",
                    "permissionDecisionReason": reason,
                }
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

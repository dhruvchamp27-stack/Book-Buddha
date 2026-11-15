# PreToolUse guard — asks for Y/N confirmation on terminal commands
# matching approvalRequiredPatterns in config/harness.config.json.
#
# "ask", not "deny". CLAUDE.md specifies confirmation, not a hard block.
# A hard block turned every false positive into a dead end — including
# a handoff document that merely quoted a delete command. With "ask",
# a false positive costs one click, so the pattern list can stay broad
# instead of being tuned until it leaks.

$INPUT_JSON = [Console]::In.ReadToEnd()

# Parse as JSON, not regex. A regex stops at the first quote mark, so
# `Write-Output "hi"; Remove-Item x` would be read as `Write-Output \`
# and the dangerous half would never be inspected.
try {
    $DATA = $INPUT_JSON | ConvertFrom-Json
} catch {
    exit 0
}

$TOOL_NAME = $DATA.tool_name
$COMMAND   = $DATA.tool_input.command
if (-not $COMMAND) { exit 0 }

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$CONFIG     = Get-Content -Raw "$SCRIPT_DIR\..\config\harness.config.json" | ConvertFrom-Json
$PATTERNS   = $CONFIG.approvalRequiredPatterns

$NEEDS_APPROVAL = $false
foreach ($pattern in $PATTERNS) {
    if ($COMMAND -like "*$pattern*") {
        $NEEDS_APPROVAL = $true
        $MATCHED_PATTERN = $pattern
        break
    }
}

if ($NEEDS_APPROVAL) {
    # Record the prompt here, not in the PostToolUse logger. If the answer
    # is No the tool never runs, so PostToolUse never fires and the refusal
    # would go unrecorded. Reading the log afterwards:
    #   ASKED then RAN  -> approved
    #   ASKED, no RAN   -> declined
    $LOG_DIR = "$SCRIPT_DIR\..\logs"
    if (-not (Test-Path $LOG_DIR)) {
        New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
    }
    $SESSION = "--------"
    if ($DATA.session_id) {
        $SESSION = $DATA.session_id.Substring(0, [Math]::Min(8, $DATA.session_id.Length))
    }
    $FLAT = ($COMMAND -replace "`r?`n", " ")
    $STAMP = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -Path "$LOG_DIR\$(Get-Date -Format 'yyyy-MM-dd').log" `
        -Value "$STAMP | $SESSION | ASKED   | $TOOL_NAME | $FLAT | matched=$MATCHED_PATTERN"

    $RESPONSE = @{
        hookSpecificOutput = @{
            hookEventName            = "PreToolUse"
            permissionDecision       = "ask"
            permissionDecisionReason = "Harness check: this command contains [$MATCHED_PATTERN], which is on the approval list in config/harness.config.json. Approve only if you meant to run it."
        }
    }
    $RESPONSE | ConvertTo-Json -Depth 5 -Compress
}

exit 0

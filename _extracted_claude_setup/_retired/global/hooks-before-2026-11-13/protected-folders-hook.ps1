# PreToolUse guard — blocks file edits inside protectedFolders
# in config/harness.config.json.

$INPUT_JSON = [Console]::In.ReadToEnd()

try {
    $DATA = $INPUT_JSON | ConvertFrom-Json
} catch {
    exit 0
}

$TOOL_NAME = $DATA.tool_name

$WRITE_TOOLS = @("Write", "Edit", "NotebookEdit")
if ($WRITE_TOOLS -notcontains $TOOL_NAME) { exit 0 }

$FILE_PATH = $DATA.tool_input.file_path
if (-not $FILE_PATH) { $FILE_PATH = $DATA.tool_input.notebook_path }
if (-not $FILE_PATH) { exit 0 }

$SCRIPT_DIR = Split-Path -Parent $MyInvocation.MyCommand.Path
$CONFIG     = Get-Content -Raw "$SCRIPT_DIR\..\config\harness.config.json" | ConvertFrom-Json
$PROTECTED  = $CONFIG.protectedFolders

# Compare with forward slashes so C:\x\config\y and C:/x/config/y both match.
$NORMALISED = $FILE_PATH -replace '\\', '/'

foreach ($folder in $PROTECTED) {
    $folder = ($folder -replace '\\', '/').Trim('/')

    # Match a real path segment (".../config/...") rather than the bare word,
    # so a file named my-config-notes.txt is not caught by mistake.
    if ($NORMALISED -like "*/$folder/*") {

        $LOG_DIR = "$SCRIPT_DIR\..\logs"
        if (-not (Test-Path $LOG_DIR)) {
            New-Item -ItemType Directory -Path $LOG_DIR -Force | Out-Null
        }
        $SESSION = "--------"
        if ($DATA.session_id) {
            $SESSION = $DATA.session_id.Substring(0, [Math]::Min(8, $DATA.session_id.Length))
        }
        $STAMP = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        Add-Content -Path "$LOG_DIR\$(Get-Date -Format 'yyyy-MM-dd').log" `
            -Value "$STAMP | $SESSION | BLOCKED | $TOOL_NAME | $FILE_PATH | matched=$folder/"

        $RESPONSE = @{
            hookSpecificOutput = @{
                hookEventName            = "PreToolUse"
                permissionDecision       = "deny"
                permissionDecisionReason = "Harness blocked this: [$FILE_PATH] is inside the protected folder [$folder/]. Edit it by hand if you intend to."
            }
        }
        $RESPONSE | ConvertTo-Json -Depth 5 -Compress
        exit 0
    }
}

exit 0

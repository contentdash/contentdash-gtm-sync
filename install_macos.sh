#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LAUNCH_AGENT_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENT_DIR/com.likke.contentdash.airtable-pipeline-sync.plist"
ENV_FILE="$SCRIPT_DIR/airtable_sync.env"
ENV_EXAMPLE="$SCRIPT_DIR/airtable_sync.env.example"

mkdir -p "$LAUNCH_AGENT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$ENV_EXAMPLE" ]]; then
    cp "$ENV_EXAMPLE" "$ENV_FILE"
    echo "Created $ENV_FILE from example. Fill in AIRTABLE_PAT and WEBHOOK_URL before the scheduler can run."
  else
    echo "Missing $ENV_FILE and $ENV_EXAMPLE." >&2
    exit 1
  fi
fi

source "$ENV_FILE"
if [[ -z "${AIRTABLE_PAT:-}" || -z "${WEBHOOK_URL:-}" ]]; then
  echo "Fill AIRTABLE_PAT and WEBHOOK_URL in $ENV_FILE before running install_macos.sh." >&2
  exit 1
fi

cat >"$PLIST_PATH" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.likke.contentdash.airtable-pipeline-sync</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>${SCRIPT_DIR}/run_airtable_lead_sync.sh</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>600</integer>
  <key>StandardOutPath</key>
  <string>${SCRIPT_DIR}/airtable_sync.launchd.out</string>
  <key>StandardErrorPath</key>
  <string>${SCRIPT_DIR}/airtable_sync.launchd.err</string>
</dict>
</plist>
PLIST

launchctl bootout gui/$(id -u) "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl bootstrap gui/$(id -u) "$PLIST_PATH"
launchctl kickstart -k gui/$(id -u)/com.likke.contentdash.airtable-pipeline-sync

echo "Installed launchd job: $PLIST_PATH"
echo "Edit $ENV_FILE if needed, then check $SCRIPT_DIR/airtable_sync.log"

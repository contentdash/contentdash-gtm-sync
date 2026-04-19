#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/airtable_sync.env"
PYTHON_SCRIPT="$SCRIPT_DIR/sync_airtable_leads_to_sheet.py"
LOG_FILE="$SCRIPT_DIR/airtable_sync.log"
DEFAULT_STATE_PATH="$SCRIPT_DIR/airtable_sync_state.json"

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$SCRIPT_DIR/airtable_sync.env.example" ]]; then
    cp "$SCRIPT_DIR/airtable_sync.env.example" "$ENV_FILE"
  fi
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Copy airtable_sync.env.example to airtable_sync.env and fill in AIRTABLE_PAT and WEBHOOK_URL." >&2
  exit 1
fi

source "$ENV_FILE"
if [[ -z "${AIRTABLE_PAT:-}" || -z "${WEBHOOK_URL:-}" ]]; then
  echo "AIRTABLE_PAT and WEBHOOK_URL must be set in $ENV_FILE." >&2
  exit 1
fi
STATE_PATH="${STATE_PATH:-$DEFAULT_STATE_PATH}"

{
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] starting airtable sync"
  python3 "$PYTHON_SCRIPT" \
    --airtable-pat "$AIRTABLE_PAT" \
    --webhook-url "$WEBHOOK_URL" \
    --state-path "$STATE_PATH"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] finished airtable sync"
} >> "$LOG_FILE" 2>&1

#!/bin/zsh
set -euo pipefail

if [[ $# -lt 3 ]]; then
  echo "usage: $0 <airtable_pat> <webhook_url> <state_path>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
AIRTABLE_PAT="$1"
WEBHOOK_URL="$2"
STATE_PATH="$3"

python3 "$SCRIPT_DIR/sync_airtable_leads_to_sheet.py" \
  --airtable-pat "$AIRTABLE_PAT" \
  --webhook-url "$WEBHOOK_URL" \
  --state-path "$STATE_PATH"

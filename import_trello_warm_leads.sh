#!/bin/zsh
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <trello-export.json> <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXPORT_JSON="$1"
SPREADSHEET_ID="$2"
TOKEN="$3"
WORKDIR="/tmp/contentdash-trello-import"
mkdir -p "$WORKDIR"

python3 "$SCRIPT_DIR/import_trello_warm_leads.py" "$EXPORT_JSON" >"$WORKDIR/processed.json"

python3 - <<'PY' "$WORKDIR/processed.json" "$WORKDIR/values.json"
import json
import sys

processed_path = sys.argv[1]
output_path = sys.argv[2]

with open(processed_path, "r", encoding="utf-8") as f:
    rows = json.load(f)["rows"]

payload = {
    "valueInputOption": "USER_ENTERED",
    "data": [
        {
            "range": "Pipeline Ops!A2:T200",
            "values": rows + [[""] * 20 for _ in range(max(0, 199 - len(rows)))]
        }
    ]
}

with open(output_path, "w", encoding="utf-8") as f:
    json.dump(payload, f)
PY

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Pipeline%20Ops!A2:T200:clear" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data '{}' >"$WORKDIR/clear-response.json"

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/values.json" >"$WORKDIR/update-response.json"

if jq -e '.error' "$WORKDIR/update-response.json" >/dev/null; then
  cat "$WORKDIR/update-response.json" >&2
  exit 1
fi

printf 'IMPORTED_ROWS=%s\n' "$(jq -r '.rows | length' "$WORKDIR/processed.json")"

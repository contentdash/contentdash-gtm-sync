#!/bin/zsh
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <access-token>" >&2
  exit 1
fi

TOKEN="$1"
WORKDIR="/tmp/contentdash-google-sheet"
mkdir -p "$WORKDIR"

cat >"$WORKDIR/create.json" <<'JSON'
{
  "properties": {
    "title": "Contentdash Integration Sheet"
  },
  "sheets": [
    { "properties": { "title": "Pipeline Ops" } },
    { "properties": { "title": "Call QA Log" } },
    { "properties": { "title": "Summary" } }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/create.json" >"$WORKDIR/create-response.json"

SPREADSHEET_ID="$(jq -r '.spreadsheetId // empty' "$WORKDIR/create-response.json")"
SPREADSHEET_URL="$(jq -r '.spreadsheetUrl // empty' "$WORKDIR/create-response.json")"

if [ -z "$SPREADSHEET_ID" ]; then
  cat "$WORKDIR/create-response.json" >&2
  exit 1
fi

cat >"$WORKDIR/populate.json" <<'JSON'
{
  "valueInputOption": "USER_ENTERED",
  "data": [
    {
      "range": "Pipeline Ops!A1:Y1",
      "values": [
        ["Account", "Primary Contact", "Primary Contact Role", "Company URL", "Channel", "Lead Source", "Owner", "Stage", "Value", "Reply Status", "Qualification Booked", "Discovery Booked", "Likely SKU", "Founder Needed", "Last Contact Date", "Next Step", "Next Step Date", "Last Activity Type", "Notes", "Created Date", "Days Since Last Contact", "Overdue Next Step", "Stuck Deal", "Health", "Week-to-Date Movement"]
      ]
    },
    {
      "range": "Call QA Log!A1:Q1",
      "values": [
        ["Call Date", "Account", "Contact", "Call Type", "Owner", "Stage at Call", "Outcome", "Qualified", "Founder Follow-Up Needed", "Key Pain Point", "Route / SKU Discussed", "Main Objection", "Call Score", "What Worked", "What To Improve", "Next Action", "Linked Pipeline Next Step Date"]
      ]
    },
    {
      "range": "Summary!A1:B1",
      "values": [
        ["Metric", "Value"]
      ]
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/populate.json" >"$WORKDIR/populate-response.json"

if jq -e '.error' "$WORKDIR/populate-response.json" >/dev/null; then
  cat "$WORKDIR/populate-response.json" >&2
  exit 1
fi

printf 'SPREADSHEET_ID=%s\n' "$SPREADSHEET_ID"
printf 'SPREADSHEET_URL=%s\n' "$SPREADSHEET_URL"

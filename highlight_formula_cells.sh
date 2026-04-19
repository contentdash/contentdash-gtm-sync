#!/bin/zsh
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SPREADSHEET_ID="$1"
TOKEN="$2"
WORKDIR="/tmp/contentdash-google-sheet-highlight"
mkdir -p "$WORKDIR"

curl -sS "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}" \
  -H "Authorization: Bearer $TOKEN" >"$WORKDIR/metadata.json"

PIPELINE_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Pipeline Ops") | .properties.sheetId' "$WORKDIR/metadata.json")"
SUMMARY_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Summary") | .properties.sheetId' "$WORKDIR/metadata.json")"

if [ -z "$PIPELINE_SHEET_ID" ] || [ "$PIPELINE_SHEET_ID" = "null" ]; then
  echo "Pipeline Ops tab not found" >&2
  exit 1
fi

if [ -z "$SUMMARY_SHEET_ID" ] || [ "$SUMMARY_SHEET_ID" = "null" ]; then
  echo "Summary tab not found" >&2
  exit 1
fi

cat >"$WORKDIR/highlight.json" <<JSON
{
  "requests": [
    {
      "repeatCell": {
        "range": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "startRowIndex": 1,
          "endRowIndex": 1000,
          "startColumnIndex": 20,
          "endColumnIndex": 25
        },
        "cell": {
          "userEnteredFormat": {
            "backgroundColorStyle": {
              "rgbColor": {
                "red": 0.91,
                "green": 0.95,
                "blue": 0.99
              }
            },
            "textFormat": {
              "foregroundColorStyle": {
                "rgbColor": {
                  "red": 0.2,
                  "green": 0.29,
                  "blue": 0.37
                }
              },
              "italic": true
            }
          }
        },
        "fields": "userEnteredFormat(backgroundColorStyle,textFormat)"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${SUMMARY_SHEET_ID},
          "startRowIndex": 1,
          "endRowIndex": 100,
          "startColumnIndex": 1,
          "endColumnIndex": 2
        },
        "cell": {
          "userEnteredFormat": {
            "backgroundColorStyle": {
              "rgbColor": {
                "red": 0.91,
                "green": 0.95,
                "blue": 0.99
              }
            },
            "textFormat": {
              "foregroundColorStyle": {
                "rgbColor": {
                  "red": 0.2,
                  "green": 0.29,
                  "blue": 0.37
                }
              },
              "italic": true
            }
          }
        },
        "fields": "userEnteredFormat(backgroundColorStyle,textFormat)"
      }
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/highlight.json" >"$WORKDIR/highlight-response.json"

if jq -e '.error' "$WORKDIR/highlight-response.json" >/dev/null; then
  cat "$WORKDIR/highlight-response.json" >&2
  exit 1
fi

printf 'FORMULA_HIGHLIGHT_APPLIED_TO=%s\n' "$SPREADSHEET_ID"

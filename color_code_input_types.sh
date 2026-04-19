#!/bin/zsh
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SPREADSHEET_ID="$1"
TOKEN="$2"
WORKDIR="/tmp/contentdash-google-sheet-colors"
mkdir -p "$WORKDIR"

curl -sS "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}" \
  -H "Authorization: Bearer $TOKEN" >"$WORKDIR/metadata.json"

PIPELINE_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Pipeline Ops") | .properties.sheetId' "$WORKDIR/metadata.json")"
CALL_QA_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Call QA Log") | .properties.sheetId' "$WORKDIR/metadata.json")"
SUMMARY_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Summary") | .properties.sheetId' "$WORKDIR/metadata.json")"

if [ -z "$PIPELINE_SHEET_ID" ] || [ "$PIPELINE_SHEET_ID" = "null" ]; then
  echo "Pipeline Ops tab not found" >&2
  exit 1
fi

if [ -z "$CALL_QA_SHEET_ID" ] || [ "$CALL_QA_SHEET_ID" = "null" ]; then
  echo "Call QA Log tab not found" >&2
  exit 1
fi

if [ -z "$SUMMARY_SHEET_ID" ] || [ "$SUMMARY_SHEET_ID" = "null" ]; then
  echo "Summary tab not found" >&2
  exit 1
fi

cat >"$WORKDIR/colors.json" <<JSON
{
  "requests": [
    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 0, "endColumnIndex": 20},
        "cell": {
          "userEnteredFormat": {
            "backgroundColorStyle": {"rgbColor": {"red": 1, "green": 1, "blue": 1}},
            "textFormat": {
              "foregroundColorStyle": {"rgbColor": {"red": 0.1, "green": 0.1, "blue": 0.1}},
              "italic": false
            }
          }
        },
        "fields": "userEnteredFormat(backgroundColorStyle,textFormat)"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 0, "endColumnIndex": 17},
        "cell": {
          "userEnteredFormat": {
            "backgroundColorStyle": {"rgbColor": {"red": 1, "green": 1, "blue": 1}},
            "textFormat": {
              "foregroundColorStyle": {"rgbColor": {"red": 0.1, "green": 0.1, "blue": 0.1}},
              "italic": false
            }
          }
        },
        "fields": "userEnteredFormat(backgroundColorStyle,textFormat)"
      }
    },

    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 0, "endColumnIndex": 1},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 1, "green": 0.97, "blue": 0.83}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 4, "endColumnIndex": 5},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 1, "green": 0.97, "blue": 0.83}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 6, "endColumnIndex": 17},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 1, "green": 0.97, "blue": 0.83}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 19, "endColumnIndex": 20},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 1, "green": 0.97, "blue": 0.83}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },

    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 1, "endColumnIndex": 4},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 0.96, "green": 0.96, "blue": 0.96}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 5, "endColumnIndex": 6},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 0.96, "green": 0.96, "blue": 0.96}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 17, "endColumnIndex": 19},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 0.96, "green": 0.96, "blue": 0.96}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },

    {
      "repeatCell": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 0, "endColumnIndex": 1},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 1, "green": 0.97, "blue": 0.83}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 3, "endColumnIndex": 10},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 1, "green": 0.97, "blue": 0.83}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 1, "endColumnIndex": 3},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 0.96, "green": 0.96, "blue": 0.96}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },
    {
      "repeatCell": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 1000, "startColumnIndex": 10, "endColumnIndex": 17},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 0.96, "green": 0.96, "blue": 0.96}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    },

    {
      "repeatCell": {
        "range": {"sheetId": ${SUMMARY_SHEET_ID}, "startRowIndex": 1, "endRowIndex": 100, "startColumnIndex": 0, "endColumnIndex": 1},
        "cell": {"userEnteredFormat": {"backgroundColorStyle": {"rgbColor": {"red": 0.96, "green": 0.96, "blue": 0.96}}}},
        "fields": "userEnteredFormat.backgroundColorStyle"
      }
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/colors.json" >"$WORKDIR/colors-response.json"

if jq -e '.error' "$WORKDIR/colors-response.json" >/dev/null; then
  cat "$WORKDIR/colors-response.json" >&2
  exit 1
fi

printf 'INPUT_COLORS_APPLIED_TO=%s\n' "$SPREADSHEET_ID"

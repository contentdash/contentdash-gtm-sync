#!/bin/zsh
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SPREADSHEET_ID="$1"
TOKEN="$2"
WORKDIR="/tmp/contentdash-google-sheet-finishing"
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

cat >"$WORKDIR/finishing.json" <<JSON
{
  "requests": [
    {
      "updateSheetProperties": {
        "properties": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "gridProperties": {
            "frozenRowCount": 1
          }
        },
        "fields": "gridProperties.frozenRowCount"
      }
    },
    {
      "updateSheetProperties": {
        "properties": {
          "sheetId": ${CALL_QA_SHEET_ID},
          "gridProperties": {
            "frozenRowCount": 1
          }
        },
        "fields": "gridProperties.frozenRowCount"
      }
    },
    {
      "updateSheetProperties": {
        "properties": {
          "sheetId": ${SUMMARY_SHEET_ID},
          "gridProperties": {
            "frozenRowCount": 1
          }
        },
        "fields": "gridProperties.frozenRowCount"
      }
    },
    {
      "setBasicFilter": {
        "filter": {
          "range": {
            "sheetId": ${PIPELINE_SHEET_ID},
            "startRowIndex": 0,
            "startColumnIndex": 0,
            "endColumnIndex": 25
          }
        }
      }
    },
    {
      "setBasicFilter": {
        "filter": {
          "range": {
            "sheetId": ${CALL_QA_SHEET_ID},
            "startRowIndex": 0,
            "startColumnIndex": 0,
            "endColumnIndex": 17
          }
        }
      }
    },
    {
      "autoResizeDimensions": {
        "dimensions": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "dimension": "COLUMNS",
          "startIndex": 0,
          "endIndex": 25
        }
      }
    },
    {
      "autoResizeDimensions": {
        "dimensions": {
          "sheetId": ${CALL_QA_SHEET_ID},
          "dimension": "COLUMNS",
          "startIndex": 0,
          "endIndex": 17
        }
      }
    },
    {
      "autoResizeDimensions": {
        "dimensions": {
          "sheetId": ${SUMMARY_SHEET_ID},
          "dimension": "COLUMNS",
          "startIndex": 0,
          "endIndex": 2
        }
      }
    },
    {
      "addProtectedRange": {
        "protectedRange": {
          "range": {
            "sheetId": ${PIPELINE_SHEET_ID},
            "startRowIndex": 1,
            "startColumnIndex": 20,
            "endColumnIndex": 25
          },
          "description": "Formula columns in Pipeline Ops",
          "warningOnly": true
        }
      }
    },
    {
      "addProtectedRange": {
        "protectedRange": {
          "range": {
            "sheetId": ${SUMMARY_SHEET_ID},
            "startRowIndex": 1,
            "startColumnIndex": 1,
            "endColumnIndex": 2
          },
          "description": "Formula column in Summary",
          "warningOnly": true
        }
      }
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/finishing.json" >"$WORKDIR/finishing-response.json"

if jq -e '.error' "$WORKDIR/finishing-response.json" >/dev/null; then
  cat "$WORKDIR/finishing-response.json" >&2
  exit 1
fi

printf 'FINISHING_APPLIED_TO=%s\n' "$SPREADSHEET_ID"

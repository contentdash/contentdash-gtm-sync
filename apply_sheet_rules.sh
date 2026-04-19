#!/bin/zsh
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SPREADSHEET_ID="$1"
TOKEN="$2"
WORKDIR="/tmp/contentdash-google-sheet-rules"
mkdir -p "$WORKDIR"

curl -sS "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}" \
  -H "Authorization: Bearer $TOKEN" >"$WORKDIR/metadata.json"

PIPELINE_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Pipeline Ops") | .properties.sheetId' "$WORKDIR/metadata.json")"
CALL_QA_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Call QA Log") | .properties.sheetId' "$WORKDIR/metadata.json")"

if [ -z "$PIPELINE_SHEET_ID" ] || [ "$PIPELINE_SHEET_ID" = "null" ]; then
  echo "Pipeline Ops tab not found" >&2
  exit 1
fi

if [ -z "$CALL_QA_SHEET_ID" ] || [ "$CALL_QA_SHEET_ID" = "null" ]; then
  echo "Call QA Log tab not found" >&2
  exit 1
fi

cat >"$WORKDIR/rules.json" <<JSON
{
  "requests": [
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 4, "endColumnIndex": 5},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": "Direct"}, {"userEnteredValue": "Partner"}, {"userEnteredValue": "Strategic"}]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 6, "endColumnIndex": 7},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": "Charlene"}, {"userEnteredValue": "Fleire"}]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 7, "endColumnIndex": 8},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
          {"userEnteredValue": "ICP Fit"},
          {"userEnteredValue": "Qual Booked"},
          {"userEnteredValue": "Discovery Booked"},
          {"userEnteredValue": "Routed + Pitched"},
          {"userEnteredValue": "Proposal Out"},
          {"userEnteredValue": "Multi-Threaded"},
          {"userEnteredValue": "Contract Signed"},
          {"userEnteredValue": "Kickoff / Won"},
          {"userEnteredValue": "Closed Lost"}
        ]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 9, "endColumnIndex": 10},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
          {"userEnteredValue": "No Reply"},
          {"userEnteredValue": "Wants Info"},
          {"userEnteredValue": "Interested"},
          {"userEnteredValue": "Not Now"},
          {"userEnteredValue": "Referred"},
          {"userEnteredValue": "Dead"},
          {"userEnteredValue": "Follow-Up Sent"}
        ]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 10, "endColumnIndex": 12},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": "Y"}, {"userEnteredValue": "N"}]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 12, "endColumnIndex": 13},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
          {"userEnteredValue": "Unlimited Copies"},
          {"userEnteredValue": "Unlimited Graphics"},
          {"userEnteredValue": "Unlimited Content"},
          {"userEnteredValue": "Social Media Growth Pack"},
          {"userEnteredValue": "BOSS"},
          {"userEnteredValue": "Performance & Search"},
          {"userEnteredValue": "Brand Rules + QA Layer"},
          {"userEnteredValue": "Video Repurposing"},
          {"userEnteredValue": "Consultation"},
          {"userEnteredValue": "Unsure"}
        ]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 13, "endColumnIndex": 14},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": "Y"}, {"userEnteredValue": "N"}]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 17, "endColumnIndex": 18},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
          {"userEnteredValue": "Email"},
          {"userEnteredValue": "LinkedIn"},
          {"userEnteredValue": "Call"},
          {"userEnteredValue": "Meeting"},
          {"userEnteredValue": "Partner Intro"},
          {"userEnteredValue": "WhatsApp"},
          {"userEnteredValue": "Other"}
        ]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 3, "endColumnIndex": 4},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
          {"userEnteredValue": "Qualification"},
          {"userEnteredValue": "Discovery"},
          {"userEnteredValue": "Follow-Up"},
          {"userEnteredValue": "Founder Call"},
          {"userEnteredValue": "Close / Commercial"}
        ]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 4, "endColumnIndex": 5},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": "Charlene"}, {"userEnteredValue": "Fleire"}]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 5, "endColumnIndex": 6},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
          {"userEnteredValue": "ICP Fit"},
          {"userEnteredValue": "Qual Booked"},
          {"userEnteredValue": "Discovery Booked"},
          {"userEnteredValue": "Routed + Pitched"},
          {"userEnteredValue": "Proposal Out"},
          {"userEnteredValue": "Multi-Threaded"},
          {"userEnteredValue": "Contract Signed"},
          {"userEnteredValue": "Kickoff / Won"},
          {"userEnteredValue": "Closed Lost"}
        ]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 6, "endColumnIndex": 7},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [
          {"userEnteredValue": "Strong Fit"},
          {"userEnteredValue": "Possible Fit"},
          {"userEnteredValue": "Poor Fit"},
          {"userEnteredValue": "No Show"},
          {"userEnteredValue": "Follow-Up Needed"}
        ]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 7, "endColumnIndex": 9},
        "rule": {"condition": {"type": "ONE_OF_LIST", "values": [{"userEnteredValue": "Y"}, {"userEnteredValue": "N"}]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "setDataValidation": {
        "range": {"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 12, "endColumnIndex": 13},
        "rule": {"condition": {"type": "NUMBER_BETWEEN", "values": [{"userEnteredValue": "0"}, {"userEnteredValue": "100"}]}, "showCustomUi": true, "strict": true}
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 25}],
          "booleanRule": {
            "condition": {"type": "CUSTOM_FORMULA", "values": [{"userEnteredValue": "=\$V2=\"Y\""}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 0.98, "green": 0.86, "blue": 0.86}}}
          }
        },
        "index": 0
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 0, "endColumnIndex": 25}],
          "booleanRule": {
            "condition": {"type": "CUSTOM_FORMULA", "values": [{"userEnteredValue": "=\$W2=\"Y\""}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 1.0, "green": 0.95, "blue": 0.8}}}
          }
        },
        "index": 1
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 23, "endColumnIndex": 24}],
          "booleanRule": {
            "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": "Green"}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 0.85, "green": 0.94, "blue": 0.84}}}
          }
        },
        "index": 2
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 16, "endColumnIndex": 17}],
          "booleanRule": {
            "condition": {"type": "DATE_BEFORE", "values": [{"relativeDate": "TODAY"}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 0.98, "green": 0.86, "blue": 0.86}}}
          }
        },
        "index": 3
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${PIPELINE_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 13, "endColumnIndex": 14}],
          "booleanRule": {
            "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": "Y"}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 0.99, "green": 0.92, "blue": 0.75}}, "textFormat": {"bold": true}}
          }
        },
        "index": 4
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 12, "endColumnIndex": 13}],
          "booleanRule": {
            "condition": {"type": "NUMBER_LESS_THAN_EQ", "values": [{"userEnteredValue": "40"}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 0.98, "green": 0.86, "blue": 0.86}}}
          }
        },
        "index": 0
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 8, "endColumnIndex": 9}],
          "booleanRule": {
            "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": "Y"}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 1.0, "green": 0.95, "blue": 0.8}}}
          }
        },
        "index": 1
      }
    },
    {
      "addConditionalFormatRule": {
        "rule": {
          "ranges": [{"sheetId": ${CALL_QA_SHEET_ID}, "startRowIndex": 1, "startColumnIndex": 7, "endColumnIndex": 8}],
          "booleanRule": {
            "condition": {"type": "TEXT_EQ", "values": [{"userEnteredValue": "Y"}]},
            "format": {"backgroundColorStyle": {"rgbColor": {"red": 0.85, "green": 0.94, "blue": 0.84}}}
          }
        },
        "index": 2
      }
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/rules.json" >"$WORKDIR/rules-response.json"

if jq -e '.error' "$WORKDIR/rules-response.json" >/dev/null; then
  cat "$WORKDIR/rules-response.json" >&2
  exit 1
fi

printf 'RULES_APPLIED_TO=%s\n' "$SPREADSHEET_ID"

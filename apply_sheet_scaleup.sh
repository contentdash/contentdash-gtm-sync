#!/bin/zsh
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SPREADSHEET_ID="$1"
TOKEN="$2"
WORKDIR="/tmp/contentdash-google-sheet-scaleup"
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

cat >"$WORKDIR/scaleup.json" <<JSON
{
  "requests": [
    {
      "repeatCell": {
        "range": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "startRowIndex": 0,
          "endRowIndex": 1,
          "startColumnIndex": 0,
          "endColumnIndex": 25
        },
        "cell": {
          "userEnteredFormat": {
            "backgroundColorStyle": {
              "rgbColor": {
                "red": 0.09,
                "green": 0.27,
                "blue": 0.38
              }
            },
            "horizontalAlignment": "CENTER",
            "textFormat": {
              "foregroundColorStyle": {
                "rgbColor": {
                  "red": 1,
                  "green": 1,
                  "blue": 1
                }
              },
              "bold": true
            }
          }
        },
        "fields": "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${CALL_QA_SHEET_ID},
          "startRowIndex": 0,
          "endRowIndex": 1,
          "startColumnIndex": 0,
          "endColumnIndex": 17
        },
        "cell": {
          "userEnteredFormat": {
            "backgroundColorStyle": {
              "rgbColor": {
                "red": 0.3,
                "green": 0.21,
                "blue": 0.4
              }
            },
            "horizontalAlignment": "CENTER",
            "textFormat": {
              "foregroundColorStyle": {
                "rgbColor": {
                  "red": 1,
                  "green": 1,
                  "blue": 1
                }
              },
              "bold": true
            }
          }
        },
        "fields": "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${SUMMARY_SHEET_ID},
          "startRowIndex": 0,
          "endRowIndex": 1,
          "startColumnIndex": 0,
          "endColumnIndex": 2
        },
        "cell": {
          "userEnteredFormat": {
            "backgroundColorStyle": {
              "rgbColor": {
                "red": 0.12,
                "green": 0.38,
                "blue": 0.26
              }
            },
            "horizontalAlignment": "CENTER",
            "textFormat": {
              "foregroundColorStyle": {
                "rgbColor": {
                  "red": 1,
                  "green": 1,
                  "blue": 1
                }
              },
              "bold": true
            }
          }
        },
        "fields": "userEnteredFormat(backgroundColorStyle,textFormat,horizontalAlignment)"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "startRowIndex": 1,
          "endRowIndex": 501,
          "startColumnIndex": 20,
          "endColumnIndex": 21
        },
        "cell": {
          "userEnteredValue": {
            "formulaValue": "=IF(O2=\"\",\"\",TODAY()-O2)"
          }
        },
        "fields": "userEnteredValue"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "startRowIndex": 1,
          "endRowIndex": 501,
          "startColumnIndex": 21,
          "endColumnIndex": 22
        },
        "cell": {
          "userEnteredValue": {
            "formulaValue": "=IF(OR(Q2=\"\",H2=\"Kickoff / Won\",H2=\"Closed Lost\"),\"\",IF(Q2<TODAY(),\"Y\",\"N\"))"
          }
        },
        "fields": "userEnteredValue"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "startRowIndex": 1,
          "endRowIndex": 501,
          "startColumnIndex": 22,
          "endColumnIndex": 23
        },
        "cell": {
          "userEnteredValue": {
            "formulaValue": "=IF(OR(H2=\"Kickoff / Won\",H2=\"Closed Lost\"),\"\",IF(OR(TODAY()-O2>=7,AND(Q2<>\"\",TODAY()-Q2>=3)),\"Y\",\"N\"))"
          }
        },
        "fields": "userEnteredValue"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "startRowIndex": 1,
          "endRowIndex": 501,
          "startColumnIndex": 23,
          "endColumnIndex": 24
        },
        "cell": {
          "userEnteredValue": {
            "formulaValue": "=IF(OR(H2=\"Kickoff / Won\",H2=\"Closed Lost\"),\"\",IF(AND(W2=\"N\",V2=\"N\",N2=\"N\"),\"Green\",IF(AND(W2=\"N\",V2=\"N\",N2=\"Y\"),\"Amber\",\"Red\")))"
          }
        },
        "fields": "userEnteredValue"
      }
    },
    {
      "repeatCell": {
        "range": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "startRowIndex": 1,
          "endRowIndex": 501,
          "startColumnIndex": 24,
          "endColumnIndex": 25
        },
        "cell": {
          "userEnteredValue": {
            "formulaValue": "=IF(O2=\"\",\"\",IF(O2>=TODAY()-WEEKDAY(TODAY(),2)+1,\"Moved WTD\",\"No WTD Movement\"))"
          }
        },
        "fields": "userEnteredValue"
      }
    },
    {
      "addFilterView": {
        "filter": {
          "title": "Charlene View",
          "range": {
            "sheetId": ${PIPELINE_SHEET_ID},
            "startRowIndex": 0,
            "startColumnIndex": 0,
            "endColumnIndex": 25
          },
          "criteria": {
            "6": {
              "condition": {
                "type": "TEXT_EQ",
                "values": [
                  {"userEnteredValue": "Charlene"}
                ]
              }
            }
          }
        }
      }
    },
    {
      "addFilterView": {
        "filter": {
          "title": "Fleire View",
          "range": {
            "sheetId": ${PIPELINE_SHEET_ID},
            "startRowIndex": 0,
            "startColumnIndex": 0,
            "endColumnIndex": 25
          },
          "criteria": {
            "6": {
              "condition": {
                "type": "TEXT_EQ",
                "values": [
                  {"userEnteredValue": "Fleire"}
                ]
              }
            }
          }
        }
      }
    },
    {
      "addFilterView": {
        "filter": {
          "title": "Overdue View",
          "range": {
            "sheetId": ${PIPELINE_SHEET_ID},
            "startRowIndex": 0,
            "startColumnIndex": 0,
            "endColumnIndex": 25
          },
          "criteria": {
            "21": {
              "condition": {
                "type": "TEXT_EQ",
                "values": [
                  {"userEnteredValue": "Y"}
                ]
              }
            }
          }
        }
      }
    },
    {
      "addProtectedRange": {
        "protectedRange": {
          "range": {
            "sheetId": ${PIPELINE_SHEET_ID},
            "startRowIndex": 1,
            "endRowIndex": 1000,
            "startColumnIndex": 20,
            "endColumnIndex": 25
          },
          "description": "Pipeline Ops formula area",
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
            "endRowIndex": 50,
            "startColumnIndex": 1,
            "endColumnIndex": 2
          },
          "description": "Summary formula area",
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
  --data @"$WORKDIR/scaleup.json" >"$WORKDIR/scaleup-response.json"

if jq -e '.error' "$WORKDIR/scaleup-response.json" >/dev/null; then
  cat "$WORKDIR/scaleup-response.json" >&2
  exit 1
fi

cat >"$WORKDIR/summary-values.json" <<'JSON'
{
  "valueInputOption": "USER_ENTERED",
  "data": [
    {
      "range": "Summary!A1:B12",
      "values": [
        ["Metric","Value"],
        ["Active Pipeline","=COUNTIFS('Pipeline Ops'!H2:H,\"<>\",'Pipeline Ops'!H2:H,\"<>Kickoff / Won\",'Pipeline Ops'!H2:H,\"<>Closed Lost\")"],
        ["Open Value","=SUMIFS('Pipeline Ops'!I2:I,'Pipeline Ops'!H2:H,\"<>Kickoff / Won\",'Pipeline Ops'!H2:H,\"<>Closed Lost\")"],
        ["Overdue Next Steps","=COUNTIF('Pipeline Ops'!V2:V,\"Y\")"],
        ["Stuck Deals","=COUNTIF('Pipeline Ops'!W2:W,\"Y\")"],
        ["Founder Needed","=COUNTIF('Pipeline Ops'!N2:N,\"Y\")"],
        ["Moved WTD","=COUNTIF('Pipeline Ops'!Y2:Y,\"Moved WTD\")"],
        ["Charlene Owned","=COUNTIF('Pipeline Ops'!G2:G,\"Charlene\")"],
        ["Fleire Owned","=COUNTIF('Pipeline Ops'!G2:G,\"Fleire\")"],
        ["Discovery Booked","=COUNTIFS('Pipeline Ops'!H2:H,\"Discovery Booked\")"],
        ["Proposal Out","=COUNTIFS('Pipeline Ops'!H2:H,\"Proposal Out\")"],
        ["Won","=COUNTIFS('Pipeline Ops'!H2:H,\"Kickoff / Won\")"]
      ]
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/summary-values.json" >"$WORKDIR/summary-values-response.json"

if jq -e '.error' "$WORKDIR/summary-values-response.json" >/dev/null; then
  cat "$WORKDIR/summary-values-response.json" >&2
  exit 1
fi

printf 'SCALEUP_APPLIED_TO=%s\n' "$SPREADSHEET_ID"

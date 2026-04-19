#!/bin/zsh
set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <spreadsheet-id> <access-token>" >&2
  exit 1
fi

SPREADSHEET_ID="$1"
TOKEN="$2"
WORKDIR="/tmp/contentdash-google-sheet-update"
mkdir -p "$WORKDIR"

curl -sS "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}" \
  -H "Authorization: Bearer $TOKEN" >"$WORKDIR/metadata.json"

PIPELINE_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Pipeline") | .properties.sheetId' "$WORKDIR/metadata.json" || true)"
PIPELINE_OPS_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Pipeline Ops") | .properties.sheetId' "$WORKDIR/metadata.json" || true)"
PILOT_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Pilot") | .properties.sheetId' "$WORKDIR/metadata.json" || true)"
CALL_QA_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Call QA Log") | .properties.sheetId' "$WORKDIR/metadata.json" || true)"
SUMMARY_SHEET_ID="$(jq -r '.sheets[] | select(.properties.title=="Summary") | .properties.sheetId' "$WORKDIR/metadata.json" || true)"

if [ -n "$PIPELINE_OPS_SHEET_ID" ] && [ "$PIPELINE_OPS_SHEET_ID" != "null" ]; then
  PIPELINE_SHEET_ID="$PIPELINE_OPS_SHEET_ID"
fi

if [ -z "$PIPELINE_SHEET_ID" ] || [ "$PIPELINE_SHEET_ID" = "null" ]; then
  echo "Pipeline tab not found" >&2
  exit 1
fi

cat >"$WORKDIR/rename-pipeline.json" <<JSON
{
  "requests": [
    {
      "updateSheetProperties": {
        "properties": {
          "sheetId": ${PIPELINE_SHEET_ID},
          "title": "Pipeline Ops"
        },
        "fields": "title"
      }
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/rename-pipeline.json" >"$WORKDIR/rename-pipeline-response.json"

if [ -n "${PILOT_SHEET_ID}" ] && [ "${PILOT_SHEET_ID}" != "null" ]; then
  cat >"$WORKDIR/rename-call-qa.json" <<JSON
{
  "requests": [
    {
      "updateSheetProperties": {
        "properties": {
          "sheetId": ${PILOT_SHEET_ID},
          "title": "Call QA Log"
        },
        "fields": "title"
      }
    }
  ]
}
JSON

  curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data @"$WORKDIR/rename-call-qa.json" >"$WORKDIR/rename-call-qa-response.json"
fi

if [ -z "${SUMMARY_SHEET_ID}" ] || [ "${SUMMARY_SHEET_ID}" = "null" ]; then
  cat >"$WORKDIR/add-summary.json" <<'JSON'
{
  "requests": [
    {
      "addSheet": {
        "properties": {
          "title": "Summary"
        }
      }
    }
  ]
}
JSON

  curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}:batchUpdate" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    --data @"$WORKDIR/add-summary.json" >"$WORKDIR/add-summary-response.json"
fi

curl -sS "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}" \
  -H "Authorization: Bearer $TOKEN" >"$WORKDIR/metadata-final.json"

PIPELINE_OPS_TITLE="Pipeline Ops"
CALL_QA_TITLE="Call QA Log"

cat >"$WORKDIR/values-update.json" <<'JSON'
{
  "valueInputOption": "USER_ENTERED",
  "data": [
    {
      "range": "Pipeline Ops!A1:Y6",
      "values": [
        ["Account","Primary Contact","Primary Contact Role","Company URL","Channel","Lead Source","Owner","Stage","Value","Reply Status","Qualification Booked","Discovery Booked","Likely SKU","Founder Needed","Last Contact Date","Next Step","Next Step Date","Last Activity Type","Notes","Created Date","Days Since Last Contact","Overdue Next Step","Stuck Deal","Health","Week-to-Date Movement"],
        ["Acme Labs","Nina Tan","Founder","https://acmelabs.example","Direct","","Charlene","ICP Fit",12000,"No Reply","N","N","Unsure","Y","2026-04-15","Send intro follow-up","2026-04-22","Email","Imported starter row","2026-04-19","=IF(O2=\"\",\"\",TODAY()-O2)","=IF(OR(Q2=\"\",H2=\"Kickoff / Won\",H2=\"Closed Lost\"),\"\",IF(Q2<TODAY(),\"Y\",\"N\"))","=IF(OR(H2=\"Kickoff / Won\",H2=\"Closed Lost\"),\"\",IF(OR(TODAY()-O2>=7,AND(Q2<>\"\",TODAY()-Q2>=3)),\"Y\",\"N\"))","=IF(OR(H2=\"Kickoff / Won\",H2=\"Closed Lost\"),\"\", IF(AND(W2=\"N\",V2=\"N\",N2=\"N\"),\"Green\", IF(AND(W2=\"N\",V2=\"N\",N2=\"Y\"),\"Amber\", \"Red\")))","=IF(O2=\"\",\"\",IF(O2>=TODAY()-WEEKDAY(TODAY(),2)+1,\"Moved WTD\",\"No WTD Movement\"))"],
        ["Northstar Health","Marco Lee","Marketing Lead","https://northstar.example","Partner","","Charlene","Qual Booked",25000,"Interested","Y","N","Consultation","N","2026-04-17","Prepare qualification notes","2026-04-23","Call","Imported starter row","2026-04-19","=IF(O3=\"\",\"\",TODAY()-O3)","=IF(OR(Q3=\"\",H3=\"Kickoff / Won\",H3=\"Closed Lost\"),\"\",IF(Q3<TODAY(),\"Y\",\"N\"))","=IF(OR(H3=\"Kickoff / Won\",H3=\"Closed Lost\"),\"\",IF(OR(TODAY()-O3>=7,AND(Q3<>\"\",TODAY()-Q3>=3)),\"Y\",\"N\"))","=IF(OR(H3=\"Kickoff / Won\",H3=\"Closed Lost\"),\"\", IF(AND(W3=\"N\",V3=\"N\",N3=\"N\"),\"Green\", IF(AND(W3=\"N\",V3=\"N\",N3=\"Y\"),\"Amber\", \"Red\")))","=IF(O3=\"\",\"\",IF(O3>=TODAY()-WEEKDAY(TODAY(),2)+1,\"Moved WTD\",\"No WTD Movement\"))"],
        ["Orbit Commerce","Sarah Lim","CMO","https://orbit.example","Strategic","","Fleire","Discovery Booked",40000,"Wants Info","Y","Y","Unlimited Content","Y","2026-04-18","Join discovery call","2026-04-24","Meeting","Imported starter row","2026-04-19","=IF(O4=\"\",\"\",TODAY()-O4)","=IF(OR(Q4=\"\",H4=\"Kickoff / Won\",H4=\"Closed Lost\"),\"\",IF(Q4<TODAY(),\"Y\",\"N\"))","=IF(OR(H4=\"Kickoff / Won\",H4=\"Closed Lost\"),\"\",IF(OR(TODAY()-O4>=7,AND(Q4<>\"\",TODAY()-Q4>=3)),\"Y\",\"N\"))","=IF(OR(H4=\"Kickoff / Won\",H4=\"Closed Lost\"),\"\", IF(AND(W4=\"N\",V4=\"N\",N4=\"N\"),\"Green\", IF(AND(W4=\"N\",V4=\"N\",N4=\"Y\"),\"Amber\", \"Red\")))","=IF(O4=\"\",\"\",IF(O4>=TODAY()-WEEKDAY(TODAY(),2)+1,\"Moved WTD\",\"No WTD Movement\"))"],
        ["","","","","","","","","","","","","","","","","","","","","=IF(O5=\"\",\"\",TODAY()-O5)","=IF(OR(Q5=\"\",H5=\"Kickoff / Won\",H5=\"Closed Lost\"),\"\",IF(Q5<TODAY(),\"Y\",\"N\"))","=IF(OR(H5=\"Kickoff / Won\",H5=\"Closed Lost\"),\"\",IF(OR(TODAY()-O5>=7,AND(Q5<>\"\",TODAY()-Q5>=3)),\"Y\",\"N\"))","=IF(OR(H5=\"Kickoff / Won\",H5=\"Closed Lost\"),\"\", IF(AND(W5=\"N\",V5=\"N\",N5=\"N\"),\"Green\", IF(AND(W5=\"N\",V5=\"N\",N5=\"Y\"),\"Amber\", \"Red\")))","=IF(O5=\"\",\"\",IF(O5>=TODAY()-WEEKDAY(TODAY(),2)+1,\"Moved WTD\",\"No WTD Movement\"))"],
        ["","","","","","","","","","","","","","","","","","","","","=IF(O6=\"\",\"\",TODAY()-O6)","=IF(OR(Q6=\"\",H6=\"Kickoff / Won\",H6=\"Closed Lost\"),\"\",IF(Q6<TODAY(),\"Y\",\"N\"))","=IF(OR(H6=\"Kickoff / Won\",H6=\"Closed Lost\"),\"\",IF(OR(TODAY()-O6>=7,AND(Q6<>\"\",TODAY()-Q6>=3)),\"Y\",\"N\"))","=IF(OR(H6=\"Kickoff / Won\",H6=\"Closed Lost\"),\"\", IF(AND(W6=\"N\",V6=\"N\",N6=\"N\"),\"Green\", IF(AND(W6=\"N\",V6=\"N\",N6=\"Y\"),\"Amber\", \"Red\")))","=IF(O6=\"\",\"\",IF(O6>=TODAY()-WEEKDAY(TODAY(),2)+1,\"Moved WTD\",\"No WTD Movement\"))"]
      ]
    },
    {
      "range": "Call QA Log!A1:Q4",
      "values": [
        ["Call Date","Account","Contact","Call Type","Owner","Stage at Call","Outcome","Qualified","Founder Follow-Up Needed","Key Pain Point","Route / SKU Discussed","Main Objection","Call Score","What Worked","What To Improve","Next Action","Linked Pipeline Next Step Date"],
        ["2026-04-18","Northstar Health","Marco Lee","Qualification","Charlene","Qual Booked","Possible Fit","Y","N","Reporting is manual and slow","Consultation","Budget timing",72,"Good discovery questions","Tighten commercial framing","Send recap","2026-04-23"],
        ["2026-04-18","Orbit Commerce","Sarah Lim","Discovery","Fleire","Discovery Booked","Strong Fit","Y","Y","Needs faster content throughput","Unlimited Content","Concern about onboarding",84,"Strong positioning","Clarify delivery process","Follow up with examples","2026-04-24"],
        ["","","","","","","","","","","","","","","","",""]
      ]
    },
    {
      "range": "Summary!A1:B8",
      "values": [
        ["Metric","Value"],
        ["Active Deals","=COUNTIF('Pipeline Ops'!H2:H,\"<>Kickoff / Won\")-COUNTIF('Pipeline Ops'!H2:H,\"Closed Lost\")"],
        ["Overdue Next Steps","=COUNTIF('Pipeline Ops'!V2:V,\"Y\")"],
        ["Stuck Deals","=COUNTIF('Pipeline Ops'!W2:W,\"Y\")"],
        ["Founder Needed","=COUNTIF('Pipeline Ops'!N2:N,\"Y\")"],
        ["Discovery Booked","=COUNTIF('Pipeline Ops'!L2:L,\"Y\")"],
        ["Moved WTD","=COUNTIF('Pipeline Ops'!Y2:Y,\"Moved WTD\")"],
        ["Open Value","=SUMIFS('Pipeline Ops'!I2:I,'Pipeline Ops'!H2:H,\"<>Kickoff / Won\",'Pipeline Ops'!H2:H,\"<>Closed Lost\")"]
      ]
    }
  ]
}
JSON

curl -sS -X POST "https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values:batchUpdate" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @"$WORKDIR/values-update.json" >"$WORKDIR/values-update-response.json"

if jq -e '.error' "$WORKDIR/values-update-response.json" >/dev/null; then
  cat "$WORKDIR/values-update-response.json" >&2
  exit 1
fi

printf 'UPDATED_SPREADSHEET_ID=%s\n' "$SPREADSHEET_ID"

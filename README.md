Contentdash GTM Sync

This repo packages the Airtable-to-Google-Sheets automation used for DashoContent GTM operations.

It includes:
- Google Sheet bootstrap and formatting scripts
- Airtable ingest and enrichment scripts
- Google Apps Script webhook receiver
- Mac launchd installer for automatic Airtable backfill/sync
- templates and example configuration

Current sheet structure:
- `Pipeline Ops`
- `Call QA Log`
- `Summary`

Portable install flow:
1. Clone this repo on the target Mac.
2. Copy `airtable_sync.env.example` to `airtable_sync.env`.
3. Fill `AIRTABLE_PAT` and `WEBHOOK_URL` in `airtable_sync.env`.
4. Deploy `airtable_pipeline_webhook.gs` inside the target Google Sheet as a web app.
5. Run `./install_macos.sh` to install the 10-minute Airtable sync job.

One-time Google Sheet bootstrap:
- `create_sheet.sh` creates the current sheet tabs and header rows.
- `update_sheet_structure.sh`, `apply_sheet_rules.sh`, `apply_sheet_finishing.sh`, `apply_sheet_scaleup.sh`, `highlight_formula_cells.sh`, and `color_code_input_types.sh` apply the layout, formulas, protection, and visual treatment.

Data sync flow:
- Airtable intake records are pulled from base `appdOhglYCp56PrrY`
- Records are upserted into `Pipeline Ops` by Airtable `recordId`
- New inbound records default to `Owner = Charlene`
- Empty placeholder Airtable records are ignored

Legacy files:
- `Pipeline.csv` and `Pilot.csv` are kept as historical bootstrap artifacts
- They are not the current operating schema

Secrets and local state:
- `airtable_sync.env`
- `airtable_sync_state.json`
- `airtable_sync.log`
- `contentdash-sheets-key.json`
- launchd output files
are intentionally ignored by git.

# GitHub Secrets Setup

Go to: https://github.com/contentdash/dasho-ops/settings/secrets/actions
Click "New repository secret" for each:

| Secret Name | Value | Where to get it |
|---|---|---|
| `STRIPE_SECRET_KEY` | `rk_live_51JZ9u3...` | Already in local .env |
| `XERO_CLIENT_ID` | `5744D250...` | Already in local .env |
| `XERO_CLIENT_SECRET` | `6xIc8hw3...` | Already in local .env |
| `XERO_REDIRECT_URI` | `http://localhost:3333/callback` | Already in local .env |
| `XERO_TOKENS_JSON` | *(paste full contents of `~/Projects/xero-datapull/tokens.json` after running auth)* | Run `npm run auth` in xero-datapull first |
| `EMAIL_FLEIRE` | `info@contentdash.app` | — |
| `GMAIL_USER` | `info@contentdash.app` | — |
| `GMAIL_APP_PASSWORD` | *(16-char app password)* | myaccount.google.com → Security → App passwords |
| `APPS_SCRIPT_URL` | *(web app URL)* | Google Sheet → Extensions → Apps Script → Deploy → Manage deployments → copy URL |
| `APPS_SCRIPT_TOKEN` | *(same as PIPELINE_WEBHOOK_TOKEN in Script Properties)* | Apps Script Project Settings → Script properties |
| `AIRTABLE_PAT` | `patpgiPYbDrouIY7N...` | Already known |
| `SLACK_WEBHOOK_URL` | *(Incoming Webhook URL for #core-ops)* | https://api.slack.com/messaging/webhooks — create app, enable Incoming Webhooks, add to #core-ops, copy URL |

**Deprecated** (2026-05-15): `EMAIL_CHARLENE` no longer used — Charlene's transition to Ops & Account Lead (2026-06-01) moves all GTM/MRR notifications to Slack `#core-ops` via `SLACK_WEBHOOK_URL`. Safe to delete from GH secrets.

## Gmail App Password (one-time setup)
1. Go to myaccount.google.com
2. Security → 2-Step Verification → scroll to App passwords
3. Create: name it "DashoContent Ops"
4. Copy the 16-character password (shown once)
5. Add as GMAIL_APP_PASSWORD secret above

## Apps Script — Pipeline Read Endpoint (one-time setup)
The `airtable_pipeline_webhook.gs` file now includes a `doGet` handler for reading pipeline data.

1. Open the Google Sheet → Extensions → Apps Script
2. Replace the existing script with the updated `airtable_pipeline_webhook.gs`
3. Deploy → New deployment (or update existing) → Web app
   - Execute as: Me
   - Who has access: Anyone with the link
4. Copy the deployment URL → add as `APPS_SCRIPT_URL` secret
5. Project Settings → Script properties → copy `PIPELINE_WEBHOOK_TOKEN` value → add as `APPS_SCRIPT_TOKEN` secret

## Xero Tokens (refresh every ~60 days)
After running `cd ~/Projects/xero-datapull && npm run auth`:
1. `cat ~/Projects/xero-datapull/tokens.json`
2. Copy the entire JSON
3. Update the XERO_TOKENS_JSON secret in GitHub

## Testing workflows manually
After pushing, go to:
https://github.com/contentdash/dasho-ops/actions
Click any workflow → "Run workflow" to test immediately.

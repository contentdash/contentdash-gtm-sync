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
| `EMAIL_CHARLENE` | `cvirlouvet@contentdash.app` | — |
| `GMAIL_USER` | `info@contentdash.app` | — |
| `GMAIL_APP_PASSWORD` | *(16-char app password)* | myaccount.google.com → Security → App passwords |

## Gmail App Password (one-time setup)
1. Go to myaccount.google.com
2. Security → 2-Step Verification → scroll to App passwords
3. Create: name it "DashoContent Ops"
4. Copy the 16-character password (shown once)
5. Add as GMAIL_APP_PASSWORD secret above

## Xero Tokens (refresh every ~60 days)
After running `cd ~/Projects/xero-datapull && npm run auth`:
1. `cat ~/Projects/xero-datapull/tokens.json`
2. Copy the entire JSON
3. Update the XERO_TOKENS_JSON secret in GitHub

## Testing workflows manually
After pushing, go to:
https://github.com/contentdash/dasho-ops/actions
Click any workflow → "Run workflow" to test immediately.

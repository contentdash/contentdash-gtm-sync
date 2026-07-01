# DashoContent Outreach — Lead Sourcing Playbook

This is the procedure the scheduled sourcing agent (and any human) follows to
replenish `lead_backlog.csv` so the outreach never runs dry. The weekly
`outreach-refill.yml` job promotes backlog leads into `enriched.csv` when the
active list runs low.

## ICP (who to source)
Philippines-based organisations that need constant on-brand marketing content:
1. **Marketing / advertising / creative / digital / social agencies** (segment `agency`)
2. **Beauty / cosmetics / skincare / personal-care / FMCG consumer brands** (segment `content-team`)
3. **Retail / F&B / hospitality / wellness / consumer-services companies with a marketing team** (segment `content-team`)

Skip: pure heavy-industry/B2B commodity with no brand presence; global multinationals with no local marketing autonomy.

## Procedure (target: ~40 NEW companies per run)
1. `git pull`. Read `enriched.csv` and `lead_backlog.csv` — collect existing company names + email domains to **dedupe** (never re-source a company already present).
2. Pull member/company lists from the directories below. For each candidate company, **fetch its website to confirm it loads and is PH-based** — only keep verified ones.
3. For each verified company, find ONE named **marketing decision-maker** (Head of Marketing / Marketing Director / CMO / Brand Manager; else Founder / CEO / MD / Owner). Construct their email as `firstname@<company-email-domain>` (lowercase, no accents). Prefer a real email if visible on the site.
4. **Strict email hygiene** (critical — the raw scrape grabs junk): the email domain MUST match the company's own website domain. Reject anything with image extensions (`.png/.webp/@2x`), placeholder domains (`example.com`, `company.com`, `info.com`), telemetry (`sentry.io`), or third-party vendors. `enrich_new.py` enforces this — prefer running new company+website rows through it.
5. Append rows to `lead_backlog.csv` (columns: `email,company,contact_name,role,segment,company_url,notes,source`; source = `scheduled-sourcing-YYYY-MM`).
6. `git add outreach/lead_backlog.csv && git commit -m "chore: replenish outreach lead backlog [skip ci]" && git push`.
7. Post a Slack summary via `SLACK_WEBHOOK_URL`: how many added, backlog total, any directories exhausted.

## Directory sources (rotate through these; note which are tapped out)
**Agencies**
- 4As Philippines members: https://4asphilippines.com/member-agencies/  (highest yield)
- Ad Standards Council members: https://asc.com.ph/our-members/
- Clutch PH: https://clutch.co/ph/agencies/digital-marketing · /creative · /digital
- Sortlist PH: https://www.sortlist.com/social-media/philippines-ph
- DesignRush PH: https://www.designrush.com/agency/ad-agencies/ph · /digital-marketing/ph
- Outsource Accelerator "Top advertising/social agencies PH" guides; GoodFirms PH

**Beauty / CPG brands**
- Chamber of Cosmetics Industry of the PH (CCIP): https://cciphilippinesinc.com/
- ASEAN Cosmetics Association members: https://aseancosmetics.org/members/list-of-members/
- Editorial lists: Preview.ph, Tatler Asia, Philippine Primer, The Beauty Edit, Shopee blog, Lifestyle Asia "homegrown brands"

**Chambers / consumer companies**
- AmCham PH corporate directory: https://amchamphilippines.com/membership/corporate-membership-directory/  (page A–Z)
- Philippine Franchise Association members: https://www.pfa.org.ph/members  (paginated)
- ECCP members: https://www.eccp.com/members-directory  (JS-rendered — needs a headless browser)
- Management Assoc. of the PH: https://map.org.ph/resource/map-list-of-members-2/
- Cebu Chamber (regional): https://cebuchamber.org/

## Cadence
Consumption ≈ 24 first-emails/week (8/run × Tue–Thu). Run this ~every 2 weeks so
supply keeps pace. Keep `lead_backlog.csv` at 30+ so the weekly refill always has stock.

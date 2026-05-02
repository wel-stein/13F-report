# 13F-report

Tools for tracking what the largest US institutional investors are buying and
selling, based on their quarterly **SEC Form 13F-HR** filings.

The repo has two cooperating pieces:

1. **Skill** at [`.claude/skills/13f-report/`](.claude/skills/13f-report/) — a
   Claude Code skill (Python, stdlib-only) that downloads 13F-HR filings from
   SEC EDGAR for a configured list of top filers, diffs each one's
   stock-on-hand against the prior quarter, and writes JSON to the skill's
   `data/` directory.
2. **Portal** at [`portal/`](portal/) — a standalone React + Vite + Tailwind
   admin UI that reads the skill's JSON and renders per-investor stock-on-hand
   deltas with sortable, filterable tables.

## Repository layout

```
13F-report/
├── .claude/skills/13f-report/      # the skill (Python only, no JS deps)
│   ├── SKILL.md                    # frontmatter + usage + output schema
│   ├── download_13f.py             # SEC EDGAR fetcher / parser / differ
│   ├── investors.json              # CIKs of the top 10 filers (editable)
│   ├── fixtures/                   # XML fixtures for offline smoke test
│   │   ├── current.xml
│   │   └── prior.xml
│   └── data/                       # JSON output (consumed by the portal)
│       ├── summary.json            # filer overview list
│       └── <filer-slug>.json       # one per filer (full holdings + deltas)
│
└── portal/                         # standalone React app
    ├── package.json
    ├── vite.config.js              # publicDir → skill data/, registers admin plugin
    ├── vite-plugin-admin.js        # dev-only /api/investors + /api/search endpoints
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx
        ├── App.jsx
        ├── format.js               # number / currency / action-badge helpers
        ├── index.css               # tailwind directives
        └── components/
            ├── Sidebar.jsx         # filer list + portfolio totals + manage button
            ├── StatsCards.jsx      # value, holdings, new+added, trim+exit
            ├── HoldingsTable.jsx   # sortable, filterable, searchable
            └── ManageInvestors.jsx # add/remove tracked investors (dev-mode modal)
```

## Quick start

```bash
# 1. populate the skill's data/ — pick one mode

# offline (uses bundled XML fixtures, no network) — produces sample JSON for
# Berkshire Hathaway and BlackRock so the portal renders immediately
python3 .claude/skills/13f-report/download_13f.py --smoke-test

# live (requires network access to data.sec.gov; SEC requires an identifying
# User-Agent — anything generic gets a 403)
python3 .claude/skills/13f-report/download_13f.py \
  --user-agent "Your Name you@example.com"

# 2. run the portal
cd portal
npm install      # first time only
npm run dev      # http://localhost:5173 (live, hot-reloading)
# or
npm run build && npm run preview   # http://localhost:4173 (built bundle)
```

The committed `data/` folder already includes smoke-test output, so
`cd portal && npm install && npm run dev` works out of the box without
running the downloader.

## How the pieces connect

The portal's `vite.config.js` sets

```js
publicDir: path.resolve(__dirname, '../.claude/skills/13f-report/data')
```

so every file the downloader writes is served by Vite at the URL root with no
copy step:

| File                                    | URL                          |
| --------------------------------------- | ---------------------------- |
| `data/summary.json`                     | `/summary.json`              |
| `data/berkshire_hathaway.json`          | `/berkshire_hathaway.json`   |
| `data/<slug>.json`                      | `/<slug>.json`               |

Re-running the downloader and refreshing the browser is enough to pick up new
data — no rebuild required in dev mode.

## What the portal shows

For each filer:

- **Stats cards** — total portfolio value (with prior-quarter delta), holdings
  count, new+added count, trimmed+exited count.
- **Holdings table** — every position from the latest filing plus exited
  positions from the prior filing. Each row shows
  `shares_prior` → `shares`, `Δ shares`, `Δ %`, current value, `Δ value`, and
  an action badge (`new` / `add` / `hold` / `trim` / `exit`).
- Sortable on every column, filterable by action
  (`All / New / Added / Trimmed / Exited / Hold`), free-text search across
  issuer name and CUSIP.

## Manage tracked investors (dev-only module)

A **"Manage tracked investors"** button at the top of the sidebar (visible only
under `npm run dev`) opens a modal that:

- Lists the current entries in `investors.json` with a **Remove** button each.
- Lets you search SEC EDGAR for 13F-HR filers by name, then **Add** matches in
  one click. Search is filtered to entities that actually file 13F-HR.

Edits go straight to `.claude/skills/13f-report/investors.json`. After adding
or removing filers, an in-page banner reminds you to re-run the downloader to
fetch new filers' 13F holdings.

The endpoints are registered by `portal/vite-plugin-admin.js` and only exist
in dev mode:

| Method | Path                       | Effect                                          |
| ------ | -------------------------- | ----------------------------------------------- |
| GET    | `/api/investors`           | Read `investors.json`                           |
| POST   | `/api/investors`           | Append `{name, cik}`; 409 if CIK already present |
| DELETE | `/api/investors/:cik`      | Remove by CIK                                   |
| GET    | `/api/search?q=...`        | Proxy SEC EDGAR full-text search (forms=13F-HR) |

Production builds (`npm run build`) ship none of this — the management UI and
API both vanish.

## Output JSON schema (per filer)

```json
{
  "name": "Berkshire Hathaway",
  "cik": "1067983",
  "latest_filing": { "form": "13F-HR", "report_date": "...", "filing_date": "...", "accession": "...", "primary_doc": "..." },
  "prior_filing":  { "...": "..." },
  "holdings_count": 41,
  "total_value_usd": 299000000000,
  "total_value_usd_prior": 281000000000,
  "holdings": [
    {
      "issuer": "APPLE INC", "cusip": "037833100", "class": "COM",
      "shares": 300000000,        "value_usd":       69900000000,
      "shares_prior": 905560000,  "value_usd_prior": 176000000000,
      "delta_shares": -605560000, "delta_value_usd": -106100000000,
      "action": "trim"
    }
  ],
  "exited":   [{ "...same shape, shares=0...":  "" }],
  "top_buys": [{ "...subset of holdings where action in (new, add)...": "" }],
  "top_sells":[{ "...subset of holdings ∪ exited where action in (trim, exit)...": "" }]
}
```

`action` values, per security (aggregated by `cusip|class|put_call`):

- `new` — not in prior quarter
- `add` — share count increased
- `hold` — share count unchanged
- `trim` — share count decreased
- `exit` — removed entirely (lives in `exited`, not `holdings`)

`summary.json` carries just the per-filer overview (no holdings arrays) and
drives the portal sidebar.

## Caveats

- **13F is quarterly, not monthly.** The deadline is 45 days after each
  calendar quarter end. Monthly runs only surface late-arriving amendments and
  newly arrived quarters.
- **Value-unit change in 2023.** Pre-2023 13Fs reported `value` in $thousands;
  from Jan 2023 the field is in actual dollars. The script preserves whatever
  the filing reports — be careful when comparing across that boundary.
- **SEC fair-access policy.** Every request needs a descriptive User-Agent
  with contact info (`--user-agent "Name email@example.com"` or set
  `SEC_UA`). The script paces itself at ~10 req/s and retries 5xx/429 with
  exponential backoff.
- **Verify CIKs.** Some large managers file under multiple CIKs (parent vs.
  advisor entity). If a filer's holdings look small or stale, search EDGAR for
  the right entity and update `investors.json`.

See [`.claude/skills/13f-report/SKILL.md`](.claude/skills/13f-report/SKILL.md)
for the full skill documentation.

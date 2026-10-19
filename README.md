# 13F-report

Claude Code skill for downloading SEC 13F-HR institutional holdings of the top
20 US investors, diffing each filer's stock-on-hand vs. the prior quarter, and
viewing the result in a React + Tailwind admin portal.

**Live deploy:** [13-f-report.vercel.app](https://13-f-report.vercel.app/)

## Layout

```
13F-report/
├── .claude/skills/13f-report/
│   ├── SKILL.md              # full usage and output schema
│   ├── download_13f.py       # SEC EDGAR fetcher / parser / differ
│   ├── moomoo_quotes.py      # optional: today's P/E from a local moomoo OpenD
│   ├── investors.json        # CIKs of the top 20 filers (editable)
│   ├── fixtures/             # XML fixtures for offline smoke test
│   ├── data/                 # JSON output (per-filer, summary, tickers,
│   │                         #   fundamentals, valuation)
│   └── portal/               # Vite + React + Tailwind admin UI
├── .github/workflows/
│   └── refresh-13f-data.yml  # weekly auto-refresh of data/
├── vercel.json               # build config for the nested portal
└── README.md
```

## Quick start

```bash
# 1. populate data/ — pick one
python3 .claude/skills/13f-report/download_13f.py \
  --user-agent "Your Name you@example.com"             # live (needs SEC network)
python3 .claude/skills/13f-report/download_13f.py --smoke-test   # offline fixtures

# 2. run the portal
cd .claude/skills/13f-report/portal
npm install   # first time only
npm run dev   # http://localhost:5173
```

## Portal features

- **Sidebar** groups views into *Aggregate* (Overview, Compare filers) and the
  per-filer list (with a search box once filers exceed 8).
- **Overview** — combined AUM across all filers, plus *Top 10 consensus buys /
  sells* across the cohort and a clickable per-filer summary table.
- **Valuation Map** (PEG 估值地图) — trailing P/E vs historical EPS CAGR
  scatter for the top 25 / 50 / 100 stocks by combined 13F value, split by the
  PEG = 1 line, with dots colored by the filers' net share buying/selling this
  quarter. Price is 13F-implied (quarter-end), earnings come from SEC XBRL;
  3-yr / 5-yr toggle, sortable table, click-through to the thesis card.
- **Compare filers** — pick any two and see overlap, only-A, only-B, and
  divergent positions (with "X sold" badges when one side exited what the
  other still holds). Sortable, paginated.
- **Per-filer view** — stat cards (total value, holdings, top-10 concentration,
  new + added, trimmed + exited), a top-10 portfolio-composition bar, a
  Top Buys / Top Sells panel pair, and the holdings table with action filter,
  search, sort, sparkline trend column, CSV export, pagination, and a "View
  on EDGAR ↗" deep link.
- **Light / dark theme** toggle (persisted in localStorage; respects
  `prefers-color-scheme` on first load).
- **URL hash state** — `#cik=…&filter=…&sort=…&q=…` (or `#cik=compare&a=…&b=…`)
  so refresh, deep-link, and browser Back/Forward all work.
- Mobile-friendly: a slide-out drawer sidebar, no sideways scrolling down to
  360px wide, ~40px touch targets and 16px inputs (no iOS zoom on focus) on
  phones. The Overview loads a precomputed `aggregates.json` (~1 MB) rather
  than every filer's JSON (~36 MB).

## Auto-refresh

`.github/workflows/refresh-13f-data.yml` runs every Monday at 12:00 UTC,
re-runs the downloader against SEC EDGAR for every entry in `investors.json`,
and commits the refreshed JSON back to the default branch (Vercel rebuilds on
push). Manual runs are available via the Actions tab → *Refresh 13F data* →
*Run workflow*; an optional User-Agent input overrides the default.

User-Agent precedence: `workflow_dispatch` input → `vars.SEC_UA` repo
variable → built-in default (`Western welstein@gmail.com`).

## Optional: today's P/E from moomoo

The Valuation Map prices stocks at the 13F quarter-end by default. If you run
moomoo **OpenD** on your own computer (it can't run in GitHub Actions, since
its first login needs an SMS code), `moomoo_quotes.py` re-prices the map daily:

```bash
pip install moomoo-api                 # once
python3 .claude/skills/13f-report/moomoo_quotes.py --push
```

It pulls the repo, computes P/E = latest moomoo price ÷ the same SEC TTM EPS,
writes `data/quotes.json` (P/E ratios and a date only, no raw quotes, since the
site is public), commits, and pushes. Vercel then redeploys. Schedule it after
the US close, e.g. with cron in a local clone (06:00 Taiwan time, Tue–Sat):

```cron
0 6 * * 2-6  cd ~/13F-report && /usr/bin/python3 .claude/skills/13f-report/moomoo_quotes.py --push >> ~/moomoo_quotes.log 2>&1
```

OpenD must be running and logged in, and the account needs US-market quote
access for OpenAPI. If the file is missing or older than the 13F prices, the
portal falls back to quarter-end P/E.

## Deployment

Vercel builds the portal via the root-level `vercel.json` (which `cd`s into
`.claude/skills/13f-report/portal/`, runs `npm ci && npm run build`, and serves
`dist/`). Vite's `publicDir: '../data'` copies the per-filer JSONs into the
build output, so updating `data/` is enough to redeploy fresh numbers — no
manual step.

## Caveats

- **Quarterly data, not monthly.** 13F deadline is 45 days after each quarter
  end; weekly refresh just picks up newly-released filings.
- **Verify CIKs** in `investors.json` before relying on live output —
  large managers sometimes file under multiple entities (parent vs. advisor).
- **SEC asks for ≤ 10 req/s.** The downloader sleeps ~120 ms between requests
  and retries 5xx / 429 with exponential backoff.

See [`.claude/skills/13f-report/SKILL.md`](.claude/skills/13f-report/SKILL.md)
for the full output schema and the value-unit change SEC made in 2023.

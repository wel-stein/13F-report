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
│   ├── investors.json        # CIKs of the top 20 filers (editable)
│   ├── fixtures/             # XML fixtures for offline smoke test
│   ├── data/                 # JSON output (per-filer + summary.json)
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
- Mobile-responsive layout with a slide-out drawer sidebar.

## Auto-refresh

`.github/workflows/refresh-13f-data.yml` runs every Monday at 12:00 UTC,
re-runs the downloader against SEC EDGAR for every entry in `investors.json`,
and commits the refreshed JSON back to the default branch (Vercel rebuilds on
push). Manual runs are available via the Actions tab → *Refresh 13F data* →
*Run workflow*; an optional User-Agent input overrides the default.

User-Agent precedence: `workflow_dispatch` input → `vars.SEC_UA` repo
variable → built-in default (`Western welstein@gmail.com`).

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

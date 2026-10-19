---
name: 13f-report
description: Download SEC 13F-HR institutional holdings filings for a fixed list of top-10 US investors, compute buy/sell/new/exit deltas vs the prior quarter, emit JSON, and view in a React + Tailwind admin portal. Use when the user asks for "13F report", "institutional holdings", "what did Berkshire/BlackRock/Bridgewater buy/sell", or wants the latest top-investor portfolio changes. Quarterly data; safe to re-run monthly to pick up newly released filings.
---

# 13F Report Downloader + Admin Portal

Pulls 13F-HR filings from SEC EDGAR for a configured list of top US institutional investors, parses the holdings information table, diffs against the prior quarter, and writes JSON files to `data/`. Ships with a React + Tailwind admin portal in `portal/` that reads those JSON files and renders per-investor stock-on-hand vs prior-quarter deltas.

## When to use

- "Download the latest 13F report for the top 10 investors"
- "What did Warren Buffett buy/sell last quarter?"
- "Refresh the institutional-holdings JSON"
- Monthly cadence to pick up newly filed 13Fs (deadline is 45 days after each quarter end)

## When NOT to use

- The user wants real-time prices, intraday flows, or non-13F SEC forms (10-K, 8-K, etc.).
- The user wants holdings for a non-US filer or a fund <$100M AUM (those don't file 13F).

## How to run

The script lives next to this skill:

```bash
python3 .claude/skills/13f-report/download_13f.py \
  --user-agent "Your Name your_email@example.com"
```

SEC requires an identifying `User-Agent` on every request. Pass `--user-agent` or set the `SEC_UA` env var. Anything else gets a 403.

Output goes to `.claude/skills/13f-report/data/`:

- `<filer-slug>.json` — one file per filer (latest filing, holdings count, total value, top buys, top sells)
- `summary.json` — combined report across all filers, with `generated_at` timestamp
- `aggregates.json` — `{ generated_at, filers, consensus: { buys, sells },
  accumulation }`, the cross-filer folds behind the Overview's top-10
  consensus lists and the Quiet Accumulation screen, precomputed so those
  views load ~1 MB instead of every filer JSON (~36 MB). `accumulation` keeps
  only names in no filer's top 10 that 2+ filers bought, with buyers / new
  openers as indexes into `filers`. Written by live runs and `--smoke-test`.
- `tickers.json` — `{ cusip: ticker }` map used by the portal's Quiet
  Accumulation and Valuation Map views. Hand-curated entries are kept as-is
  (share classes like GOOGL/GOOG and BRK-A/BRK-B are curated, since name
  matching can't tell them apart); each live run *fills in* any
  still-unmapped CUSIPs by matching every issuer spelling the filers used
  against SEC's `company_tickers.json`, after folding 13F abbreviations
  (`SYS`, `MATLS`, `FINL`, …) and word order. A company listing several
  tickers (preferreds) maps to its primary one. Best-effort — a fetch failure
  leaves the existing map untouched and never fails the run.
- `fundamentals.json` — `{ generated_at, source, stocks: { TICKER: {…} } }`
  per-stock fundamentals used by the portal's thesis card. For every held
  security that maps to a ticker and a SEC CIK, the downloader pulls EDGAR
  **XBRL companyfacts** and computes revenue growth, net margin (+3-yr prior),
  free cash flow (OCF − capex, +3-yr prior), FCF margin, **Rule of 40**
  (revenue growth % + FCF margin %), cash, and debt. Incremental (entries
  fetched within ~80 days are skipped), capped at `max_fetch`, and fully
  fail-safe. Foreign filers without US-GAAP/IFRS XBRL simply stay absent.
- `valuation.json` — `{ generated_at, price_date, cohort_filers, source, stocks: [...] }`
  inputs for the portal's **Valuation Map** (P/E vs EPS growth, PEG). Covers
  the 100 largest companies by combined 13F value among filers on the latest
  quarter (share classes merged by CIK, ETFs dropped). Per company:
  - `price` — 13F-implied quarter-end price: median of `value_usd / shares`
    across those filers (SEC publishes no prices; the median shrugs off a
    filer still reporting in $thousands).
  - `eps_ttm` — trailing-twelve-month diluted EPS from XBRL `companyfacts`:
    the reported figure (fiscal year + YTD − prior-year YTD) or TTM net
    income ÷ latest diluted shares, whichever is fresher (the latter wins
    when a stock split landed mid-year). For each concept the first tag with
    current data is used, since companies switch tags over the years.
    `pe = price / eps_ttm` (null when ≤ 0 or out of range). 20-F/40-F filers
    are skipped: the 13F holds their ADRs, whose share ratio XBRL doesn't give.
  - `eps_cagr_3y_pct` / `eps_cagr_5y_pct` — annual diluted EPS CAGR from 10-K
    filings, restated across stock splits by chaining year-over-year ratios
    taken *within* each filing. Null when either end is a loss.
  - `holders`, `buyers`, `sellers`, `net_shares_pct`, `held_value_usd` — the
    13F side (net change in shares held across the cohort drives dot color).
  - `note` — why a company can't be plotted (non-USD EPS, negative TTM
    earnings, …).

  EDGAR inputs are cached ~20 days per company (earnings only move
  quarterly; a `version` bump drops the cache); prices and flows are
  recomputed every run. Companies whose EDGAR inputs come back incomplete
  are logged with the tags tried, for debugging from the workflow log. The whole step is
  fail-safe and never breaks the refresh.

### Useful flags

| Flag | Default | Purpose |
| --- | --- | --- |
| `--investors PATH` | `investors.json` | Override the filer list |
| `--out-dir PATH` | `./data` | Write JSON elsewhere |
| `--top-n N` | `25` | Cap top buys/sells per filer |
| `--user-agent S` | env `SEC_UA` | Required by SEC; identify yourself |
| `--smoke-test` | off | Run offline against bundled fixtures (no network) |

### Offline smoke test (no SEC access required)

```bash
python3 .claude/skills/13f-report/download_13f.py --smoke-test
```

Parses `fixtures/current.xml` and `fixtures/prior.xml`, runs the diff, and prints the resulting JSON. Useful in sandboxed environments.

## Filer list

`investors.json` — top US 13F filers. Edit to swap, add, or reorder. CIKs are the SEC Central Index Key (no zero-padding required; the script normalizes).

> **Verify CIKs before relying on output.** Some large managers file under multiple CIKs (e.g. parent vs. advisor entity). If a filer's holdings look small or stale, search EDGAR for the right entity and update `investors.json`.

## Output schema

Each per-filer file:

```json
{
  "name": "Berkshire Hathaway",
  "cik": "1067983",
  "latest_filing": { "form": "13F-HR", "report_date": "2025-12-31", "filing_date": "2026-02-14", "accession": "...", "primary_doc": "..." },
  "prior_filing":  { "...": "..." },
  "holdings_count": 41,
  "holdings_count_prior": 38,
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
  "exited":   [{ "...same shape, shares=0..." }],
  "top_buys": [{ "...subset of holdings where action in (new, add)..." }],
  "top_sells":[{ "...subset of holdings ∪ exited where action in (trim, exit)..." }]
}
```

`summary.json` carries only the lightweight per-filer fields (`name`, `cik`,
`latest_filing`, `prior_filing`, `holdings_count(_prior)`,
`total_value_usd(_prior)`, plus `error` when a filer fails) — the portal
fetches the full per-filer file lazily when a row is selected. Filings are
deduped by `report_date` so a 13F-HR/A amendment isn't compared against its
own original. `holdings_count` reflects the aggregated security count
(keyed by `cusip|class|put_call`), matching the table the portal renders.

`action` values, per security (aggregated by CUSIP/class/put-call):

- `new` — not in prior quarter
- `add` — share count increased
- `hold` — share count unchanged
- `trim` — share count decreased
- `exit` — removed entirely (lives in `exited`, not `holdings`)

## Admin portal (React + Tailwind)

A single-page admin portal under `portal/` reads the JSON in `data/`. The
sidebar groups entries into **Aggregate** (Overview, Quiet Accumulation,
Valuation Map, Compare filers) and **Filers** (one entry per filer in
`summary.json`).

Per-investor view renders:

- Stats cards: total portfolio value (with delta vs prior), holdings count,
  Top-10 concentration, new+added, trimmed+exited.
- Top Buys / Top Sells panels (the top 5 by Δ value).
- A sortable, filterable holdings table — each row shows
  `shares_prior → shares`, `Δ shares`, `Δ %`, current value, `Δ value`, and
  an action badge (`new` / `add` / `hold` / `trim` / `exit`).
  Supports keyword search, CSV export of the filtered/sorted rows, and
  pages at 100 rows per screen for large 13Fs.
- A "View on EDGAR ↗" link to the filing index on sec.gov.

The Overview view aggregates across every filer: combined AUM, top-10
consensus buys / sells (joined on CUSIP, read from `aggregates.json`), and a
per-filer summary table with click-through.

The **Quiet Accumulation** view (悄悄吸筹) screens for stocks being broadly
accumulated under the radar: securities that many filers bought or newly
opened this quarter (`new` / `add`) but that are a top-10 position of *no*
filer — i.e. broad institutional buying before a name becomes an obvious
conviction holding. Rows are ranked by a conviction score that weights
brand-new positions double (`new × 2 + add`), with net dollars bought as the
tiebreak; option legs are excluded. Two controls: an **All filers / Active
managers only** toggle (the latter restricts to the 10 discretionary alpha
managers, stripping breadth noise from passive index/custodial giants) and a
**min buyers** slider. Each row shows the stock **ticker** (from
`data/tickers.json`; private / unlisted issuers show `—`), issuer, sector,
buyer count, new-position count, net $ bought, and which filers are buying.
Clicking any row opens a **thesis card** — a phosphor-terminal modal that
renders that stock's EDGAR fundamentals (`fundamentals.json`): revenue
growth, net margin and FCF transitions, cash/debt, and a **Rule of 40** bar
(revenue growth + FCF margin vs. the 40% healthy line). Stocks not yet
enriched show a graceful "pending next EDGAR refresh" state.

The **Valuation Map** view (PEG 估值地图) plots trailing P/E against historical
diluted EPS CAGR for the top 25 / 50 / 100 stocks by combined 13F value, with
the PEG = 1 diagonal splitting the PEG > 1 and PEG < 1 regions. Dot color is
the tracked filers' net share flow this quarter (blue ≥ +2%, orange ≤ −2%,
gray in between); outliers past the axis range are pinned to the edge as
triangles. A 3-yr / 5-yr growth toggle, a sortable table view (default:
PEG ascending), and a "Not plotted" list with reasons sit alongside; clicking
a dot or row opens the same thesis card. It's a *trailing* PEG (Lynch's
original form) — forward P/E and consensus 3–5-yr growth need analyst
estimates, which SEC doesn't publish. Data comes from `valuation.json`, which
only the live downloader writes (not `--smoke-test`).

#### Optional: current P/E from moomoo (local OpenD)

`moomoo_quotes.py` re-prices the map at today's price instead of the 13F
quarter-end. It runs on the machine where moomoo **OpenD** is logged in (not
in GitHub Actions: OpenD needs an interactive first login with an SMS code):

```bash
pip install moomoo-api
python3 .claude/skills/13f-report/moomoo_quotes.py --push
```

It reads `data/valuation.json`, takes the latest `get_market_snapshot` price
for each stock (`BRK-B` → `US.BRK.B`), divides by the same SEC TTM diluted
EPS, and writes `data/quotes.json` = `{ as_of, eps_from, source, pe: {TICKER:
ratio} }`. Only ratios and a date are published, never raw quotes, since the
portal is public. A stock whose ratio disagrees with moomoo's own
`pe_ttm_ratio` by a split-sized gap (outside 0.7–1.43×, e.g. a split since the
last 10-Q) is left out and logged, so the map keeps its consistent 13F
quarter-end P/E. `--push` pulls first (fresh EPS), then commits and pushes,
and Vercel redeploys. The portal uses it only when `as_of` is newer than the
13F price date, and offers a "P/E price: Latest / 13F q-end" toggle. Without
the file, nothing changes. Flags: `--host`, `--port` (OpenD, default
127.0.0.1:11111), `--data-dir`. OpenAPI needs US-market quote access on the
account. Check moomoo's OpenAPI terms for what you may publish.

The Compare view diffs two filers side-by-side: overlap, only-A, only-B,
overlap-weight stats, plus a sortable table joining the two filers'
holdings (with a "X sold" badge when one side exited what the other still
holds).

State lives in the URL hash (`#cik=…&filter=…&sort=…&q=…`, `#cik=peg`, or `#cik=compare&a=…&b=…`)
so refresh, back/forward, and shareable links all work. Light/dark theme
toggle is in the mobile top-bar and the sidebar header on desktop;
preference persists in `localStorage`.

### Run

```bash
cd .claude/skills/13f-report/portal
npm install     # first time only
npm run dev     # http://localhost:5173 — live, hot-reloading
# or
npm run build && npm run preview   # http://localhost:4173 — built bundle
```

The portal reads `/summary.json` and per-filer JSON. Vite is configured
(`vite.config.js`) with `publicDir` pointing at `../data`, so the same
files written by `download_13f.py` are served as-is — no copy step. After
re-running the downloader, refresh the page (dev) or rebuild (preview).

### Vercel

Deployed via the repo-root `vercel.json`, which runs `npm ci` + `npm run build`
inside the portal subfolder and serves `dist/`. Vite's `publicDir` copies
the per-filer JSONs from `../data/` into the build output so they resolve
at the site root.

### Expected page flow

1. On load, fetches `/summary.json` and lands on the Overview view, which
   (with Quiet Accumulation) reads `/aggregates.json`.
2. Selecting a filer fetches `/<filer-slug>.json` and renders stats + the
   holdings table; selecting "Compare filers" lazy-loads two filer JSONs.
   `tickers.json` and `fundamentals.json` load only once Quiet Accumulation
   or the Valuation Map opens.
3. Each table supports sorting any column; the holdings table also
   filters by action (`All / New / Added / Trimmed / Exited / Hold`) and
   free-text searches issuer/CUSIP.

If the portal renders an empty state, the data dir hasn't been populated —
run the downloader (live or `--smoke-test`) first.

## Caveats

- **Quarterly data, not monthly.** 13F deadline is 45 days after quarter end. Monthly runs only surface late-filed amendments and any newly arrived quarter.
- **Value-unit change.** Pre-2023 13Fs reported `value` in $thousands; from Jan 2023 the field is in actual dollars. The script preserves whatever the filing reports — be aware when comparing across that boundary.
- **Aggregation key.** Holdings are aggregated by `(cusip, class, put_call)` so options vs. common are treated separately, and split-manager rows for the same security are summed.
- **No price-based inference.** The diff is computed from share counts, not market value, so a price move alone never shows up as a buy or sell.
- **Rate limit.** SEC asks for ≤ 10 req/s. The script sleeps ~120ms between requests and retries 5xx/429 with exponential backoff.

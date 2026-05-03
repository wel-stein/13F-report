---
name: 13f-report
description: Download SEC 13F-HR institutional holdings filings for a fixed list of top-10 US investors, compute buy/sell/new/exit deltas vs the prior quarter, and emit JSON. Use when the user asks for "13F report", "institutional holdings", "what did Berkshire/BlackRock/Bridgewater buy/sell", or wants the latest top-investor portfolio changes. Quarterly data; safe to re-run monthly to pick up newly released filings.
---

# 13F Report Downloader

Pulls 13F-HR filings from SEC EDGAR for a configured list of top US institutional investors, parses the holdings information table, diffs against the prior quarter, and writes JSON files to `data/`. A separate React + Tailwind admin portal (at the repo root, `portal/`) consumes the JSON to visualize per-investor stock-on-hand vs prior-quarter deltas.

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

```json
{
  "name": "Berkshire Hathaway",
  "cik": "1067983",
  "latest_filing": { "form": "13F-HR", "report_date": "2025-12-31", "filing_date": "2026-02-14", "accession": "...", "primary_doc": "..." },
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
  "exited":   [{ "...same shape, shares=0..." }],
  "top_buys": [{ "...subset of holdings where action in (new, add)..." }],
  "top_sells":[{ "...subset of holdings ∪ exited where action in (trim, exit)..." }]
}
```

`action` values, per security (aggregated by CUSIP/class/put-call):

- `new` — not in prior quarter
- `add` — share count increased
- `hold` — share count unchanged
- `trim` — share count decreased
- `exit` — removed entirely (lives in `exited`, not `holdings`)

## Consumers

Two separate React projects in this repo consume the JSON this skill emits:

- [`portal/`](../../../portal) — **admin portal** (dev tool). Skill-agnostic; registered via [`portal/skills.config.js`](../../../portal/skills.config.js). Includes a "Manage tracked investors" module (dev-mode only) that edits this skill's `investors.json` in place via Vite middleware. Run with `cd portal && npm install && npm run dev` (port 5173).
- [`web/`](../../../web) — **public site** (read-only). Same data; user-facing. Aggregates buys/sells across all investors on the homepage; per-investor pages at `#/investor/:cik`. Deployable as a static bundle. Run with `cd web && npm install && npm run dev` (port 5174).

Both UIs use Vite's `publicDir` to serve this skill's `data/` directory directly, so re-running the downloader is enough to refresh either UI. If a UI renders an empty state, the data dir hasn't been populated — run the downloader (live or `--smoke-test`) first.

## WhaleCheck history files (synthetic for now)

The public site has a "WhaleCheck" page at `#/investor/:cik/whalecheck` that
charts a fund's hypothetical 13F-mirroring strategy versus the S&P 500. It
reads a separate JSON file per filer:

```
data/<filer-slug>_history.json
```

Schema:

```json
{
  "name": "Berkshire Hathaway",
  "cik": "1067983",
  "benchmark": "S&P 500 (SPY)",
  "is_synthetic": true,
  "generated_at": "2026-05-02",
  "quarters": 12,
  "series": [
    {
      "quarter": "2023-Q3",
      "report_date": "2023-09-30",
      "portfolio_return_pct": 4.5,
      "portfolio_cum_pct":   4.5,
      "spy_return_pct":      3.2,
      "spy_cum_pct":         3.2
    }
  ]
}
```

Today these files are produced by `generate_history_fixture.py`, which writes
**plausible-but-fake** numbers seeded by CIK so the WhaleCheck UI can render
for demos. Each filer's `is_synthetic: true` flag drives a banner on the page.

```bash
# Re-generate synthetic history for every filer in summary.json
python3 .claude/skills/13f-report/generate_history_fixture.py
```

To wire **real** WhaleCheck data, replace the generator with a script that
emits the same schema from real prices. The work breaks down as:

1. **Multi-quarter holdings.** Extend `download_13f.py` to walk back N
   quarters per filer (the EDGAR submissions API already lists every 13F-HR
   filing — the existing parser handles each one fine, you just need to
   fetch and persist more than the latest pair).
2. **CUSIP → ticker mapping.** SEC's monthly company-tickers feed
   (`https://www.sec.gov/files/company_tickers_exchange.json`) is a starting
   point; CUSIP-to-ticker is a separate dataset (CUSIP Global Services is
   licensed; OpenFIGI is the common free fallback).
3. **Historical prices.** Yahoo Finance (`yfinance`), Stooq's free CSVs, or
   a paid feed. Pull quarterly close prices for each ticker and for SPY.
4. **Backtest.** At each filing date, weight positions by reported value;
   compute portfolio close-to-close return to the next filing date. SPY
   over the same window is the benchmark. `is_synthetic: false` once real.

The UI is schema-stable, so once the generator is replaced, no front-end
changes are needed — the demo banner disappears automatically when
`is_synthetic` is `false`.

## Caveats

- **Quarterly data, not monthly.** 13F deadline is 45 days after quarter end. Monthly runs only surface late-filed amendments and any newly arrived quarter.
- **Value-unit change.** Pre-2023 13Fs reported `value` in $thousands; from Jan 2023 the field is in actual dollars. The script preserves whatever the filing reports — be aware when comparing across that boundary.
- **Aggregation key.** Holdings are aggregated by `(cusip, class, put_call)` so options vs. common are treated separately, and split-manager rows for the same security are summed.
- **No price-based inference.** The diff is computed from share counts, not market value, so a price move alone never shows up as a buy or sell.
- **Rate limit.** SEC asks for ≤ 10 req/s. The script sleeps ~120ms between requests and retries 5xx/429 with exponential backoff.

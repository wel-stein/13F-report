---
name: 13f-report
description: Download SEC 13F-HR institutional holdings filings for a fixed list of top-10 US investors, compute buy/sell/new/exit deltas vs the prior quarter, and emit JSON. Use when the user asks for "13F report", "institutional holdings", "what did Berkshire/BlackRock/Bridgewater buy/sell", or wants the latest top-investor portfolio changes. Quarterly data; safe to re-run monthly to pick up newly released filings.
---

# 13F Report Downloader

Pulls 13F-HR filings from SEC EDGAR for a configured list of top US institutional investors, parses the holdings information table, diffs against the prior quarter, and writes JSON files to `data/`.

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
  "latest_filing": {
    "form": "13F-HR",
    "filing_date": "2026-02-14",
    "report_date": "2025-12-31",
    "accession": "0000950123-26-001234",
    "primary_doc": "primary_doc.xml"
  },
  "prior_filing": { "...": "..." },
  "holdings_count": 41,
  "total_value_usd": 299000000000,
  "top_buys":  [{ "issuer": "...", "cusip": "...", "delta_shares": 1234, "delta_value_usd": 5678, "action": "new|add" }],
  "top_sells": [{ "issuer": "...", "cusip": "...", "delta_shares": -1234, "delta_value_usd": -5678, "action": "exit|trim" }]
}
```

`action` values:

- `new` — security not present in prior quarter
- `add` — share count increased
- `trim` — share count decreased
- `exit` — security removed entirely

## Caveats

- **Quarterly data, not monthly.** 13F deadline is 45 days after quarter end. Monthly runs only surface late-filed amendments and any newly arrived quarter.
- **Value-unit change.** Pre-2023 13Fs reported `value` in $thousands; from Jan 2023 the field is in actual dollars. The script preserves whatever the filing reports — be aware when comparing across that boundary.
- **Aggregation key.** Holdings are aggregated by `(cusip, class, put_call)` so options vs. common are treated separately, and split-manager rows for the same security are summed.
- **No price-based inference.** The diff is computed from share counts, not market value, so a price move alone never shows up as a buy or sell.
- **Rate limit.** SEC asks for ≤ 10 req/s. The script sleeps ~120ms between requests and retries 5xx/429 with exponential backoff.

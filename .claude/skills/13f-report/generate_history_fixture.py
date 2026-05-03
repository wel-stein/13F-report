#!/usr/bin/env python3
"""Generate synthetic <filer-slug>_history.json files for the WhaleCheck UI.

WhaleCheck visualizes how a fund's 13F-mirroring strategy would have performed
versus the S&P 500. Computing real returns requires:

  1. Multiple quarters of historical 13F holdings (the live downloader only
     persists the latest two quarters per filer).
  2. Per-CUSIP historical close prices (Yahoo, Stooq, etc. + a CUSIP→ticker
     map).
  3. S&P 500 (SPY) historical close prices for the benchmark.

Building (1)+(2)+(3) is a separate project. Until then, this script writes
plausible-looking synthetic series so the UI renders for demos. Each filer's
sequence is seeded by their CIK so the numbers are stable across runs but
clearly **not** real.

The output schema matches what web/src/pages/WhaleCheck.jsx expects. To wire
real data later, replace this script with one that emits the same shape from
actual prices.
"""
from __future__ import annotations

import argparse
import json
import math
import random
from datetime import date
from pathlib import Path


def quarter_label(year: int, q: int) -> tuple[str, str]:
    end_month, end_day = {1: (3, 31), 2: (6, 30), 3: (9, 30), 4: (12, 31)}[q]
    return f"{year}-Q{q}", f"{year}-{end_month:02d}-{end_day:02d}"


def gen_series(cik: str, quarters: int) -> list[dict]:
    rng = random.Random(int(cik))
    today = date.today()
    cur_q = (today.month - 1) // 3 + 1
    cur_year = today.year

    # Walk back `quarters` periods.
    seq: list[tuple[int, int]] = []
    y, q = cur_year, cur_q
    for _ in range(quarters):
        seq.append((y, q))
        q -= 1
        if q == 0:
            q = 4
            y -= 1
    seq.reverse()

    # Mean / vol roughly calibrated to large-cap equity quarterly returns.
    port_mu, port_sd = 2.5, 6.5    # %
    spy_mu,  spy_sd  = 2.0, 5.0
    # Inject a small permanent skill (alpha) per CIK so different filers look
    # different rather than all hugging zero alpha.
    alpha = (rng.random() - 0.5) * 1.6   # ~ ±0.8% per quarter avg

    rows: list[dict] = []
    port_cum, spy_cum = 0.0, 0.0
    for y, q in seq:
        label, end = quarter_label(y, q)
        spy_r  = rng.gauss(spy_mu, spy_sd)
        # Correlate the fund return with SPY but with idiosyncratic noise + alpha
        port_r = 0.7 * spy_r + 0.3 * rng.gauss(port_mu, port_sd) + alpha
        # Compound cumulative returns multiplicatively.
        port_cum = (1 + port_cum / 100) * (1 + port_r / 100) * 100 - 100
        spy_cum  = (1 + spy_cum  / 100) * (1 + spy_r  / 100) * 100 - 100
        rows.append({
            "quarter": label,
            "report_date": end,
            "portfolio_return_pct": round(port_r, 2),
            "portfolio_cum_pct":   round(port_cum, 2),
            "spy_return_pct":      round(spy_r, 2),
            "spy_cum_pct":         round(spy_cum, 2),
        })
    return rows


def slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")


def main() -> int:
    here = Path(__file__).parent
    p = argparse.ArgumentParser()
    p.add_argument("--data-dir", default=str(here / "data"))
    p.add_argument("--quarters", type=int, default=12,
                   help="how many quarters of synthetic history to emit")
    p.add_argument("--investors-from", default=None,
                   help="path to a JSON file shaped like investors.json; "
                        "defaults to summary.json filers")
    args = p.parse_args()

    data_dir = Path(args.data_dir)
    if args.investors_from:
        filers = json.loads(Path(args.investors_from).read_text())
    else:
        summary_path = data_dir / "summary.json"
        if not summary_path.exists():
            print(f"no summary.json at {summary_path}; "
                  "run download_13f.py (or --smoke-test) first", flush=True)
            return 1
        filers = [
            {"name": f["name"], "cik": f["cik"]}
            for f in json.loads(summary_path.read_text())["filers"]
            if "error" not in f
        ]

    today = date.today().isoformat()
    written = 0
    for f in filers:
        series = gen_series(str(f["cik"]), args.quarters)
        payload = {
            "name": f["name"],
            "cik": str(f["cik"]),
            "benchmark": "S&P 500 (SPY)",
            "is_synthetic": True,
            "generated_at": today,
            "quarters": args.quarters,
            "series": series,
        }
        out = data_dir / f"{slug(f['name'])}_history.json"
        out.write_text(json.dumps(payload, indent=2))
        print(f"wrote {out.name} ({len(series)} quarters)")
        written += 1

    print(f"\nDone. {written} synthetic history files in {data_dir}")
    print("NOTE: these are fake numbers seeded by CIK. See SKILL.md for the "
          "real-data plan.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

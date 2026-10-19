#!/usr/bin/env python3
"""Refresh the Valuation Map's P/E with current prices from a local moomoo OpenD.

The weekly SEC refresh prices the map at the 13F quarter-end (up to ~4
months stale). Run this on the machine where OpenD is logged in: it takes
the latest moomoo snapshot price for every stock in data/valuation.json,
divides by the same SEC TTM diluted EPS the map already uses, and writes
data/quotes.json. Only the resulting P/E ratios and a date are written, no
raw quotes, since the portal is public.

    pip install moomoo-api
    python3 moomoo_quotes.py            # write data/quotes.json
    python3 moomoo_quotes.py --push     # git pull, write, commit, push

Needs OpenD running and logged in, with US-market quote access for OpenAPI.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

SNAPSHOT_BATCH = 400   # OpenD's cap on codes per get_market_snapshot call
SNAPSHOT_PAUSE = 0.6   # stay under OpenD's ~60 snapshot calls / 30 s


def moomoo_code(ticker: str) -> str:
    """SEC ticker -> moomoo code: 'BRK-B' -> 'US.BRK.B'."""
    return "US." + ticker.upper().replace("-", ".")


def fetch_snapshots(ctx, codes: list[str], ok) -> tuple[dict[str, dict], list[str], str]:
    """({code: snapshot row}, codes OpenD rejected, OpenD's last error).

    One unknown code fails a whole snapshot call, so a failed batch is
    retried code by code to keep the rest; five straight failures with
    nothing priced means a login/permission problem, so stop there.
    """
    rows: dict[str, dict] = {}
    bad: list[str] = []
    err = ""

    def call(batch):
        nonlocal err
        ret, data = ctx.get_market_snapshot(batch)
        time.sleep(SNAPSHOT_PAUSE)
        if ret == ok:
            return data.to_dict("records")
        err = str(data)
        return None

    for i in range(0, len(codes), SNAPSHOT_BATCH):
        batch = codes[i:i + SNAPSHOT_BATCH]
        got = call(batch)
        if got is None:
            got = []
            for code in batch:
                one = call([code])
                if one is None:
                    bad.append(code)
                    if not rows and not got and len(bad) >= 5:
                        return rows, bad, err
                else:
                    got.extend(one)
        rows.update({r["code"]: r for r in got})
    return rows, bad, err


def build_quotes(valuation: dict, snapshots: dict[str, dict]) -> tuple[dict, list[str]]:
    """quotes.json payload (P/E = latest price / SEC TTM EPS), plus the
    tickers left out because that P/E disagrees with moomoo's own."""
    pe: dict[str, float] = {}
    mismatched: list[str] = []
    as_of = ""
    for s in valuation.get("stocks", []):
        eps = s.get("eps_ttm")
        snap = snapshots.get(moomoo_code(s["ticker"]))
        if not eps or eps <= 0 or not snap or not snap.get("equity_valid", True):
            continue
        price = snap.get("last_price") or 0
        if price <= 0 or snap.get("suspension"):
            continue
        ratio = price / eps
        # A split after the last 10-Q puts the price on the new share basis
        # but the SEC EPS on the old one, halving (2:1) the P/E. moomoo's own
        # P/E TTM is on one basis, so a split-sized gap means skip: the map
        # then keeps the 13F quarter-end P/E, which is consistent.
        ref = snap.get("pe_ttm_ratio") or 0
        if ref and (ref < 0 or not 0.7 <= ratio / ref <= 1.43):
            mismatched.append(s["ticker"])
            continue
        if 1 <= ratio <= 1000:  # same sanity band as the SEC-side P/E
            pe[s["ticker"]] = round(ratio, 1)
            as_of = max(as_of, str(snap.get("update_time", ""))[:10])
    return {
        "as_of": as_of or date.today().isoformat(),
        "eps_from": valuation.get("generated_at"),
        "source": "moomoo OpenAPI snapshot price / SEC TTM diluted EPS",
        "pe": dict(sorted(pe.items())),
    }, mismatched


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(repo), *args], check=True,
                          capture_output=True, text=True).stdout.strip()


def main() -> int:
    here = Path(__file__).parent
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1", help="OpenD host (default 127.0.0.1)")
    p.add_argument("--port", type=int, default=11111, help="OpenD port (default 11111)")
    p.add_argument("--data-dir", default=str(here / "data"))
    p.add_argument("--push", action="store_true",
                   help="git pull first, then commit and push data/quotes.json")
    args = p.parse_args()

    data_dir = Path(args.data_dir)
    repo = Path(git(data_dir, "rev-parse", "--show-toplevel")) if args.push else None
    if repo:
        git(repo, "pull", "--rebase", "--autostash")  # latest EPS, and a clean push later

    valuation = json.loads((data_dir / "valuation.json").read_text())
    codes = sorted({moomoo_code(s["ticker"]) for s in valuation.get("stocks", []) if s.get("eps_ttm")})
    if not codes:
        print("valuation.json has no stocks with TTM EPS; nothing to price", file=sys.stderr)
        return 1

    try:
        from moomoo import OpenQuoteContext, RET_OK
    except ImportError:
        print("moomoo SDK missing: pip install moomoo-api", file=sys.stderr)
        return 1
    ctx = OpenQuoteContext(host=args.host, port=args.port)
    try:
        snapshots, bad, err = fetch_snapshots(ctx, codes, RET_OK)
    finally:
        ctx.close()
    if not snapshots:
        print(f"OpenD returned no snapshots (logged in? US quote access for OpenAPI?): {err}",
              file=sys.stderr)
        return 1

    doc, mismatched = build_quotes(valuation, snapshots)
    out = data_dir / "quotes.json"
    out.write_text(json.dumps(doc, indent=1) + "\n")
    print(f"quotes: P/E for {len(doc['pe'])} of {len(codes)} stocks as of {doc['as_of']}"
          + (f"; OpenD rejected {', '.join(bad)}" if bad else ""), file=sys.stderr)
    if mismatched:
        print(f"quotes: kept 13F quarter-end P/E for {', '.join(mismatched)}: price / SEC EPS "
              "disagrees with moomoo's P/E TTM (stock split since the last 10-Q?)", file=sys.stderr)

    if repo:
        rel = str(out.resolve().relative_to(repo.resolve()))
        git(repo, "add", rel)
        if git(repo, "status", "--porcelain", rel):
            git(repo, "commit", "-m", f"Update moomoo P/E ({doc['as_of']})")
            git(repo, "push")
            print("quotes: pushed", file=sys.stderr)
        else:
            print("quotes: unchanged, nothing to push", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Download SEC 13F-HR institutional holdings for a list of filers and emit JSON.

For each filer, the script:
  1. Hits EDGAR's submissions API to find the most recent 13F-HR (and the one before
     it, used as the comparison quarter).
  2. Locates the holdings information-table XML inside the filing.
  3. Parses holdings, aggregates by security, and computes buy/sell deltas vs. the
     prior quarter (new positions, exits, adds, trims).
  4. Writes one JSON file per filer plus a combined summary.

Notes:
  - 13F filings are quarterly (45-day deadline after each calendar quarter end), so
    "monthly" runs simply re-check for newly-released filings; the data itself
    refreshes once per quarter.
  - SEC requires a descriptive User-Agent with contact info on every request.
    Override with --user-agent or the SEC_UA env var.
  - The `value` field in 13F filings switched from $thousands to actual dollars in
    Jan 2023 (Form 13F amendments). Output preserves the raw value as `value_usd`.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from xml.etree import ElementTree as ET

DEFAULT_UA = "13F-Report-Tool research@example.com"
EDGAR_DATA = "https://data.sec.gov"
EDGAR_ARCHIVES = "https://www.sec.gov/Archives/edgar/data"
NS_INFO = "{http://www.sec.gov/edgar/document/thirteenf/informationtable}"

_UA = os.environ.get("SEC_UA", DEFAULT_UA)


def http_get(url: str, retries: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": _UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                # SEC fair-access guideline: <= 10 req/s
                time.sleep(0.12)
                return data
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (429, 500, 502, 503, 504):
                time.sleep(2 ** attempt)
                continue
            raise
        except urllib.error.URLError as e:
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last}")


def get_recent_13f(cik: str) -> list[dict]:
    """Most recent 13F-HR filings, deduped by report_date, newest first.

    A 13F-HR/A (amendment) shares its report_date with the original 13F-HR.
    We keep the most-recently-filed entry per report_date so the diff
    compares two distinct quarters, not an amendment vs. its own original.
    """
    cik10 = str(int(cik)).zfill(10)
    body = http_get(f"{EDGAR_DATA}/submissions/CIK{cik10}.json")
    sub = json.loads(body)
    recent = sub["filings"]["recent"]
    out = []
    for i, form in enumerate(recent["form"]):
        if form in ("13F-HR", "13F-HR/A"):
            out.append({
                "form": form,
                "filing_date": recent["filingDate"][i],
                "report_date": recent["reportDate"][i],
                "accession": recent["accessionNumber"][i],
                "primary_doc": recent["primaryDocument"][i],
            })
    out.sort(key=lambda r: (r["report_date"], r["filing_date"]), reverse=True)
    deduped: list[dict] = []
    seen: set[str] = set()
    for r in out:
        if r["report_date"] in seen:
            continue
        seen.add(r["report_date"])
        deduped.append(r)
    return deduped


def find_information_table(cik: str, accession: str) -> str:
    """Find and download the holdings information-table XML in a 13F filing."""
    cik_no_pad = str(int(cik))
    acc_no_dash = accession.replace("-", "")
    idx_url = f"{EDGAR_ARCHIVES}/{cik_no_pad}/{acc_no_dash}/index.json"
    items = json.loads(http_get(idx_url))["directory"]["item"]
    candidates = [it["name"] for it in items if it["name"].lower().endswith(".xml")]
    # Prefer obvious filenames first, then fall back to scanning content.
    candidates.sort(key=lambda n: (
        0 if "infotable" in n.lower() or "informationtable" in n.lower() else 1,
        len(n),
    ))
    for name in candidates:
        url = f"{EDGAR_ARCHIVES}/{cik_no_pad}/{acc_no_dash}/{name}"
        xml = http_get(url)
        if b"informationTable" in xml and b"infoTable" in xml:
            return xml.decode("utf-8", errors="replace")
    raise FileNotFoundError(f"information table not found in {accession}")


def parse_holdings(xml_text: str) -> list[dict]:
    root = ET.fromstring(xml_text)
    rows = []
    for it in root.findall(f"{NS_INFO}infoTable"):
        def text(tag: str) -> str:
            el = it.find(f"{NS_INFO}{tag}")
            return (el.text or "").strip() if el is not None else ""

        sh_el = it.find(f"{NS_INFO}shrsOrPrnAmt")
        shares = 0
        sh_type = ""
        if sh_el is not None:
            n = sh_el.find(f"{NS_INFO}sshPrnamt")
            t = sh_el.find(f"{NS_INFO}sshPrnamtType")
            shares = int((n.text or "0").strip()) if n is not None else 0
            sh_type = (t.text or "").strip() if t is not None else ""

        rows.append({
            "issuer": text("nameOfIssuer"),
            "class": text("titleOfClass"),
            "cusip": text("cusip"),
            "value_usd": int((text("value") or "0").replace(",", "") or 0),
            "shares": shares,
            "share_type": sh_type,
            "put_call": text("putCall"),
        })
    return rows


def aggregate(rows: list[dict]) -> dict[str, dict]:
    agg: dict[str, dict] = {}
    for r in rows:
        key = f"{r['cusip']}|{r['class']}|{r['put_call']}"
        e = agg.get(key)
        if e is None:
            agg[key] = {**r, "shares": r["shares"], "value_usd": r["value_usd"]}
        else:
            e["shares"] += r["shares"]
            e["value_usd"] += r["value_usd"]
    return agg


def build_holdings(curr: dict[str, dict], prev: dict[str, dict]) -> tuple[list[dict], list[dict]]:
    """Return (current-quarter holdings, exited holdings).

    Each row has shares/value for both quarters and a delta + action so the
    portal can show stock-on-hand and what changed in a single table.
    """
    holdings: list[dict] = []
    for k, c in curr.items():
        p = prev.get(k)
        prior_shares = p["shares"] if p else 0
        prior_value = p["value_usd"] if p else 0
        delta_shares = c["shares"] - prior_shares
        delta_value = c["value_usd"] - prior_value
        if p is None:
            action = "new"
        elif delta_shares > 0:
            action = "add"
        elif delta_shares < 0:
            action = "trim"
        else:
            action = "hold"
        holdings.append({
            "issuer": c["issuer"], "class": c["class"], "cusip": c["cusip"],
            "put_call": c["put_call"], "share_type": c["share_type"],
            "shares": c["shares"], "value_usd": c["value_usd"],
            "shares_prior": prior_shares, "value_usd_prior": prior_value,
            "delta_shares": delta_shares, "delta_value_usd": delta_value,
            "action": action,
        })

    exited: list[dict] = []
    for k, p in prev.items():
        if k in curr:
            continue
        exited.append({
            "issuer": p["issuer"], "class": p["class"], "cusip": p["cusip"],
            "put_call": p["put_call"], "share_type": p["share_type"],
            "shares": 0, "value_usd": 0,
            "shares_prior": p["shares"], "value_usd_prior": p["value_usd"],
            "delta_shares": -p["shares"], "delta_value_usd": -p["value_usd"],
            "action": "exit",
        })

    holdings.sort(key=lambda r: r["value_usd"], reverse=True)
    exited.sort(key=lambda r: r["value_usd_prior"], reverse=True)
    return holdings, exited


def top_buys_sells(holdings: list[dict], exited: list[dict], top_n: int) -> tuple[list[dict], list[dict]]:
    buys = sorted(
        (h for h in holdings if h["action"] in ("new", "add")),
        key=lambda r: r["delta_value_usd"], reverse=True,
    )[:top_n]
    sells = sorted(
        [h for h in holdings if h["action"] == "trim"] + exited,
        key=lambda r: r["delta_value_usd"],
    )[:top_n]
    return buys, sells


def process_filer(name: str, cik: str, top_n: int) -> dict:
    filings = get_recent_13f(cik)
    if not filings:
        return {"name": name, "cik": cik, "error": "no 13F-HR filings found"}
    latest = filings[0]
    prior = filings[1] if len(filings) > 1 else None
    latest_rows = parse_holdings(find_information_table(cik, latest["accession"]))
    curr_agg = aggregate(latest_rows)
    prior_agg: dict[str, dict] = {}
    out: dict = {
        "name": name,
        "cik": cik,
        "latest_filing": latest,
        "holdings_count": len(curr_agg),
        "total_value_usd": sum(r["value_usd"] for r in curr_agg.values()),
    }
    if prior:
        prior_rows = parse_holdings(find_information_table(cik, prior["accession"]))
        prior_agg = aggregate(prior_rows)
        out["prior_filing"] = prior
        out["holdings_count_prior"] = len(prior_agg)
        out["total_value_usd_prior"] = sum(r["value_usd"] for r in prior_agg.values())
    holdings, exited = build_holdings(curr_agg, prior_agg)
    buys, sells = top_buys_sells(holdings, exited, top_n)
    out["holdings"] = holdings
    out["exited"] = exited
    out["top_buys"] = buys
    out["top_sells"] = sells
    return out


def slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")


SUMMARY_FIELDS = (
    "name", "cik", "error", "latest_filing", "prior_filing",
    "holdings_count", "holdings_count_prior",
    "total_value_usd", "total_value_usd_prior",
)


def _summary_entry(res: dict) -> dict:
    """Slim per-filer dict for summary.json (no holdings/exited/top_*).

    The portal fetches the per-filer file when it needs detail; keeping
    summary.json small avoids shipping every holding twice.
    """
    return {k: res[k] for k in SUMMARY_FIELDS if k in res}


def run(investors_path: Path, out_dir: Path, top_n: int) -> int:
    investors = json.loads(investors_path.read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = {"generated_at": date.today().isoformat(), "filers": []}
    failures = 0
    for inv in investors:
        try:
            res = process_filer(inv["name"], inv["cik"], top_n=top_n)
        except Exception as e:
            res = {"name": inv["name"], "cik": inv["cik"], "error": f"{type(e).__name__}: {e}"}
            failures += 1
        summary["filers"].append(_summary_entry(res))
        (out_dir / f"{slug(inv['name'])}.json").write_text(json.dumps(res, indent=2))
        status = "ok" if "error" not in res else f"ERROR: {res['error']}"
        print(f"[{inv['name']}] {status}", file=sys.stderr)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    return 1 if failures == len(investors) else 0


def smoke_test_offline(fixtures_dir: Path, out_dir: Path) -> int:
    """Generate sample per-filer + summary JSON from bundled XML fixtures.

    Writes the same shape as a live run so the portal can be exercised
    without SEC network access.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    curr_rows = parse_holdings((fixtures_dir / "current.xml").read_text())
    prev_rows = parse_holdings((fixtures_dir / "prior.xml").read_text())
    # Sanity check: catch a regression where the parser silently returns 0
    # rows (e.g. a future SEC schema namespace change).
    if not curr_rows or not prev_rows:
        print(
            f"smoke-test: expected non-empty holdings (current={len(curr_rows)}, "
            f"prior={len(prev_rows)}); fixtures or parser likely broken",
            file=sys.stderr,
        )
        return 2
    curr_agg = aggregate(curr_rows)
    prev_agg = aggregate(prev_rows)
    holdings, exited = build_holdings(curr_agg, prev_agg)
    if not holdings and not exited:
        print("smoke-test: expected at least one diff row, got none", file=sys.stderr)
        return 2
    buys, sells = top_buys_sells(holdings, exited, top_n=25)
    today = date.today().isoformat()

    fake_filers = [
        ("Berkshire Hathaway", "1067983"),
        ("BlackRock",          "1364742"),
    ]
    summary = {"generated_at": today, "filers": []}
    for name, cik in fake_filers:
        payload = {
            "name": name,
            "cik": cik,
            "latest_filing": {"form": "13F-HR", "filing_date": today,
                              "report_date": today, "accession": "FIXTURE",
                              "primary_doc": "fixture.xml"},
            "prior_filing": {"form": "13F-HR", "filing_date": "PRIOR",
                             "report_date": "PRIOR", "accession": "FIXTURE-PRIOR",
                             "primary_doc": "fixture.xml"},
            "holdings_count": len(curr_agg),
            "holdings_count_prior": len(prev_agg),
            "total_value_usd": sum(r["value_usd"] for r in curr_agg.values()),
            "total_value_usd_prior": sum(r["value_usd"] for r in prev_agg.values()),
            "holdings": holdings,
            "exited": exited,
            "top_buys": buys,
            "top_sells": sells,
        }
        (out_dir / f"{slug(name)}.json").write_text(json.dumps(payload, indent=2))
        summary["filers"].append({k: payload[k] for k in (
            "name", "cik", "latest_filing", "holdings_count",
            "holdings_count_prior", "total_value_usd", "total_value_usd_prior")})
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(f"wrote {len(fake_filers)} filer JSONs + summary.json to {out_dir}", file=sys.stderr)
    return 0


def main() -> int:
    here = Path(__file__).parent
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--investors", default=str(here / "investors.json"))
    p.add_argument("--out-dir", default=str(here / "data"))
    p.add_argument("--top-n", type=int, default=25)
    p.add_argument("--user-agent",
                   help="SEC requires an identifying User-Agent (e.g. 'Name email@x.com')")
    p.add_argument("--smoke-test", action="store_true",
                   help="Run offline against bundled fixtures (no network)")
    args = p.parse_args()

    if args.user_agent:
        global _UA
        _UA = args.user_agent

    if args.smoke_test:
        return smoke_test_offline(here / "fixtures", Path(args.out_dir))
    return run(Path(args.investors), Path(args.out_dir), args.top_n)


if __name__ == "__main__":
    sys.exit(main())

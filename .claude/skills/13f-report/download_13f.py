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
import statistics
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path
from xml.etree import ElementTree as ET

DEFAULT_UA = "Western welstein@gmail.com"
EDGAR_DATA = "https://data.sec.gov"
EDGAR_ARCHIVES = "https://www.sec.gov/Archives/edgar/data"
COMPANY_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:0>10}.json"
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


@lru_cache(maxsize=1)
def _company_tickers() -> list[dict]:
    """SEC's ticker/CIK/title list, fetched once per run (failures aren't cached)."""
    raw = json.loads(http_get(COMPANY_TICKERS_URL))
    return list(raw.values() if isinstance(raw, dict) else raw)


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
            "sector": classify_sector(c["issuer"]),
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
            "sector": classify_sector(p["issuer"]),
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
    if not latest_rows:
        # 0 rows from a real 13F-HR filing usually means our XML parsing
        # missed the namespace; surface it loudly rather than silently
        # writing empty arrays.
        print(
            f"[{name}] WARN: parsed 0 holdings from {latest['accession']} — "
            "schema may have changed",
            file=sys.stderr,
        )
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


def _fmt_usd(v: int) -> str:
    b = v / 1_000_000_000
    if b >= 1:
        return f"${b:.1f}B"
    return f"${v / 1_000_000:.0f}M"


def _pct(a: int, b: int) -> str:
    if not b:
        return "n/a"
    return f"{(a - b) / b * 100:+.1f}%"


# ---------------------------------------------------------------------------
# Sector classification
# ---------------------------------------------------------------------------

# Ordered list: first match wins. Keywords are matched against the
# upper-cased issuer name as it appears in the SEC filing.
_SECTOR_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Fund/ETF", (
        " ETF", "ISHARES", "SPDR ", "INVESCO QQQ", " FUND ", "PROSHARES",
        "DIREXION", "VANECK ", "WISDOMTREE",
    )),
    ("Technology", (
        "APPLE INC", "MICROSOFT", "NVIDIA", "BROADCOM", "TAIWAN SEMICONDUCTOR",
        "ASML HOLD", "SAMSUNG", "INTEL CORP", "QUALCOMM", "ADVANCED MICRO",
        "APPLIED MATERIALS", "LAM RESEARCH", "KLA CORP", "MICRON TECH",
        "ANALOG DEVICES", "TEXAS INSTRUMENTS", "NXP SEMI", "MARVELL TECH",
        "SKYWORKS", "QORVO", "MICROCHIP TECH", "WESTERN DIGITAL", "SEAGATE",
        "ORACLE CORP", "SAP SE", "SALESFORCE", "SERVICENOW", "WORKDAY",
        "SNOWFLAKE", "CROWDSTRIKE", "PALO ALTO", "FORTINET", "ZSCALER",
        "OKTA INC", "ADOBE INC", "AUTODESK", "INTUIT INC", "VEEVA",
        "DATADOG", "MONGODB", "CLOUDFLARE", "TWILIO", "SHOPIFY",
        "PAYPAL", "BLOCK INC", "SQUARE INC", "ARISTA NETWORKS",
        "CISCO SYSTEMS", "JUNIPER NETWORKS", "MOTOROLA SOLUTIONS",
        "ACCENTURE", "COGNIZANT", "INFOSYS", "WIPRO", "IBM CORP",
        "HEWLETT PACKARD", "HP INC", "DELL TECH", "NETAPP", "PURE STORAGE",
        "AKAMAI", "FASTLY INC", "UBER TECH", "LYFT INC",
        "ROBLOX", "UNITY SOFTWARE", "ELECTRONIC ARTS", "ACTIVISION",
        "TAKE-TWO", "NETFLIX INC",
        "SEMICONDUCTOR", "SOFTWARE INC", "SOFTWARE CORP", "TECHNOLOGIES INC",
        "TECHNOLOGIES CORP", "TECH CORP", "TECH INC", "DIGITAL INC",
        "CYBER", "COMPUTING INC",
    )),
    ("Communications", (
        "ALPHABET INC", "META PLATFORMS", "COMCAST CORP", "CHARTER COMM",
        "VERIZON COMM", "AT&T INC", "T-MOBILE US", "DISH NETWORK",
        "FOX CORP", "NEW YORK TIMES", "PARAMOUNT", "WARNER BROS",
        "SIRIUS XM", "PINTEREST INC", "SNAP INC", "SPOTIFY",
        "TELECOM", "TELECOMMUNICATIONS", "WIRELESS COMM", "BROADBAND",
        "MEDIA CORP", "BROADCASTING",
    )),
    ("Healthcare", (
        "UNITEDHEALTH", "JOHNSON & JOHNSON", "ABBVIE INC", "ELI LILLY",
        "PFIZER INC", "MERCK & CO", "BRISTOL-MYERS", "AMGEN INC",
        "GILEAD SCIENCES", "REGENERON", "VERTEX PHARMA", "BIOGEN INC",
        "MODERNA INC", "BIONTECH", "ASTRAZENECA", "NOVARTIS", "NOVO NORDISK",
        "ROCHE HOLD", "SANOFI", "GLAXOSMITHKLINE", "GSK PLC",
        "MEDTRONIC", "ABBOTT LABS", "BECTON DICKINSON", "ZIMMER BIOMET",
        "STRYKER CORP", "BOSTON SCIENTIFIC", "EDWARDS LIFESCIENCES",
        "INTUITIVE SURGICAL", "DANAHER CORP", "ILLUMINA INC",
        "THERMO FISHER", "AGILENT TECH", "WATERS CORP",
        "CVS HEALTH", "WALGREEN", "MCKESSON CORP", "AMERISOURCE",
        "CARDINAL HEALTH", "CIGNA CORP", "HUMANA INC", "ELEVANCE",
        "CENTENE CORP", "MOLINA HEALTH",
        "PHARMA", "BIOTECH", "THERAPEUTICS", "BIOSCIENCES", "ONCOLOGY",
        "GENOMICS", "MEDICAL CORP", "MEDICAL INC", "HEALTH CORP",
        "CLINICAL", "DIAGNOSTIC", "SURGICAL INC", "LABORATORY",
    )),
    ("Financials", (
        "JPMORGAN CHASE", "BANK OF AMERICA", "WELLS FARGO", "CITIGROUP",
        "GOLDMAN SACHS", "MORGAN STANLEY", "BLACKROCK INC",
        "BERKSHIRE HATHAWAY", "VISA INC", "MASTERCARD INC",
        "AMERICAN EXPRESS", "CHARLES SCHWAB", "STATE STREET CORP",
        "NORTHERN TRUST", "BANK OF NEW YORK", "BNY MELLON",
        "AMERICAN INTERNATIONAL", "CHUBB LTD", "PROGRESSIVE CORP",
        "TRAVELERS COS", "ALLSTATE CORP", "METLIFE INC", "PRUDENTIAL",
        "AFLAC INC", "LINCOLN NATIONAL", "CME GROUP", "CBOE GLOBAL",
        "INTERCONTINENTAL EXCHANGE", "NASDAQ INC", "MOODY", "S&P GLOBAL",
        "MSCI INC", "FACTSET",
        "BANK CORP", "BANK INC", "BANCORP", "FINANCIAL CORP",
        "FINANCIAL INC", "FINANCIAL GROUP", "INSURANCE CO",
        "INSURANCE CORP", "CAPITAL CORP", "CAPITAL INC",
        "ASSET MANAGEMENT", "SECURITIES CORP", "MORTGAGE CORP",
        "CREDIT CORP", "LENDING INC",
    )),
    ("Energy", (
        "EXXON MOBIL", "CHEVRON CORP", "CONOCOPHILLIPS", "PIONEER NATURAL",
        "DEVON ENERGY", "EOG RESOURCES", "SCHLUMBERGER", "HALLIBURTON",
        "BAKER HUGHES", "WILLIAMS COS", "KINDER MORGAN",
        "ENTERPRISE PRODUCTS", "MARATHON OIL", "MARATHON PETROLEUM",
        "VALERO ENERGY", "PHILLIPS 66", "OCCIDENTAL PETROLEUM",
        "DIAMONDBACK ENERGY", "COTERRA ENERGY", "ENPHASE ENERGY",
        "FIRST SOLAR", "SUNRUN INC", "NEXTERA ENERGY",
        "ENERGY CORP", "ENERGY INC", "OIL CORP", "OIL INC",
        "PETROLEUM CORP", "PIPELINE CORP", "REFINING CORP",
        "DRILLING CORP", "EXPLORATION CORP",
    )),
    ("Consumer Discretionary", (
        "AMAZON COM", "TESLA INC", "HOME DEPOT", "LOWE'S COS",
        "MCDONALD'S CORP", "STARBUCKS CORP", "YUM BRANDS",
        "NIKE INC", "LULULEMON", "RALPH LAUREN",
        "FORD MOTOR", "GENERAL MOTORS", "STELLANTIS",
        "MARRIOTT INTL", "HILTON WORLDWIDE", "HYATT HOTELS", "WYNDHAM",
        "BOOKING HOLDINGS", "AIRBNB INC", "EXPEDIA GROUP",
        "WALT DISNEY", "WARNER BROS DISCOVERY",
        "ROSS STORES", "TJX COMPANIES", "BURLINGTON STORES",
        "AUTOZONE INC", "O'REILLY AUTO", "ADVANCE AUTO",
        "CARNIVAL CORP", "ROYAL CARIBBEAN", "NORWEGIAN CRUISE",
        "RETAIL CORP", "RETAIL INC", "APPAREL INC",
        "RESTAURANTS INC", "HOTELS INC", "LUXURY INC",
    )),
    ("Consumer Staples", (
        "WALMART INC", "COSTCO WHOLESALE", "PROCTER & GAMBLE",
        "COCA-COLA CO", "COCA COLA CO", "PEPSICO INC", "MONSTER BEVERAGE",
        "PHILIP MORRIS", "ALTRIA GROUP", "BRITISH AMERICAN TOBACCO",
        "NESTLE SA", "UNILEVER PLC", "DIAGEO PLC", "BROWN-FORMAN",
        "GENERAL MILLS", "KELLOGG CO", "KRAFT HEINZ", "CAMPBELL SOUP",
        "HERSHEY CO", "MONDELEZ", "CONAGRA BRANDS", "COLGATE-PALMOLIVE",
        "KIMBERLY-CLARK", "CHURCH & DWIGHT",
        "SYSCO CORP", "US FOODS",
        "GROCERY", "BEVERAGE CORP", "TOBACCO CORP",
        "HOUSEHOLD PRODUCTS",
    )),
    ("Industrials", (
        "BOEING CO", "LOCKHEED MARTIN", "RAYTHEON TECH", "NORTHROP GRUMMAN",
        "GENERAL DYNAMICS", "L3HARRIS", "TEXTRON INC",
        "CATERPILLAR INC", "DEERE & CO", "ILLINOIS TOOL",
        "PARKER HANNIFIN", "HONEYWELL INTL", "EMERSON ELECTRIC",
        "EATON CORP", "ROCKWELL AUTOMATION",
        "UNITED PARCEL", "FEDEX CORP", "XPO INC", "OLD DOMINION",
        "UNION PACIFIC", "CSX CORP", "NORFOLK SOUTHERN",
        "GENERAL ELECTRIC", "3M CO", "MMM INC",
        "WASTE MANAGEMENT", "REPUBLIC SERVICES",
        "FASTENAL CO", "W.W. GRAINGER",
        "AEROSPACE CORP", "DEFENSE CORP", "INDUSTRIAL CORP",
        "MANUFACTURING CORP", "MACHINERY CORP", "ENGINEERING CORP",
        "LOGISTICS CORP", "FREIGHT CORP", "RAILROAD CORP",
    )),
    ("Real Estate", (
        "PROLOGIS INC", "AMERICAN TOWER", "CROWN CASTLE",
        "SBA COMMUNICATIONS", "SIMON PROPERTY", "BROOKFIELD",
        "WELLTOWER INC", "VENTAS INC", "EQUINIX INC",
        "DIGITAL REALTY", "IRON MOUNTAIN", "EXTRA SPACE STORAGE",
        "PUBLIC STORAGE", "LIFE STORAGE", "REALTY INCOME",
        "NATIONAL RETAIL", "AGREE REALTY",
        "REIT", "REAL ESTATE", "REALTY CORP", "REALTY INC",
        "PROPERTY TRUST", "PROPERTIES INC", "PROPERTIES CORP",
        "APARTMENT", "RESIDENTIAL TRUST",
    )),
    ("Utilities", (
        "DUKE ENERGY", "SOUTHERN CO", "DOMINION ENERGY",
        "AMERICAN ELECTRIC POWER", "XCEL ENERGY", "EVERSOURCE ENERGY",
        "CONSOLIDATED EDISON", "PUBLIC SERVICE ENTERPRISE",
        "SEMPRA ENERGY", "WEC ENERGY", "ENTERGY CORP",
        "FIRSTENERGY CORP", "PPL CORP", "AMERICAN WATER WORKS",
        "UTILITIES INC", "ELECTRIC POWER CORP",
        "UTILITY CORP", "WATER WORKS CORP",
    )),
    ("Materials", (
        "LINDE PLC", "AIR PRODUCTS", "DOW INC", "DUPONT DE NEMOURS",
        "LYONDELLBASELL", "EASTMAN CHEMICAL", "CELANESE CORP",
        "FREEPORT-MCMORAN", "NEWMONT CORP", "BARRICK GOLD",
        "AGNICO EAGLE", "NUCOR CORP", "STEEL DYNAMICS",
        "ALCOA CORP", "RIO TINTO", "BHP GROUP",
        "CHEMICAL CORP", "CHEMICAL INC", "CHEMICALS CORP",
        "MATERIALS CORP", "METALS INC", "MINING CORP",
        "STEEL CORP", "ALUMINUM CORP", "GOLD CORP",
    )),
]


def classify_sector(issuer: str) -> str:
    name = issuer.upper()
    for sector, keywords in _SECTOR_RULES:
        if any(kw in name for kw in keywords):
            return sector
    return "Other"


# ---------------------------------------------------------------------------
# Multi-quarter history (incremental — built up across runs)
# ---------------------------------------------------------------------------

def _quarter_snapshot(filer: dict) -> dict:
    holdings = filer.get("holdings") or []
    total = filer.get("total_value_usd", 0)
    top5 = [
        {
            "issuer": h["issuer"],
            "cusip": h["cusip"],
            "value_usd": h["value_usd"],
            "pct_of_portfolio": round(h["value_usd"] / total * 100, 2) if total else 0,
        }
        for h in holdings[:5]
    ]
    return {
        "quarter": (filer.get("latest_filing") or {}).get("report_date", ""),
        "filing_date": (filer.get("latest_filing") or {}).get("filing_date", ""),
        "total_value_usd": total,
        "holdings_count": filer.get("holdings_count", 0),
        "top5_holdings": top5,
    }


def _is_quarter_end(d: str) -> bool:
    return d[5:] in ("03-31", "06-30", "09-30", "12-31")


def merge_history(existing: list[dict], filer: dict, max_quarters: int = 8) -> list[dict]:
    # 13F report dates are always calendar quarter-ends. Anything else is a
    # --smoke-test snapshot (report_date = today) that must not land in, or
    # linger in, a real filer's history.
    snapshot = _quarter_snapshot(filer)
    quarter = snapshot["quarter"]
    existing = [q for q in existing if _is_quarter_end(q.get("quarter", ""))]
    if not _is_quarter_end(quarter):
        return existing
    updated = [q for q in existing if q.get("quarter") != quarter]
    updated.append(snapshot)
    updated.sort(key=lambda q: q.get("quarter", ""), reverse=True)
    return updated[:max_quarters]


# ---------------------------------------------------------------------------
# Conviction score (cross-filer, computed after all filers are processed)
# ---------------------------------------------------------------------------

def build_conviction_rankings(results: list[dict], top_n: int = 50) -> list[dict]:
    """Rank stocks by how many of the tracked managers hold them.

    conviction_score = (holder_count / total_filers) * 100
    weighted_score   = sum of (holding_value / filer_aum) across holders * 100
    """
    valid = [r for r in results if "error" not in r]
    total_filers = len(valid)
    if not total_filers:
        return []

    # CUSIP → aggregated data
    cusip_map: dict[str, dict] = {}
    for filer in valid:
        aum = filer.get("total_value_usd") or 0
        for h in (filer.get("holdings") or []):
            cusip = h["cusip"]
            if not cusip:
                continue
            if cusip not in cusip_map:
                cusip_map[cusip] = {
                    "issuer": h["issuer"],
                    "cusip": cusip,
                    "sector": h.get("sector", "Other"),
                    "total_value_usd": 0,
                    "holder_count": 0,
                    "holders": [],
                    "weighted_score": 0.0,
                }
            entry = cusip_map[cusip]
            entry["total_value_usd"] += h["value_usd"]
            entry["holder_count"] += 1
            portfolio_weight = h["value_usd"] / aum * 100 if aum else 0
            entry["weighted_score"] += portfolio_weight
            entry["holders"].append({
                "name": filer["name"],
                "cik": filer["cik"],
                "action": h["action"],
                "value_usd": h["value_usd"],
                "portfolio_weight_pct": round(portfolio_weight, 2),
            })

    rankings = []
    for entry in cusip_map.values():
        entry["conviction_score"] = round(entry["holder_count"] / total_filers * 100, 1)
        entry["weighted_score"] = round(entry["weighted_score"], 2)
        # majority action among holders
        actions = [h["action"] for h in entry["holders"]]
        entry["net_action"] = max(set(actions), key=actions.count)
        entry["holders"].sort(key=lambda h: h["value_usd"], reverse=True)
        rankings.append(entry)

    rankings.sort(key=lambda e: (e["holder_count"], e["weighted_score"]), reverse=True)
    return rankings[:top_n]


def build_aggregates(results: list[dict], top_n: int = 10) -> dict:
    """Cross-filer aggregates for the portal's Overview and Quiet Accumulation
    views -> data/aggregates.json.

    Both views used to download every filer's full JSON (~36 MB) and fold it
    in the browser, which is slow and heavy on a phone. This is the same
    folding, done once per refresh:

    - consensus: top buys / sells by summed Δ value per (cusip, class,
      put_call) over holdings + exits.
    - accumulation: per cusip, the filers that bought it (new/add) and opened
      it (new), with net $ bought. Only names in no filer's top 10 and bought
      by 2+ filers, since that is all the view can show. Filers are listed
      once in `filers` and referenced by index.
    """
    valid = [r for r in results if "error" not in r]
    names = [r["name"] for r in valid]

    moves: dict[str, dict] = {}
    for r in valid:
        for h in (*r.get("holdings", ()), *r.get("exited", ())):
            if not h.get("cusip") or not h.get("delta_value_usd"):
                continue
            key = f"{h['cusip']}|{h.get('class') or ''}|{h.get('put_call') or ''}"
            e = moves.setdefault(key, {
                "issuer": h.get("issuer"), "cusip": h["cusip"], "class": h.get("class"),
                "put_call": h.get("put_call"), "delta_value_usd": 0, "filers": [], "actions": [],
            })
            e["delta_value_usd"] += h["delta_value_usd"]
            if r["name"] not in e["filers"]:
                e["filers"].append(r["name"])
            if h.get("action") not in e["actions"]:
                e["actions"].append(h.get("action"))
    rows = list(moves.values())
    buys = sorted((m for m in rows if m["delta_value_usd"] > 0), key=lambda m: -m["delta_value_usd"])
    sells = sorted((m for m in rows if m["delta_value_usd"] < 0), key=lambda m: m["delta_value_usd"])

    profiles: dict[str, dict] = {}

    def profile(cusip: str, issuer: str = "", sector=None) -> dict:
        return profiles.setdefault(cusip, {"cusip": cusip, "issuer": issuer, "sector": sector,
                                           "buyers": [], "new": [], "net_buy_usd": 0, "top10": 0})

    for idx, r in enumerate(valid):
        holdings = r.get("holdings") or []
        top10 = dict.fromkeys(h.get("cusip") for h in
                              sorted(holdings, key=lambda h: -(h.get("value_usd") or 0))[:10])
        for cusip in top10:
            profile(cusip)["top10"] += 1
        for h in holdings:
            if h.get("put_call"):  # long common/preferred only
                continue
            p = profile(h.get("cusip"), h.get("issuer") or "", h.get("sector"))
            p["issuer"] = p["issuer"] or h.get("issuer") or ""
            p["sector"] = p["sector"] or h.get("sector")
            if h.get("action") in ("new", "add"):
                if idx not in p["buyers"]:
                    p["buyers"].append(idx)
                if (h.get("delta_value_usd") or 0) > 0:
                    p["net_buy_usd"] += h["delta_value_usd"]
                if h.get("action") == "new" and idx not in p["new"]:
                    p["new"].append(idx)
    accumulation = [{k: v for k, v in p.items() if k != "top10"} for p in profiles.values()
                    if p["top10"] == 0 and p["issuer"] and len(p["buyers"]) >= 2]

    return {
        "generated_at": date.today().isoformat(),
        "filers": names,
        "consensus": {"buys": buys[:top_n], "sells": sells[:top_n]},
        "accumulation": accumulation,
    }


def write_aggregates(results: list[dict], out_dir: Path) -> None:
    (out_dir / "aggregates.json").write_text(
        json.dumps(build_aggregates(results), separators=(",", ":")) + "\n")


def build_summary(filer: dict) -> dict:
    """Derive a structured summary purely from the filer data — no LLM needed."""
    holdings = filer.get("holdings") or []
    exited = filer.get("exited") or []
    top_buys = filer.get("top_buys") or []
    top_sells = filer.get("top_sells") or []

    total = filer.get("total_value_usd", 0)
    total_prior = filer.get("total_value_usd_prior") or 0
    count = filer.get("holdings_count", 0)
    count_prior = filer.get("holdings_count_prior") or 0

    new_positions = [h for h in holdings if h["action"] == "new"]
    added = [h for h in holdings if h["action"] == "add"]
    trimmed = [h for h in holdings if h["action"] == "trim"]
    held = [h for h in holdings if h["action"] == "hold"]

    top10_value = sum(h["value_usd"] for h in holdings[:10])
    concentration_pct = round(top10_value / total * 100, 1) if total else 0

    def _holding_snapshot(h: dict) -> dict:
        return {
            "issuer": h["issuer"],
            "cusip": h["cusip"],
            "action": h["action"],
            "shares": h["shares"],
            "shares_prior": h["shares_prior"],
            "delta_shares": h["delta_shares"],
            "value_usd": h["value_usd"],
            "delta_value_usd": h["delta_value_usd"],
            "delta_pct": _pct(h["shares"], h["shares_prior"]) if h["shares_prior"] else "new",
        }

    sector_breakdown: dict[str, dict] = {}
    for h in holdings:
        s = h.get("sector", "Other")
        if s not in sector_breakdown:
            sector_breakdown[s] = {"value_usd": 0, "count": 0}
        sector_breakdown[s]["value_usd"] += h["value_usd"]
        sector_breakdown[s]["count"] += 1
    for s in sector_breakdown:
        sector_breakdown[s]["pct_of_portfolio"] = round(
            sector_breakdown[s]["value_usd"] / total * 100, 2
        ) if total else 0
    sector_breakdown_list = sorted(
        [{"sector": s, **v} for s, v in sector_breakdown.items()],
        key=lambda x: x["value_usd"], reverse=True,
    )

    return {
        "quarter": (filer.get("latest_filing") or {}).get("report_date", ""),
        "aum_usd": total,
        "aum_usd_prior": total_prior,
        "aum_change_pct": _pct(total, total_prior) if total_prior else "n/a",
        "holdings_count": count,
        "holdings_count_prior": count_prior,
        "holdings_count_change": count - count_prior,
        "new_positions_count": len(new_positions),
        "added_count": len(added),
        "trimmed_count": len(trimmed),
        "held_count": len(held),
        "exited_count": len(exited),
        "top10_concentration_pct": concentration_pct,
        "sector_breakdown": sector_breakdown_list,
        "largest_new_positions": [_holding_snapshot(h) for h in new_positions[:5]],
        "largest_exits": [_holding_snapshot(h) for h in exited[:5]],
        "top_buys": [_holding_snapshot(h) for h in top_buys[:5]],
        "top_sells": [_holding_snapshot(h) for h in top_sells[:5]],
        "largest_holdings": [_holding_snapshot(h) for h in holdings[:10]],
    }


def slug(name: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in name.lower()).strip("_")


SUMMARY_FIELDS = (
    "name", "cik", "error", "latest_filing", "prior_filing",
    "holdings_count", "holdings_count_prior",
    "total_value_usd", "total_value_usd_prior",
    "summary", "history",
)


def _summary_entry(res: dict) -> dict:
    """Slim per-filer dict for summary.json (no holdings/exited/top_*).

    The portal fetches the per-filer file when it needs detail; keeping
    summary.json small avoids shipping every holding twice.
    """
    return {k: res[k] for k in SUMMARY_FIELDS if k in res}


# Corporate-name noise to drop before matching a 13F issuer string against
# SEC's company list. 13F issuers read like "APPLE INC" / "COCA COLA CO";
# SEC titles read like "Apple Inc.". Normalizing both to a bare core name lets
# them line up.
_NAME_STOPWORDS = {
    "INC", "INCORPORATED", "CORP", "CORPORATION", "CO", "COMPANY", "COMPANIES",
    "LTD", "LIMITED", "PLC", "LLC", "LP", "NV", "SA", "AG", "AB", "SE",
    "HLDG", "HLDGS", "HOLDING", "HOLDINGS", "GROUP", "GRP", "THE", "COM",
    "CL", "CLASS", "A", "B", "C", "NEW", "DEL", "TR", "TRUST", "ADR", "ADS",
    "SH", "SHS", "ORD", "REIT", "SPONSORED", "OF", "AND", "DE",
}


# 13F issuer strings are abbreviated ("CISCO SYS INC", "APPLIED MATLS INC");
# SEC titles mostly aren't. Fold both spellings onto one canonical token.
_NAME_ABBREV = {
    "SYSTEMS": "SYS", "SYSTEM": "SYS", "MATERIALS": "MATLS", "INSTRUMENTS": "INSTRS",
    "FINANCIAL": "FINL", "SERVICES": "SVCS", "PROPERTY": "PPTY", "PROPERTIES": "PPTYS",
    "INTERNATIONAL": "INTL", "MACHINES": "MACHS", "TECHNOLOGIES": "TECH",
    "TECHNOLOGY": "TECH", "LABORATORIES": "LABS", "PHARMACEUTICALS": "PHARMA",
    "COMMUNICATIONS": "COMMS", "MANUFACTURING": "MFG", "INDUSTRIES": "INDS",
    "AMERICA": "AMER", "BANCORPORATION": "BANCORP", "HLDNGS": "HOLDINGS",
}


def _normalize_issuer(name: str) -> str:
    """Reduce a company name to a comparable core token string.

    Tokens are abbreviation-folded and sorted so word order doesn't matter
    ("DISNEY WALT CO" and "Walt Disney Co" both become "DISNEY WALT").
    """
    cleaned = []
    for ch in (name or "").upper():
        cleaned.append(ch if ch.isalnum() or ch == " " else " ")
    tokens = (_NAME_ABBREV.get(t, t) for t in "".join(cleaned).split())
    return " ".join(sorted(t for t in tokens if t and t not in _NAME_STOPWORDS))


def enrich_tickers(all_results: list[dict], out_dir: Path) -> None:
    """Best-effort CUSIP→ticker map written to data/tickers.json.

    Hand-curated entries already in tickers.json always win; this only *fills
    in* CUSIPs that have no ticker yet, by matching each holding's issuer name
    against SEC's official company_tickers.json. Wrapped so any failure (no
    network, schema change) leaves the existing map untouched and never breaks
    the data refresh.
    """
    path = out_dir / "tickers.json"
    try:
        existing = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(existing, dict):
            existing = {}
    except Exception:
        existing = {}

    # CUSIPs still missing a ticker, keyed to every issuer spelling the filers
    # used for it (filers abbreviate differently, so any one may match).
    want: dict[str, set[str]] = {}
    for res in all_results:
        if "error" in res:
            continue
        for arr in ("holdings", "exited"):
            for h in res.get(arr, ()):
                cusip, issuer = h.get("cusip"), h.get("issuer")
                if cusip and issuer and cusip not in existing:
                    want.setdefault(cusip, set()).add(issuer)
    if not want:
        return

    try:
        sec_rows = _company_tickers()
    except Exception as e:
        print(f"ticker enrichment skipped (SEC company_tickers fetch failed: {e})",
              file=sys.stderr)
        return

    # normalized title -> (ticker, cik), but only when the normalized name maps
    # to a single company (ambiguous names are left unmatched on purpose). One
    # company listing several tickers (preferreds, share classes) is not
    # ambiguous: SEC lists the primary ticker first, so the first one wins.
    by_name: dict[str, tuple[str, object] | None] = {}
    for row in sec_rows:
        title, ticker, cik = row.get("title"), row.get("ticker"), row.get("cik_str")
        if not title or not ticker:
            continue
        norm = _normalize_issuer(title)
        if not norm:
            continue
        if norm not in by_name:
            by_name[norm] = (ticker, cik)
        elif by_name[norm] is not None and by_name[norm][1] != cik:
            by_name[norm] = None

    added = 0
    for cusip, issuers in want.items():
        hits = {by_name[n] for n in map(_normalize_issuer, issuers) if by_name.get(n)}
        if len(hits) == 1:
            existing[cusip] = next(iter(hits))[0]
            added += 1

    if added:
        path.write_text(json.dumps(dict(sorted(existing.items())), indent=0) + "\n")
    print(f"ticker enrichment: +{added} new (of {len(want)} unmapped), "
          f"{len(existing)} total", file=sys.stderr)


# --- EDGAR fundamentals (for the portal's per-stock thesis card) -----------
# XBRL concept fallbacks — companies tag the same line item differently, and
# foreign filers use the IFRS taxonomy, so we try several tags per metric.
_REVENUE_TAGS = ("RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues",
                 "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet",
                 "Revenue")  # bare "Revenue" is the IFRS tag for 20-F filers
_NET_INCOME_TAGS = ("NetIncomeLoss", "ProfitLoss")
_OCF_TAGS = ("NetCashProvidedByUsedInOperatingActivities",
             "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
             "CashFlowsFromUsedInOperatingActivities")
_CAPEX_TAGS = ("PaymentsToAcquirePropertyPlantAndEquipment",
               "PaymentsToAcquireProductiveAssets",
               "PurchaseOfPropertyPlantAndEquipment")
_CASH_TAGS = ("CashAndCashEquivalentsAtCarryingValue",
              "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents")
_DEBT_TAGS = ("LongTermDebt", "LongTermDebtNoncurrent")


def _fy_series(facts: dict, tags: tuple[str, ...]) -> dict[int, float]:
    """Map fiscal year -> annual value for the first XBRL tag that resolves.

    Scans both us-gaap and ifrs-full taxonomies; keeps annual figures
    (fp == 'FY', from a 10-K or 20-F), preferring the most-recently-filed entry
    for each fiscal year.
    """
    all_facts = facts.get("facts", {})
    for taxonomy in ("us-gaap", "ifrs-full"):
        concepts = all_facts.get(taxonomy, {})
        for tag in tags:
            node = concepts.get(tag)
            if not node:
                continue
            units = node.get("units", {})
            rows = units.get("USD") or next(iter(units.values()), [])
            series: dict[int, tuple[str, float]] = {}
            for e in rows:
                if e.get("fp") != "FY":
                    continue
                if e.get("form") not in ("10-K", "10-K/A", "20-F", "20-F/A"):
                    continue
                fy, val, filed = e.get("fy"), e.get("val"), e.get("filed", "")
                if fy is None or val is None:
                    continue
                prev = series.get(fy)
                if prev is None or filed >= prev[0]:
                    series[fy] = (filed, val)
            if series:
                return {fy: v for fy, (_, v) in series.items()}
    return {}


def _pct(n, d):
    return round(n / d * 100, 1) if d else None


def _compute_fundamentals(facts: dict, cik: str) -> dict | None:
    rev = _fy_series(facts, _REVENUE_TAGS)
    if len(rev) < 2:
        return None
    fy = max(rev)
    if not rev.get(fy) or not rev.get(fy - 1):
        return None
    ni = _fy_series(facts, _NET_INCOME_TAGS)
    ocf = _fy_series(facts, _OCF_TAGS)
    capex = _fy_series(facts, _CAPEX_TAGS)
    cash = _fy_series(facts, _CASH_TAGS)
    debt = _fy_series(facts, _DEBT_TAGS)

    def fcf(y):
        return (ocf[y] - capex[y]) if (y in ocf and y in capex) else None

    rev_now, rev_prior = rev[fy], rev[fy - 1]
    fcf_now = fcf(fy)
    # 3-years-prior anchor for the "transition" rows (fall back to earliest).
    y3 = fy - 3 if (fy - 3) in rev else min(rev)
    out = {
        "cik": str(int(cik)),
        "fiscal_year": fy,
        "revenue": rev_now,
        "revenue_prior": rev_prior,
        "revenue_growth_pct": _pct(rev_now - rev_prior, rev_prior),
        "net_income": ni.get(fy),
        "net_margin_pct": _pct(ni[fy], rev_now) if fy in ni else None,
        "net_margin_pct_3y": _pct(ni[y3], rev[y3]) if (y3 in ni and rev.get(y3)) else None,
        "fcf": fcf_now,
        "fcf_3y": fcf(y3),
        "fcf_margin_pct": _pct(fcf_now, rev_now) if fcf_now is not None else None,
        "cash": cash.get(fy),
        "total_debt": debt.get(fy),
        "as_of": date.today().isoformat(),
        "fy_3y": y3,
    }
    # Rule of 40 = revenue growth % + FCF margin % (only when both exist).
    if out["revenue_growth_pct"] is not None and out["fcf_margin_pct"] is not None:
        out["rule_of_40"] = round(out["revenue_growth_pct"] + out["fcf_margin_pct"], 1)
    return out


def enrich_fundamentals(all_results: list[dict], out_dir: Path,
                        max_fetch: int = 600) -> None:
    """Per-stock fundamentals from SEC EDGAR XBRL -> data/fundamentals.json.

    For every held security that maps to a ticker (tickers.json) and a CIK
    (company_tickers.json), pull companyfacts and compute revenue growth, net
    margin (+3y), FCF (+3y), Rule of 40, cash and debt. Incremental: tickers
    already present and fetched within ~80 days are skipped. Wrapped so any
    failure leaves the existing file intact and never breaks the refresh.
    """
    fund_path = out_dir / "fundamentals.json"
    tickers_path = out_dir / "tickers.json"
    try:
        cusip_ticker = json.loads(tickers_path.read_text()) if tickers_path.exists() else {}
    except Exception:
        cusip_ticker = {}
    if not cusip_ticker:
        return

    try:
        doc = json.loads(fund_path.read_text()) if fund_path.exists() else {}
        stocks = doc.get("stocks", {}) if isinstance(doc, dict) else {}
    except Exception:
        stocks = {}

    # Tickers actually held this quarter.
    held = set()
    for res in all_results:
        if "error" in res:
            continue
        for h in res.get("holdings", ()):
            t = cusip_ticker.get(h.get("cusip"))
            if t:
                held.add(t)
    if not held:
        return

    try:
        sec_rows = _company_tickers()
    except Exception as e:
        print(f"fundamentals enrichment skipped (company_tickers fetch failed: {e})",
              file=sys.stderr)
        return
    ticker_cik = {}
    for row in sec_rows:
        t, cik = row.get("ticker"), row.get("cik_str")
        if t and cik is not None:
            ticker_cik.setdefault(t.upper(), str(cik))

    today = date.today().isoformat()

    def is_fresh(entry):
        d = (entry or {}).get("as_of", "")
        # Skip refetch if fetched within ~80 days (fundamentals are quarterly).
        return bool(d) and (date.fromisoformat(today) - date.fromisoformat(d)).days < 80

    fetched = added = 0
    for ticker in sorted(held):
        if fetched >= max_fetch:
            print(f"fundamentals: hit max_fetch={max_fetch}; {len(held) - fetched} "
                  f"tickers deferred to a later run", file=sys.stderr)
            break
        if is_fresh(stocks.get(ticker)):
            continue
        cik = ticker_cik.get(ticker.upper())
        if not cik:
            continue
        fetched += 1
        try:
            facts = json.loads(http_get(COMPANY_FACTS_URL.format(cik=cik)))
            metrics = _compute_fundamentals(facts, cik)
        except Exception:
            continue
        if metrics:
            metrics["ticker"] = ticker
            stocks[ticker] = metrics
            added += 1

    doc = {"generated_at": today, "source": "SEC EDGAR XBRL companyfacts",
           "stocks": dict(sorted(stocks.items()))}
    fund_path.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"fundamentals enrichment: {added} computed this run "
          f"({fetched} fetched), {len(stocks)} total", file=sys.stderr)


# --- Valuation map (P/E vs EPS growth, PEG) for the portal ------------------
# SEC publishes no prices, but every 13F row carries market value *and* share
# count at quarter-end, so value / shares is the quarter-end price. The median
# across filers shrugs off the odd filer still reporting in $thousands.
#
# Earnings come from XBRL companyfacts (companyconcept, though smaller, serves
# empty or years-stale series for some filers, e.g. KO and ABT). Per taxonomy:
# EPS tags, net-income tags, diluted-share tags, each in preference order.
_VALUATION_TAGS = (
    ("us-gaap",
     ("EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted", "EarningsPerShareBasic"),
     ("NetIncomeLoss", "NetIncomeLossAvailableToCommonStockholdersBasic", "ProfitLoss"),
     ("WeightedAverageNumberOfDilutedSharesOutstanding",
      "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
      "WeightedAverageNumberOfSharesOutstandingBasic")),
    ("ifrs-full",
     ("DilutedEarningsLossPerShare",),
     ("ProfitLossAttributableToOwnersOfParent", "ProfitLoss"),
     ("AdjustedWeightedAverageShares", "WeightedAverageShares")),
)
_ANNUAL_FORMS = ("10-K", "10-K/A", "20-F", "20-F/A", "40-F", "40-F/A")
# Issuer-name hints for ETFs / index trusts (no earnings, not stocks).
_FUND_HINTS = ("ISHARES", "SPDR", "VANGUARD", " ETF", "INVESCO QQQ", "SELECT SECTOR",
               "PROSHARES", "VANECK", "WISDOMTREE", "DIREXION", "GLOBAL X", "INDEX FDS")
# EDGAR-derived fields cached between runs (earnings only move quarterly).
# Bump the version whenever their derivation changes, to drop stale caches.
_VALUATION_VERSION = 3
_VALUATION_INPUT_KEYS = ("eps_ttm", "eps_ttm_end", "net_income_ttm", "eps_fy_end",
                         "eps_history", "eps_cagr_3y_pct", "eps_cagr_5y_pct",
                         "skip", "fetched")


def _concept(facts: dict, taxonomy: str, tags: tuple[str, ...],
             good=lambda rows: True) -> tuple[list[dict], str, str] | None:
    """(facts, unit, tag) for the first of `tags` whose facts pass `good`.

    Companies switch tags over the years, so a tag can exist yet stop years
    ago; when none passes, the tag with the most recent fact wins.
    """
    best, best_end = None, ""
    concepts = facts.get("facts", {}).get(taxonomy, {})
    for tag in tags:
        units = (concepts.get(tag) or {}).get("units") or {}
        if not units:
            continue
        unit = next((u for u in ("USD/shares", "USD", "shares") if u in units),
                    next(iter(units)))
        rows = units[unit]
        if rows and good(rows):
            return rows, unit, tag
        last = max((e.get("end", "") for e in rows), default="")
        if best is None or last > best_end:
            best, best_end = (rows, unit, tag), last
    return best


def _last_end(rows: list[dict], annual_only: bool = False) -> str:
    return max((e["end"] for e in rows if e.get("end") and e.get("start")
                and (not annual_only or _is_annual(e["start"], e["end"]))), default="")


def _days(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def _is_annual(start: str, end: str) -> bool:
    return 350 <= _days(start, end) <= 380


def _durations(rows: list[dict]) -> dict[tuple[str, str], float]:
    """(start, end) -> value for duration facts; the latest filing wins."""
    best: dict[tuple[str, str], tuple[str, float]] = {}
    for e in rows:
        start, end, val = e.get("start"), e.get("end"), e.get("val")
        if not start or not end or val is None:
            continue
        filed = e.get("filed", "")
        if (start, end) not in best or filed >= best[(start, end)][0]:
            best[(start, end)] = (filed, val)
    return {k: v for k, (_, v) in best.items()}


def _annual_eps_chain(rows: list[dict], max_years: int = 5) -> list[tuple[str, float]]:
    """Annual EPS as [(fiscal-year end, eps)], newest first, on one share basis.

    A stock split makes an old filing's EPS incomparable with a new one, but
    each 10-K states its comparative years on the same basis. So each year is
    linked to the one before by their ratio *within* the newest filing that
    carries both, chaining back from the latest year.
    """
    by_accn: dict[str, dict[str, float]] = {}
    filed: dict[str, str] = {}
    for e in rows:
        start, end, val, accn = e.get("start"), e.get("end"), e.get("val"), e.get("accn")
        if not (start and end and accn) or val is None:
            continue
        if e.get("form") not in _ANNUAL_FORMS or not _is_annual(start, end):
            continue
        by_accn.setdefault(accn, {})[end] = val
        filed[accn] = max(filed.get(accn, ""), e.get("filed", ""))
    if not by_accn:
        return []
    newest_first = sorted(by_accn, key=lambda a: filed[a], reverse=True)
    ends = sorted({end for vals in by_accn.values() for end in vals}, reverse=True)
    cur = ends[0]
    val = next(by_accn[a][cur] for a in newest_first if cur in by_accn[a])
    chain = [(cur, val)]
    while len(chain) <= max_years:
        prev = next((e for e in ends if e < cur and 340 <= _days(e, cur) <= 390), None)
        if prev is None:
            break
        pair = next((by_accn[a] for a in newest_first
                     if by_accn[a].get(cur) and prev in by_accn[a]), None)
        if pair is None:
            break
        val = val * pair[prev] / pair[cur]
        chain.append((prev, val))
        cur = prev
    return chain


def _cagr_pct(chain: list[tuple[str, float]], years: int) -> float | None:
    if len(chain) <= years:
        return None
    new, old = chain[0][1], chain[years][1]
    if new <= 0 or old <= 0:
        return None
    return round(((new / old) ** (1 / years) - 1) * 100, 1)


def _ttm(periods: dict[tuple[str, str], float]) -> tuple[float, str] | None:
    """Trailing-twelve-month total as (value, period end).

    Last fiscal year + this year's YTD - the same YTD a year earlier; falls
    back to the fiscal year alone when no later 10-Q is on file.
    """
    annual = [(k, v) for k, v in periods.items() if _is_annual(*k)]
    if not annual:
        return None
    (_, fy_end), fy_val = max(annual, key=lambda kv: kv[0][1])
    ytd = [(k, v) for k, v in periods.items()
           if k[1] > fy_end and abs(_days(fy_end, k[0]) - 1) <= 7 and 80 <= _days(*k) <= 300]
    if not ytd:
        return fy_val, fy_end
    (y_start, y_end), y_val = max(ytd, key=lambda kv: kv[0][1])
    span = _days(y_start, y_end)
    prior = next((v for (s, e), v in periods.items()
                  if abs(_days(e, y_end) - 365) <= 10 and abs(_days(s, e) - span) <= 10), None)
    if prior is None:
        return fy_val, fy_end
    return fy_val + y_val - prior, y_end


def _latest_shares(periods: dict[tuple[str, str], float]) -> float | None:
    """Diluted share count of the most recent (shortest) reported period."""
    if not periods:
        return None
    last = max(end for _, end in periods)
    key = min((k for k in periods if k[1] == last), key=lambda k: _days(*k))
    return periods[key] or None


def _pick_ttm(reported, derived, share_periods) -> tuple[float, str] | None:
    """Choose between reported TTM EPS and TTM net income / latest shares.

    Reported is what the company states, but its fiscal year (10-K) and YTD
    (10-Q) parts sit on different share bases if a split landed in between;
    derived is split-proof but leans on two more tags. Take the fresher one;
    when equally fresh but far apart, trust derived only if the share count
    itself jumped like a split.
    """
    if not reported or not derived:
        return reported or derived
    if reported[1] != derived[1]:
        return max(reported, derived, key=lambda t: t[1])
    if derived[0] and 0.67 <= reported[0] / derived[0] <= 1.5:
        return reported
    annual = [(k, v) for k, v in share_periods.items() if _is_annual(*k)]
    fy_shares = max(annual)[1] if annual else None
    latest = _latest_shares(share_periods)
    split = bool(fy_shares and latest) and not 0.67 <= latest / fy_shares <= 1.5
    return derived if split else reported


def _valuation_inputs(cik: str) -> dict:
    """EDGAR-side inputs for one company: TTM diluted EPS and EPS CAGRs.

    TTM EPS is the reported figure or TTM net income / latest diluted shares,
    whichever is fresher (see _pick_ttm). Companies that can't be valued come
    back as {"skip": reason}; "_diag" names the tags used, for the run log.
    """
    recent = (date.today() - timedelta(days=400)).isoformat()
    facts = json.loads(http_get(COMPANY_FACTS_URL.format(cik=cik)))
    for taxonomy, eps_tags, ni_tags, share_tags in _VALUATION_TAGS:
        eps = _concept(facts, taxonomy, eps_tags, lambda r: _last_end(r, annual_only=True) >= recent)
        if eps is None:
            continue
        rows, unit, eps_tag = eps
        if unit != "USD/shares":
            # Price is USD, so a non-USD EPS (ASML...) can't make a P/E.
            return {"skip": f"EPS reported in {unit.split('/')[0]}"}
        forms = {str(e.get("form", "")) for e in rows}
        if not any(f.startswith("10-") for f in forms) and any(f[:4] in ("20-F", "40-F") for f in forms):
            # 20-F/40-F filers: the 13F holds ADRs, whose share ratio XBRL doesn't give.
            return {"skip": "foreign filer (ADR ratio unknown)"}
        out: dict = {}
        chain = _annual_eps_chain(rows)
        if chain:
            out["eps_fy_end"] = chain[0][0]
            out["eps_history"] = [[end, round(v, 4)] for end, v in reversed(chain)]
            out["eps_cagr_3y_pct"] = _cagr_pct(chain, 3)
            out["eps_cagr_5y_pct"] = _cagr_pct(chain, 5)
        latest = _last_end(rows)
        ni = _concept(facts, taxonomy, ni_tags, lambda r: _last_end(r) >= latest)
        sh = _concept(facts, taxonomy, share_tags, lambda r: _last_end(r) >= latest)
        ni_ttm = _ttm(_durations(ni[0])) if ni and ni[1] == "USD" else None
        share_periods = _durations(sh[0]) if sh and sh[1] == "shares" else {}
        shares = _latest_shares(share_periods)
        derived = (ni_ttm[0] / shares, ni_ttm[1]) if ni_ttm and shares else None
        ttm = _pick_ttm(_ttm(_durations(rows)), derived, share_periods)
        if ttm:
            out["eps_ttm"] = round(ttm[0], 4)
            out["eps_ttm_end"] = ttm[1]
        if ni_ttm:
            out["net_income_ttm"] = ni_ttm[0]
        if not chain and not ttm:
            # e.g. XOM after re-incorporating: SEC maps the ticker to a new
            # entity whose filings start this year; the history stays behind.
            out["skip"] = "too little XBRL history (new SEC entity?)"
        out["_diag"] = "; ".join(
            f"{name}={c[2]} ({len(c[0])} facts, last {_last_end(c[0])})" if c else f"{name}=none"
            for name, c in (("eps", eps), ("ni", ni), ("shares", sh)))
        return out
    return {"skip": "no EPS in XBRL"}


def enrich_valuation(all_results: list[dict], out_dir: Path,
                     universe: int = 100, refetch_days: int = 20) -> None:
    """P/E vs EPS-growth (PEG) map inputs -> data/valuation.json.

    Universe: the `universe` largest companies by combined 13F value across
    the filers on the latest quarter (share classes merged by CIK). Each gets
    a 13F-implied quarter-end price, trailing P/E on TTM diluted EPS,
    historical 3y/5y diluted EPS CAGR, and the cohort's net share flow.
    EDGAR inputs are cached for `refetch_days`.
    """
    path = out_dir / "valuation.json"
    try:
        cusip_ticker = json.loads((out_dir / "tickers.json").read_text())
    except Exception:
        return
    try:
        prev = json.loads(path.read_text()) if path.exists() else {}
    except Exception:
        prev = {}
    cache = ({s["cik"]: s for s in prev.get("stocks", []) if s.get("cik")}
             if prev.get("version") == _VALUATION_VERSION else {})

    valid = [r for r in all_results if "error" not in r and r.get("latest_filing")]
    if not valid:
        return
    # Stale filers (a manager that stopped filing) would mix in old prices.
    price_date = Counter(r["latest_filing"].get("report_date", "") for r in valid).most_common(1)[0][0]
    cohort = [r for r in valid if r["latest_filing"].get("report_date") == price_date]

    by_cusip: dict[str, dict] = {}
    for r in cohort:
        for h in (*r.get("holdings", ()), *r.get("exited", ())):
            if h.get("put_call") or h.get("share_type") != "SH":
                continue
            ticker = cusip_ticker.get(h.get("cusip"))
            issuer = h.get("issuer") or ""
            if not ticker or any(k in issuer.upper() for k in _FUND_HINTS):
                continue
            e = by_cusip.setdefault(h["cusip"], {
                "ticker": ticker, "issuer": issuer, "value": 0, "shares": 0,
                "shares_prior": 0, "prices": [], "holders": set(),
                "buyers": set(), "sellers": set(),
            })
            e["value"] += h["value_usd"]
            e["shares"] += h["shares"]
            e["shares_prior"] += h["shares_prior"]
            if h["shares"] > 0:
                e["holders"].add(r["name"])
                e["prices"].append(h["value_usd"] / h["shares"])
            if h["action"] in ("new", "add"):
                e["buyers"].add(r["name"])
            elif h["action"] in ("trim", "exit"):
                e["sellers"].add(r["name"])
    if not by_cusip:
        return

    try:
        sec_rows = _company_tickers()
    except Exception as e:
        print(f"valuation enrichment skipped (company_tickers fetch failed: {e})",
              file=sys.stderr)
        return
    ticker_cik: dict[str, str] = {}
    for row in sec_rows:
        t, cik = row.get("ticker"), row.get("cik_str")
        if t and cik is not None:
            ticker_cik.setdefault(t.upper(), str(cik))

    # Merge share classes (GOOGL + GOOG, BRK-A + BRK-B) into one company.
    companies: dict[str, list[dict]] = {}
    for e in by_cusip.values():
        cik = ticker_cik.get(e["ticker"].upper())
        if cik:
            companies.setdefault(cik, []).append(e)
    ranked = sorted(companies.items(), key=lambda kv: -sum(c["value"] for c in kv[1]))

    today = date.today()

    def is_fresh(entry):
        d = (entry or {}).get("fetched", "")
        return bool(d) and (today - date.fromisoformat(d)).days < refetch_days

    stocks: list[dict] = []
    fetched = 0
    for rank, (cik, classes) in enumerate(ranked[:universe], 1):
        classes.sort(key=lambda c: -c["value"])
        main = classes[0]
        cached = cache.get(cik)
        if is_fresh(cached):
            inputs = {k: cached[k] for k in _VALUATION_INPUT_KEYS if k in cached}
        else:
            try:
                inputs = {**_valuation_inputs(cik), "fetched": today.isoformat()}
                fetched += 1
                diag = inputs.pop("_diag", "")
                if diag and not (inputs.get("eps_ttm") and inputs.get("eps_history")):
                    print(f"valuation: {main['ticker']} incomplete: {diag}", file=sys.stderr)
            except Exception as ex:
                print(f"valuation: EDGAR fetch failed for {main['ticker']}: {ex}",
                      file=sys.stderr)
                inputs = ({k: cached[k] for k in _VALUATION_INPUT_KEYS if k in cached}
                          if cached else {"skip": "EDGAR fetch failed"})

        # Per-share figures follow one share class; Berkshire's EPS is per
        # Class A share, so take the first class whose price gives a sane P/E.
        eps = inputs.get("eps_ttm")
        pick, pe = main, None
        if eps and eps > 0:
            for c in classes:
                cand = statistics.median(c["prices"]) / eps if c["prices"] else None
                if cand and 1 <= cand <= 1000:
                    pick, pe = c, cand
                    break
        note = inputs.get("skip")
        if not note:
            if eps is None:
                note = "no TTM EPS in XBRL"
            elif eps <= 0:
                note = "negative TTM earnings"
            elif pe is None:
                note = "P/E out of range"
        stocks.append({
            "rank": rank,
            "ticker": pick["ticker"],
            "issuer": main["issuer"],
            "cik": cik,
            "price": round(statistics.median(pick["prices"]), 2) if pick["prices"] else None,
            "price_filers": len(pick["prices"]),
            "pe": round(pe, 1) if pe else None,
            "held_value_usd": sum(c["value"] for c in classes),
            "holders": len(set().union(*(c["holders"] for c in classes))),
            "buyers": len(main["buyers"]),
            "sellers": len(main["sellers"]),
            "net_shares_pct": (round((main["shares"] - main["shares_prior"])
                                     / main["shares_prior"] * 100, 2)
                               if main["shares_prior"] else None),
            **{k: inputs.get(k) for k in _VALUATION_INPUT_KEYS},
            "note": note,
        })

    doc = {"version": _VALUATION_VERSION,
           "generated_at": today.isoformat(), "price_date": price_date,
           "cohort_filers": len(cohort),
           "source": "13F-implied quarter-end price + SEC EDGAR XBRL companyfacts",
           "stocks": stocks}
    path.write_text(json.dumps(doc, indent=2) + "\n")
    print(f"valuation: {sum(1 for s in stocks if s['pe'])} of {len(stocks)} companies "
          f"valued ({fetched} fetched from EDGAR)", file=sys.stderr)


def run(investors_path: Path, out_dir: Path, top_n: int) -> int:
    investors = json.loads(investors_path.read_text())
    out_dir.mkdir(parents=True, exist_ok=True)
    summary = {"generated_at": date.today().isoformat(), "filers": []}
    failures = 0
    all_results: list[dict] = []
    for inv in investors:
        filer_path = out_dir / f"{slug(inv['name'])}.json"
        existing_history: list[dict] = []
        if filer_path.exists():
            try:
                existing_history = json.loads(filer_path.read_text()).get("history") or []
            except Exception:
                pass
        try:
            res = process_filer(inv["name"], inv["cik"], top_n=top_n)
        except Exception as e:
            res = {"name": inv["name"], "cik": inv["cik"], "error": f"{type(e).__name__}: {e}"}
            failures += 1
        if "error" not in res:
            res["summary"] = build_summary(res)
            res["history"] = merge_history(existing_history, res)
        all_results.append(res)
        summary["filers"].append(_summary_entry(res))
        filer_path.write_text(json.dumps(res, indent=2))
        status = "ok" if "error" not in res else f"ERROR: {res['error']}"
        print(f"[{inv['name']}] {status}", file=sys.stderr)
    summary["conviction_rankings"] = build_conviction_rankings(all_results)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    write_aggregates(all_results, out_dir)
    enrich_tickers(all_results, out_dir)
    enrich_fundamentals(all_results, out_dir)
    try:
        enrich_valuation(all_results, out_dir)
    except Exception as e:  # optional view; never fail the data refresh over it
        print(f"valuation enrichment skipped ({type(e).__name__}: {e})", file=sys.stderr)
    return 1 if failures == len(investors) else 0


def smoke_test_offline(fixtures_dir: Path, out_dir: Path, investors_path: Path) -> int:
    """Generate sample per-filer + summary JSON from bundled XML fixtures.

    Writes the same shape as a live run so the portal can be exercised
    without SEC network access. Each filer in investors.json gets its
    own scaled copy of the fixture diff so the portal shows distinct
    AUM / value / delta numbers per filer instead of identical rows.
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
    base_holdings, base_exited = build_holdings(curr_agg, prev_agg)
    if not base_holdings and not base_exited:
        print("smoke-test: expected at least one diff row, got none", file=sys.stderr)
        return 2

    investors = json.loads(investors_path.read_text())
    today = date.today().isoformat()
    summary: dict = {"generated_at": today, "filers": []}
    all_payloads: list[dict] = []

    int_keys = ("shares", "shares_prior", "delta_shares",
                "value_usd", "value_usd_prior", "delta_value_usd")

    def scaled_row(row: dict, factor: float) -> dict:
        out = dict(row)
        for k in int_keys:
            if k in out and out[k] is not None:
                out[k] = int(out[k] * factor)
        return out

    for idx, inv in enumerate(investors):
        # Spread per-filer factors across roughly 1x – 5.5x so AUM and
        # values look distinct in the sidebar / overview.
        factor = 1.0 + idx * 0.5
        holdings = [scaled_row(r, factor) for r in base_holdings]
        exited = [scaled_row(r, factor) for r in base_exited]
        buys, sells = top_buys_sells(holdings, exited, top_n=25)
        total_curr = sum(r["value_usd"] for r in holdings)
        total_prior = (
            sum(r["value_usd_prior"] for r in holdings)
            + sum(r["value_usd_prior"] for r in exited)
        )
        payload = {
            "name": inv["name"],
            "cik": inv["cik"],
            "latest_filing": {"form": "13F-HR", "filing_date": today,
                              "report_date": today, "accession": "FIXTURE",
                              "primary_doc": "fixture.xml"},
            "prior_filing": {"form": "13F-HR", "filing_date": "PRIOR",
                             "report_date": "PRIOR", "accession": "FIXTURE-PRIOR",
                             "primary_doc": "fixture.xml"},
            "holdings_count": len(holdings),
            "holdings_count_prior": len(holdings) + len(exited),
            "total_value_usd": total_curr,
            "total_value_usd_prior": total_prior,
            "holdings": holdings,
            "exited": exited,
            "top_buys": buys,
            "top_sells": sells,
        }
        payload["summary"] = build_summary(payload)
        filer_path = out_dir / f"{slug(inv['name'])}.json"
        existing_history: list[dict] = []
        if filer_path.exists():
            try:
                existing_history = json.loads(filer_path.read_text()).get("history") or []
            except Exception:
                pass
        payload["history"] = merge_history(existing_history, payload)
        all_payloads.append(payload)
        filer_path.write_text(json.dumps(payload, indent=2))
        summary["filers"].append(_summary_entry(payload))
    summary["conviction_rankings"] = build_conviction_rankings(all_payloads)
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    write_aggregates(all_payloads, out_dir)
    print(f"wrote {len(investors)} filer JSONs + summary.json + aggregates.json to {out_dir}",
          file=sys.stderr)
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
        return smoke_test_offline(here / "fixtures", Path(args.out_dir), Path(args.investors))
    return run(Path(args.investors), Path(args.out_dir), args.top_n)


if __name__ == "__main__":
    sys.exit(main())

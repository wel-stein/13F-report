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

DEFAULT_UA = "Western welstein@gmail.com"
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


def merge_history(existing: list[dict], filer: dict, max_quarters: int = 8) -> list[dict]:
    snapshot = _quarter_snapshot(filer)
    quarter = snapshot["quarter"]
    if not quarter:
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
    print(f"wrote {len(investors)} filer JSONs + summary.json to {out_dir}", file=sys.stderr)
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

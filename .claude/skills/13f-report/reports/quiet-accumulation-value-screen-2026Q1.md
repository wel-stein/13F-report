# Quiet Accumulation + Value Screen — Equity Research Note

**Universe:** 22 top US 13F filers · **Quarter:** Q1 2026 (report date 2026-03-31) · **Generated:** 2026-07-05
**Method:** Anthropic *equity-research* plugin — `/screen` (idea-generation) + `/comps` (comparable-company analysis)

> ⚠️ **Data-source disclosure (per `/comps` methodology).** The comps skill mandates institutional MCP feeds (FactSet / S&P Capital IQ / Daloopa) as the primary source and treats web search as a *last resort*. No licensed connectors were available in this run, so **all valuation figures below come from public web sources (stockanalysis.com, GuruFocus, Nasdaq, Yahoo, MacroTrends) as of ~June 2026** and are approximate. Accumulation figures are exact (from SEC 13F filings). **Not investment advice** — every line needs professional sign-off.

---

## 0. Executive Summary

Combining two independent signals — **(1)** stocks quietly accumulated by many institutions this quarter but held as a top-10 position by *none*, and **(2)** a value overlay requiring *both* trailing and forward P/E to be low — surfaces four names that pass both filters:

| Rank | Ticker | Company | Why it makes the cut |
|---|---|---|---|
| 1 | **QGEN** | Qiagen | 11 filers opened new positions; forward P/E 11.7 **and** PEG 0.94 — cheap on both value axes vs. life-science-tools peers |
| 2 | **SF** | Stifel Financial | Trailing 14.3 / forward 11.3 / PEG 0.96 — triple-cheap broker-dealer, 14 filers buying |
| 3 | **PNFP** | Pinnacle Financial | 13 filers, all brand-new positions; double-low (12.9 / 10.5) — but only *in line* with the regional-bank median |
| 4 | **CCL** | Carnival | 13 filers (10 new); double-low (~12 / ~11); cyclical recovery, but heavy debt |

**Runner-up:** INDV (Indivior) — forward P/E 13.6, 13 new-position filers, but PEG unavailable and single-product concentration risk.

The strongest *fundamental* combination is **QGEN and SF** — the only two that are cheap on trailing **and** forward P/E **and** carry a PEG below 1.0.

---

## 1. Screening Methodology (`/screen`)

Following the `idea-generation` skill's **Value + Special-Situation** screen, adapted to a 13F ownership dataset:

**Signal 1 — Quiet institutional accumulation** (the "special situation")
- Security bought or newly opened (`new`/`add`) this quarter by **≥ 8 of 22 filers**
- **Top-10 holding of *zero* filers** — i.e. broad buying *before* it becomes a headline conviction position
- Options legs excluded; ranked by a conviction score weighting brand-new positions double (`new × 2 + add`)

**Signal 2 — Value overlay** (the `/screen` value criteria: "P/E below sector median", "PEG")
- **Trailing (TTM) P/E low** *and* **Forward P/E low** — the user's "double-low" requirement
- **PEG < 1.0** as a bonus (growth-adjusted cheapness; avoids the low-growth value trap)

**Screens surface candidates, not conclusions** — every name below still needs fundamental diligence.

---

## 2. Master Comparison Table

Top quiet-accumulation names that carry a public ticker, sorted by valuation tier. Filers = distinct 13F filers buying; (new) = those opening a brand-new position.

| Ticker | Company | Sector | Filers (new) | Trailing PE | Forward PE | PEG | Tier |
|---|---|---|---|---|---|---|---|
| **QGEN** | Qiagen | Diagnostics/Tools | 11 (11) | 19.0 | **11.7** | **0.94** | 🟢 Double-low |
| **SF** | Stifel Financial | Broker-dealer | 14 (2) | 14.3 | **11.3** | **0.96** | 🟢 Double-low |
| **PNFP** | Pinnacle Financial | Regional bank | 13 (13) | 12.9 | **10.5** | n/a | 🟢 Double-low |
| **CCL** | Carnival | Cruise | 13 (10) | ~12.3 | ~11–13 | 1.15 | 🟢 Double-low |
| INDV | Indivior | Pharma | 13 (13) | 21.3 | 13.6 | n/a | 🟡 Forward-low |
| CAKE | Cheesecake Factory | Restaurants | 9 (9) | 17.6 | 14.8 | 1.42 | 🟡 Moderate |
| AMCR | Amcor | Packaging | 10 (10) | 24.8 | **8.8** | 0.17 | 🟡 Forward-only |
| OWL | Blue Owl Capital | Alt-asset mgr | 14 (2) | 70.7 | **8.7** | 0.12 | 🟡 Forward-only |
| MWH | Solv Energy | Solar EPC | 9 (9) | 55.1 | 20.6 | n/a | 🟡 Forward-only |
| ERIC | Ericsson | Telecom eq. | 11 (5) | 14.3 | 20.8 | n/a | 🔴 Fwd > trailing |
| ORCL | Oracle | Software | 9 (9) | 31.6 | 22.9 | 0.80 | 🔴 Rich (trailing) |
| PIPR | Piper Sandler | Broker-dealer | 13 (13) | 31.8 | 20.1 | n/a | 🔴 Rich |
| ITGR | Integer Holdings | Med-device | 8 (8) | 22.4 | 19.3 | 2.41 | 🔴 High PEG |
| BBUC | Brookfield Business | Industrials | 11 (11) | n/a | 18.1 | n/a | ⚪ Partial data |
| GFS | GlobalFoundries | Semis | 15 (3) | 51.1 | 42.6 | 1.65 | 🔴 Rich |
| MDA | MDA Space | Space/Def | 8 (8) | 64.6 | 35.6 | n/a | 🔴 Rich |

**Not screenable on P/E (unprofitable / no meaningful earnings):** ASST (Strive), MSTR (Strategy), FUBO, AGL, ADCT, NRIX, SLS, SATL, TENX, ATAI, FORD, ACDC. See §5.

---

## 3. Top Ideas — One-Pagers (`/screen` idea format)

### QGEN — Qiagen — *Long* — "Molecular-diagnostics cash machine at a tools-sector discount, being quietly re-accumulated."

| Metric | Value | vs. Peers |
|---|---|---|
| Trailing P/E | 19.0 | Below large-cap tools (Thermo/Danaher ~22–28x) |
| Forward P/E | **11.7** | Deep discount to sector |
| PEG | **0.94** | < 1.0 — growth-adjusted cheap |
| 13F accumulation | 11 filers, **all new positions** | Broad, fresh institutional interest |

**Thesis:**
- Only name in the screen that is cheap on trailing P/E, forward P/E **and** PEG simultaneously.
- Recurring consumables/reagent revenue model → earnings visibility unusual for a "cheap" stock.
- 11 filers *initiating* (not just adding) signals a fresh institutional thesis forming this quarter.
- Forward < trailing P/E implies the street models **rising** EPS — the healthy kind of "cheap."

**Key risks:** Slower top-line growth than Thermo/Danaher can justify a structural discount (possible value trap); FX translation (euro reporting); China diagnostics demand.
**Next steps:** Pull consensus EPS revisions; confirm the forward-P/E gap isn't a downgrade artifact; comp vs. RVTY/BIO (closer-size peers).

---

### SF — Stifel Financial — *Long* — "Triple-cheap wealth-management-plus-capital-markets compounder with 14 filers accumulating."

| Metric | Value | vs. Peers |
|---|---|---|
| Trailing P/E | 14.3 | In line with broker-dealers |
| Forward P/E | **11.3** | Cheaper than PIPR (20.1) |
| PEG | **0.96** | < 1.0 |
| 13F accumulation | 14 filers | Highest breadth among value names |

**Thesis:**
- Cheapest broker-dealer in the screen on forward P/E and the only one with a sub-1 PEG.
- Wealth-management fee base dampens the earnings cyclicality that usually caps broker-dealer multiples.
- Widest institutional breadth (14 filers) of any double-low name.

**Key risks:** Capital-markets revenue is rate/deal-flow sensitive; a soft IB cycle compresses forward EPS; broker-dealer P/Es are structurally low for a reason (cyclical earnings).
**Next steps:** Split revenue wealth-mgmt vs. capital-markets; compare to RJF; stress forward EPS in a weak-IB scenario.

---

### PNFP — Pinnacle Financial — *Long (qualified)* — "Every-filer new-position regional bank at a double-low multiple — but only peer-average cheap."

| Metric | Value | vs. Peers |
|---|---|---|
| Trailing P/E | 12.9 | Slightly above bank median |
| Forward P/E | **10.5** | ≈ regional-bank median (~10.4) |
| 13F accumulation | 13 filers, **all new** | Strongest fresh-buying signal in the screen |

**Thesis:**
- 13 filers **all initiating** — the single strongest "quiet accumulation" signal in the dataset.
- Double-low on an absolute basis; high-growth Southeast franchise vs. slower money-center banks.

**Key risks — read this one carefully:** PNFP's forward P/E of 10.5 is essentially the **regional-bank median (10.4)** — it is *not* a discount to peers, just cheap on an absolute basis. Cheaper peers exist (WAL ~8.1x, ZION ~9.8x). Rate/credit/deposit-beta risk applies sector-wide.
**Next steps:** Compare NIM, loan growth, deposit beta vs. WAL/EWBC; decide whether the growth premium over median is warranted.

---

### CCL — Carnival — *Long (cyclical)* — "Post-pandemic deleveraging cruise recovery, cheaper than best-in-class RCL, 13 filers buying."

| Metric | Value | vs. Peers |
|---|---|---|
| Trailing P/E | ~12.3 | Below RCL (~17–18x) |
| Forward P/E | ~11–13 | Above NCLH (~8x), below RCL (~15x) |
| PEG | 1.15 | Roughly fair |
| 13F accumulation | 13 filers (10 new) | Broad recovery bet |

**Thesis:**
- Occupancy/pricing recovery + aggressive debt paydown → forward earnings inflecting up.
- Trades at a discount to premium peer RCL (~15x fwd) on execution/leverage, not franchise decline.

**Key risks:** ~$26B+ debt load and fuel exposure make it the most balance-sheet-levered cruise name; NCLH (~8x) is cheaper if you just want cheap; consumer-discretionary/recession sensitivity.
**Next steps:** Model net-debt trajectory and interest coverage; RCL/NCLH three-way comp on EV/EBITDA (not just P/E — leverage distorts P/E here).

---

## 4. Comparable Company Analysis (`/comps`)

Per the `comps-analysis` skill: truly-comparable peer groups, valuation multiples with **median / quartile** benchmarking, flag over/under-valued vs. the peer set. *Financials use P/E (EBITDA/gross-margin not meaningful for banks).* **Data caveat:** P/E figures vary 5–15% across public sources and dates — treat as indicative.

### 4.1 Regional banks — PNFP

| Company | Trailing PE | Forward PE | Note |
|---|---|---|---|
| **PNFP (screen)** | **12.9** | **10.5** | High-growth SE franchise |
| East West (EWBC) | — | 12.0 | Premium to median |
| Western Alliance (WAL) | — | 8.1 | ~22% discount |
| Zions (ZION) | — | 9.8 | Funding/credit discount |
| **Bank industry median** | — | **10.4** | |

**Verdict:** PNFP is cheap absolutely but sits **right at the peer median** on forward P/E — *not* a relative bargain. The bull case rests on above-peer growth, not a valuation gap.

### 4.2 Broker-dealers & alt-asset managers — SF, PIPR, OWL, PX

| Company | Trailing PE | Forward PE | PEG |
|---|---|---|---|
| **SF (screen)** | **14.3** | **11.3** | **0.96** |
| PIPR (screen) | 31.8 | 20.1 | n/a |
| **Median (broker-dealer)** | **23.1** | **15.7** | — |
| OWL (screen, alt-mgr) | 70.7 | 8.7 | 0.12 |
| PX (screen, alt-mgr) | 47.5 | n/a | n/a |

**Verdict:** **SF is the clear value name** — below the broker-dealer median on both P/E measures, PEG < 1. PIPR is rich. OWL/PX are a different animal: huge trailing P/E (GAAP amortization) but single-digit forward — the market is pricing a large earnings step-up, so they're "cheap" only if that materializes.

### 4.3 Cruise lines — CCL

| Company | Trailing PE | Forward PE | Note |
|---|---|---|---|
| **CCL (screen)** | ~12.3 | ~11–13 | Most levered (~$26B debt) |
| Royal Caribbean (RCL) | ~17–18 | ~15 | Best-in-class, dividend restored |
| Norwegian (NCLH) | ~10.7 | ~8 | Cheapest, execution risk |
| **Median** | **~12.3** | **~12** | |

**Verdict:** CCL sits mid-pack — cheaper than premium RCL, pricier than NCLH. P/E understates the risk here; **EV/EBITDA is the right lens** because leverage differs sharply across the three. A cheap P/E on a highly-levered balance sheet is not the same bargain as on a clean one.

### 4.4 Life-science tools / diagnostics — QGEN

| Company | Forward PE (indicative) | Note |
|---|---|---|
| **QGEN (screen)** | **11.7** | Recurring consumables, PEG 0.94 |
| Thermo Fisher / Danaher / Agilent | ~20–28 (sector context) | Larger, faster-growing |

**Verdict:** QGEN trades at a **material discount to large-cap tools peers**. Part is deserved (slower growth), but a sub-1 PEG says the discount more than compensates for the growth gap — the most attractive *relative* valuation in the screen. (Tighten with same-size peers RVTY/BIO before acting.)

---

## 5. Excluded — No-P/E Bucket

These surfaced as quietly accumulated but are **unprofitable or have no meaningful P/E**, so the double-low filter cannot apply. Several are 13F artifacts of quant funds reporting convertible/private-placement stakes:

- **Bitcoin-treasury vehicles:** MSTR (Strategy), ASST (Strive) — valued on BTC holdings, not earnings.
- **Loss-making biotech/growth:** ADCT, NRIX, SLS, SATL, TENX, ATAI, AGL, FUBO, ACDC (ProFrac).
- **Micro/odd:** FORD (Forward Industries).

If you want these covered, they need a growth/thematic screen (revenue trajectory, cash runway), not a value screen.

---

## 6. Caveats & Disclaimers

- **Low P/E ≠ buy.** It can be a value trap (market pricing an earnings decline). ERIC's forward P/E (20.8) *above* its trailing (14.3) is exactly that warning sign — earnings expected to fall.
- **Bank & cyclical P/Es are structurally low.** Judge PNFP/SF/CCL against their own sectors, not vs. software.
- **P/E hides leverage.** For CCL (and OWL/PX), EV/EBITDA and net-debt trajectory matter more than P/E.
- **Data quality.** Web-sourced, ~June 2026 snapshot, 5–15% source-to-source variance; PEG definitions differ (mostly 5-yr forward). With FactSet/S&P connectors this note would carry audit-trail-grade figures.
- **13F is lagged & long-only.** "Accumulation" = more institutions held more shares at quarter-end (2026-03-31), filed ~45 days later. Not a real-time or price signal.
- **Nothing here is investment, legal, tax, or accounting advice.** Drafted for human review; requires qualified sign-off.

---

### Data sources
13F holdings: SEC EDGAR (this repo's `data/`). Valuation: [stockanalysis.com](https://stockanalysis.com), [GuruFocus](https://www.gurufocus.com), [Nasdaq](https://www.nasdaq.com), [Yahoo Finance](https://finance.yahoo.com), [MacroTrends](https://www.macrotrends.net), [gainify.io](https://www.gainify.io/blog/regional-bank-stocks) (bank medians). Methodology: [anthropics/financial-services](https://github.com/anthropics/financial-services) — `equity-research` plugin (`/screen`, `/comps`).

# 13F-report

Tools for tracking what the largest US institutional investors are buying and
selling, based on their quarterly **SEC Form 13F-HR** filings.

The repo has three cooperating sub-projects:

1. **Skill** at [`.claude/skills/13f-report/`](.claude/skills/13f-report/) — a
   Claude Code skill (Python, stdlib-only) that downloads 13F-HR filings from
   SEC EDGAR for a configured list of top filers, diffs each one's
   stock-on-hand against the prior quarter, and writes JSON to the skill's
   `data/` directory.
2. **Admin portal** at [`portal/`](portal/) — a generic, **skill-agnostic**
   React + Vite + Tailwind admin UI for editing the skill's tracked-entities
   list and previewing its JSON. Lives at the repo root because one portal
   can serve multiple skills (registered via
   [`portal/skills.config.js`](portal/skills.config.js)). Includes dev-only
   API endpoints for adding/removing entries and proxying SEC search.
3. **Public site** at [`web/`](web/) — a read-only, deployable React + Vite +
   Tailwind site built for end users. Same JSON source, different UX:
   homepage aggregates buys/sells across all investors; per-investor pages
   live at deep-linkable `#/investor/:cik` URLs. No `/api/*`, no edit
   controls, no auth — pure static bundle.

## Repository layout

```
13F-report/
├── .claude/skills/13f-report/      # the skill (Python only, no JS deps)
│   ├── SKILL.md                    # frontmatter + usage + output schema
│   ├── download_13f.py             # SEC EDGAR fetcher / parser / differ
│   ├── investors.json              # CIKs of the top 10 filers (editable)
│   ├── fixtures/                   # XML fixtures for offline smoke test
│   │   ├── current.xml
│   │   └── prior.xml
│   └── data/                       # JSON output (consumed by the portal)
│       ├── summary.json            # filer overview list
│       └── <filer-slug>.json       # one per filer (full holdings + deltas)
│
├── portal/                         # admin portal (dev tool, skill-agnostic)
│   ├── package.json
│   ├── skills.config.js            # ★ skill registry
│   ├── vite.config.js              # publicDir + define(__PORTAL_CONFIG__)
│   ├── vite-plugin-admin.js        # dev-only /api/config /api/registry /api/search
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── config.js               # exposes inlined __PORTAL_CONFIG__
│       ├── format.js
│       ├── index.css
│       └── components/
│           ├── Sidebar.jsx
│           ├── StatsCards.jsx
│           ├── HoldingsTable.jsx
│           └── ManageRegistry.jsx  # dev-mode add/remove modal
│
└── web/                            # public-facing site (read-only, deployable)
    ├── package.json
    ├── site.config.js              # data dir + public site metadata
    ├── vite.config.js              # publicDir + define(__SITE_CONFIG__)
    ├── tailwind.config.js
    ├── postcss.config.js
    ├── index.html
    └── src/
        ├── main.jsx                # HashRouter root
        ├── App.jsx                 # routes: / and /investor/:cik
        ├── site.js                 # exposes inlined __SITE_CONFIG__
        ├── format.js
        ├── data.js                 # loadSummary / loadFiler / cross-investor aggregator
        ├── index.css
        ├── components/
        │   ├── NavBar.jsx
        │   ├── InvestorCard.jsx
        │   └── MoverList.jsx       # top buys / sells with mini bar chart
        └── pages/
            ├── Home.jsx            # hero, top movers, investor grid
            └── Investor.jsx        # per-investor stats + holdings list
```

## Quick start

```bash
# 1. populate the skill's data/ — pick one mode

# offline (uses bundled XML fixtures, no network) — produces sample JSON for
# Berkshire Hathaway and BlackRock so the portal renders immediately
python3 .claude/skills/13f-report/download_13f.py --smoke-test

# live (requires network access to data.sec.gov; SEC requires an identifying
# User-Agent — anything generic gets a 403)
python3 .claude/skills/13f-report/download_13f.py \
  --user-agent "Your Name you@example.com"

# 2a. admin portal (edit tracked investors, preview JSON)
cd portal
npm install      # first time only
npm run dev      # http://localhost:5173 (live, hot-reloading)
# or
npm run build && npm run preview   # http://localhost:4173 (built bundle)

# 2b. public site (read-only, deployable static bundle)
cd web
npm install      # first time only
npm run dev      # http://localhost:5174
# or
npm run build && npm run preview   # http://localhost:4174
```

The committed `data/` folder already includes smoke-test output, so both UIs
render out of the box without running the downloader. The admin portal and
the public site can run side by side (different ports).

## How the pieces connect

Both the admin portal (`portal/`) and the public site (`web/`) use Vite's
`publicDir` to serve the skill's `data/` directory directly:

```js
// portal/vite.config.js  AND  web/vite.config.js
publicDir: '../.claude/skills/13f-report/data'
```

So every file the downloader writes is served by Vite at the URL root with no
copy step:

| File                                    | URL                          |
| --------------------------------------- | ---------------------------- |
| `data/summary.json`                     | `/summary.json`              |
| `data/berkshire_hathaway.json`          | `/berkshire_hathaway.json`   |
| `data/<slug>.json`                      | `/<slug>.json`               |

Re-running the downloader and refreshing the browser is enough to pick up new
data — no rebuild required in dev mode.

## What the portal shows

For each filer:

- **Stats cards** — total portfolio value (with prior-quarter delta), holdings
  count, new+added count, trimmed+exited count.
- **Holdings table** — every position from the latest filing plus exited
  positions from the prior filing. Each row shows
  `shares_prior` → `shares`, `Δ shares`, `Δ %`, current value, `Δ value`, and
  an action badge (`new` / `add` / `hold` / `trim` / `exit`).
- Sortable on every column, filterable by action
  (`All / New / Added / Trimmed / Exited / Hold`), free-text search across
  issuer name and CUSIP.

## Manage tracked entries (dev-only module)

A **"Manage tracked …"** button at the top of the sidebar (visible only under
`npm run dev`, label pluralized from the active skill's config) opens a modal
that:

- Lists the active skill's currently-tracked entries with a **Remove** button each.
- If the active skill has SEC search enabled, lets you search SEC EDGAR by
  name (filtered to the skill's configured form, e.g. `13F-HR`) and **Add**
  matches in one click.

Edits go straight to the active skill's registry file (for the 13F skill,
that's `.claude/skills/13f-report/investors.json`). After adding or removing
entries, an in-page banner reminds you to re-run the active skill's
downloader.

The endpoints are registered by `portal/vite-plugin-admin.js` and only exist
in dev mode:

| Method | Path                       | Effect                                                  |
| ------ | -------------------------- | ------------------------------------------------------- |
| GET    | `/api/config`              | Sanitized active-skill metadata (title, labels, etc.)   |
| GET    | `/api/registry`            | Read the active skill's registry file                   |
| POST   | `/api/registry`            | Append `{name, cik}`; 409 if CIK already present        |
| DELETE | `/api/registry/:cik`       | Remove by CIK                                           |
| GET    | `/api/search?q=...`        | SEC EDGAR full-text search (filtered by `secFormFilter`) |

Production builds (`npm run build`) ship none of this — the management UI and
API both vanish.

## Registering another skill

To plug a second skill into the same portal, add an entry to
`portal/skills.config.js` and (for now) make it the first entry:

```js
export const skills = [
  {
    id: 'my-other-skill',
    title: 'My Other Skill',
    description: 'Short tagline shown in the sidebar.',
    entitySingular: 'fund',
    entityPlural: 'funds',
    downloadCmd: 'python3 .claude/skills/my-other-skill/run.py',
    dataDir: path.join(skillsRoot, 'my-other-skill/data'),
    registryFile: path.join(skillsRoot, 'my-other-skill/registry.json'),
    secFormFilter: null,         // disables the SEC search UI
  },
  // ...existing 13f-report entry
]
```

The portal currently shows one active skill at a time (the first registered).
Multi-skill switching (a UI picker, per-skill API namespaces) is a future
iteration.

## Public site (web/)

The third sub-project is a polished, **read-only** site for end users —
deployable as a static bundle to any host (Netlify, Cloudflare Pages, GitHub
Pages, S3+CloudFront). Different audience than the admin portal: no editing,
no `/api/*`, no auth.

Pages:

- **`/` — Home** (overview)
  - Hero banner with the latest reported quarter and headline tagline.
  - **Most-bought stocks** — top 10 securities ranked by *net dollars added*
    aggregated across every tracked investor, with a mini bar chart and chips
    showing which investors contributed.
  - **Most-sold stocks** — same shape for net trims + exits.
  - **Investor card grid** — each card links to the per-investor page.
- **`/investor/:cik`** (deep-linkable per-investor page)
  - Header with filer name, CIK, latest report date, prior comparison date.
  - Stats cards (total value with delta, holdings count, buy/sell counts).
  - Full holdings table — sortable by impact, filterable by action,
    free-text search on issuer / CUSIP. Read-only.

Routing uses `HashRouter` (`#/investor/1067983`) so the build deploys to any
static host without server rewrites. Configure the base URL via
`VITE_BASE` env var if hosting under a subpath (e.g. GitHub Pages):

```bash
VITE_BASE=/13F-report/ npm run build
```

The site reads the same skill `data/` directory as the portal — no extra
build pipeline, no copy step. Site title / tagline / external link target
are configured at the top of [`web/site.config.js`](web/site.config.js).

## Output JSON schema (per filer)

```json
{
  "name": "Berkshire Hathaway",
  "cik": "1067983",
  "latest_filing": { "form": "13F-HR", "report_date": "...", "filing_date": "...", "accession": "...", "primary_doc": "..." },
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
  "exited":   [{ "...same shape, shares=0...":  "" }],
  "top_buys": [{ "...subset of holdings where action in (new, add)...": "" }],
  "top_sells":[{ "...subset of holdings ∪ exited where action in (trim, exit)...": "" }]
}
```

`action` values, per security (aggregated by `cusip|class|put_call`):

- `new` — not in prior quarter
- `add` — share count increased
- `hold` — share count unchanged
- `trim` — share count decreased
- `exit` — removed entirely (lives in `exited`, not `holdings`)

`summary.json` carries just the per-filer overview (no holdings arrays) and
drives the portal sidebar.

## Caveats

- **13F is quarterly, not monthly.** The deadline is 45 days after each
  calendar quarter end. Monthly runs only surface late-arriving amendments and
  newly arrived quarters.
- **Value-unit change in 2023.** Pre-2023 13Fs reported `value` in $thousands;
  from Jan 2023 the field is in actual dollars. The script preserves whatever
  the filing reports — be careful when comparing across that boundary.
- **SEC fair-access policy.** Every request needs a descriptive User-Agent
  with contact info (`--user-agent "Name email@example.com"` or set
  `SEC_UA`). The script paces itself at ~10 req/s and retries 5xx/429 with
  exponential backoff.
- **Verify CIKs.** Some large managers file under multiple CIKs (parent vs.
  advisor entity). If a filer's holdings look small or stale, search EDGAR for
  the right entity and update `investors.json`.

See [`.claude/skills/13f-report/SKILL.md`](.claude/skills/13f-report/SKILL.md)
for the full skill documentation.

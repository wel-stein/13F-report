# 13F-report

Two cooperating pieces:

1. **Skill** at [`.claude/skills/13f-report/`](.claude/skills/13f-report/) —
   downloads SEC 13F-HR institutional holdings for the top 10 US investors,
   diffs each filer's stock-on-hand vs. the prior quarter, and writes JSON to
   the skill's `data/` directory.
2. **Portal** at [`portal/`](portal/) — React + Vite + Tailwind admin UI that
   reads the skill's JSON and renders per-investor stock-on-hand deltas.

```
13F-report/
├── .claude/skills/13f-report/   # the skill (Python, no JS deps)
│   ├── SKILL.md
│   ├── download_13f.py
│   ├── investors.json
│   ├── fixtures/                # XML fixtures for offline smoke test
│   └── data/                    # JSON output (consumed by the portal)
└── portal/                      # standalone React app, points at the skill's data/
```

## Quick start

```bash
# 1. populate the skill's data/ — pick one
python3 .claude/skills/13f-report/download_13f.py \
  --user-agent "Your Name you@example.com"          # live (needs SEC network)
python3 .claude/skills/13f-report/download_13f.py --smoke-test   # offline fixtures

# 2. run the portal
cd portal
npm install     # first time only
npm run dev     # http://localhost:5173
```

The portal's `vite.config.js` sets `publicDir` to
`../.claude/skills/13f-report/data`, so JSON written by the downloader is
served as-is — no copy step. Re-running the downloader and refreshing the
browser is enough to see new data.

See [`.claude/skills/13f-report/SKILL.md`](.claude/skills/13f-report/SKILL.md)
for the full output schema and caveats (13F is quarterly; value-unit change in
2023; SEC 10 req/s limit).

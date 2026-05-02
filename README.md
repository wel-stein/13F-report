# 13F-report

Claude Code skill for downloading SEC 13F-HR institutional holdings of the top
10 US investors, diffing each filer's stock-on-hand vs. the prior quarter, and
viewing the result in a React + Tailwind admin portal.

Everything lives under [`.claude/skills/13f-report/`](.claude/skills/13f-report/):

```
.claude/skills/13f-report/
├── SKILL.md              # full usage and output schema
├── download_13f.py       # SEC EDGAR fetcher / parser / differ
├── investors.json        # CIKs of the top 10 filers (editable)
├── fixtures/             # XML fixtures for offline smoke test
├── data/                 # JSON output (per-filer + summary.json)
└── portal/               # Vite + React + Tailwind admin UI
```

## Quick start

```bash
# 1. populate data/ — pick one
python3 .claude/skills/13f-report/download_13f.py \
  --user-agent "Your Name you@example.com"     # live (needs SEC network)
python3 .claude/skills/13f-report/download_13f.py --smoke-test   # offline fixtures

# 2. run the portal
cd .claude/skills/13f-report/portal
npm install   # first time only
npm run dev   # http://localhost:5173
```

See [`.claude/skills/13f-report/SKILL.md`](.claude/skills/13f-report/SKILL.md)
for the full output schema, caveats (13F is quarterly; value-unit change in
2023; SEC 10 req/s limit), and portal feature list.

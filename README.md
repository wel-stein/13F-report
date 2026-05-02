# 13F-report

Skill for downloading SEC 13F-HR institutional holdings for the top 10 US
investors, diffing against the prior quarter, and writing buy/sell/new/exit
deltas to JSON.

See [`.claude/skills/13f-report/SKILL.md`](.claude/skills/13f-report/SKILL.md)
for full usage. Quick start:

```bash
# Live download (requires network access to data.sec.gov and www.sec.gov)
python3 .claude/skills/13f-report/download_13f.py \
  --user-agent "Your Name you@example.com"

# Offline smoke test (uses bundled fixtures)
python3 .claude/skills/13f-report/download_13f.py --smoke-test
```

Output lands in `.claude/skills/13f-report/data/`.

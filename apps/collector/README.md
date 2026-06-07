# Collector — Collating Layer

Fetches jobs from the **Ever Jobs API**, filters for **junior remote AI engineer** roles, dedupes by URL, and stores matches in a **JSON file**.

Notifications are out of scope for now — this is the collating layer only.

## Prerequisites

1. Ever Jobs API running locally:

```bash
npm run start:dev
```

2. Copy env vars (optional — defaults work for local dev):

```env
COLLECTOR_EVER_JOBS_URL=http://localhost:3001
COLLECTOR_DB_PATH=./data/collector.json
COLLECTOR_SEARCH_TERM=junior AI engineer OR entry level machine learning
COLLECTOR_HOURS_OLD=48
COLLECTOR_RESULTS_WANTED=100
COLLECTOR_ALLOW_HYBRID=false
```

## Commands

```bash
# Run all batches (remote boards → major boards → AI companies → ATS)
npm run collect

# Single batch
npm run collect -- --batch remote-boards

# Preview matches without saving
npm run collect -- --dry-run

# List stored jobs
npm run collect:list

# JSON output
npm run collect -- --json
npm run collect:list -- --format json

# Browse jobs in browser
npm run collect:dashboard
```

Open **http://localhost:3456** after starting the dashboard. Custom port: `--port 4000`.

## Source batches

| Batch | Purpose |
| ----- | ------- |
| `remote-boards` | RemoteOK, Remotive, WWR, Jobicy, etc. |
| `major-boards` | LinkedIn, Indeed, Google, HN, Dice, … |
| `ai-companies` | OpenAI, Anthropic, xAI, Databricks, … |
| `ats-boards` | Greenhouse, Ashby, Lever, … |

Paid-key sources (Exa, Adzuna, Jooble, …) are **not** in default batches.

## Data

JSON file at `COLLECTOR_DB_PATH` (default `./data/collector.json`):

- `jobs` — matched roles, deduped by URL
- `runs` — per-batch collect history

## See also

- [JOB_NOTIS_PLAN.md](../../docs/JOB_NOTIS_PLAN.md) — full product plan (notifier comes later)

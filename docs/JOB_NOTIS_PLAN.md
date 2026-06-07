# Plan: Job Notis — Junior Remote AI Engineer Alerts

**Author:** AI Assistant  
**Date:** 2026-06-07  
**Status:** Draft — **Phase 0 (collector)** in progress; notifier deferred  
**Depends on:** Ever Jobs API (this repo)

> **Phase 0:** Build the collating layer first (`apps/collector`) — fetch, filter, dedupe, SQLite store. Add Telegram notifier only after collation works. See [apps/collector/README.md](../apps/collector/README.md).

---

## 1. Goal

Build a lightweight notifier that polls Ever Jobs on a schedule, finds **new** roles matching a single persona, and sends alerts to **Telegram**.

| Constraint | Value |
| ---------- | ----- |
| Role focus | Entry-level / junior **AI / ML engineer** (one persona) |
| Location | **Remote only** (no on-site; hybrid TBD — see §5) |
| Source coverage | **Broad** — keep wide source net; do not cut sources |
| Delivery | Telegram Bot API |
| Noise | Only net-new jobs (dedupe by URL) |

**Why wide sources:** Junior + AI + remote is a thin slice. Fewer sources = missed listings. Ever Jobs is the fetch engine; the notifier owns filtering and delivery.

---

## 2. Architecture

```
┌─────────────┐     cron / scheduler      ┌──────────────────┐
│  Scheduler  │ ────────────────────────► │  Job Notifier    │
└─────────────┘                           │  (new app)       │
                                          └────────┬─────────┘
                                                   │
                     POST /api/jobs/search         │ filter + dedupe
                     (batched by source group)    │
                                                   ▼
                                          ┌──────────────────┐
                                          │  Ever Jobs API   │
                                          │  (this monorepo) │
                                          └────────┬─────────┘
                                                   │
                     sendMessage                   ▼
                                          ┌──────────────────┐
                                          │  Telegram Bot    │
                                          └──────────────────┘
```

**Principles**

- Ever Jobs stays unchanged as much as possible — no fork of 850 plugins.
- Notifier is a **separate small app** (recommended: `apps/notifier/` or sibling repo).
- All product logic (junior AI + remote + dedupe + Telegram) lives in the notifier.

---

## 3. Source strategy

### 3.1 Keep the wide net

Use Ever Jobs' full source registry. Scarcity of target roles outweighs the cost of noise — post-fetch filters handle precision.

### 3.2 Batch requests (avoid timeouts)

Do **not** fire one search with all 160+ `siteType` values. Split into groups and stagger:

| Batch | Examples | Interval offset |
| ----- | -------- | --------------- |
| A — Remote boards | RemoteOK, Remotive, We Work Remotely, Jobicy, Himalayas, Arbeitnow, NoDesk, … | :00 |
| B — Major boards | LinkedIn, Indeed, Glassdoor, ZipRecruiter, Google Jobs, Dice, … | :15 |
| C — AI / tech boards | Hacker News, Echojobs, FindWork, BuiltIn, Wellfound, … | :30 |
| D — Company + ATS | Greenhouse/Lever/Ashby company plugins, AI-heavy employers (Anthropic, OpenAI, Scale, …) | :45 |

Each batch: one API call with that batch's `siteType` array + shared search params.

### 3.3 Fetch params (per batch)

```json
{
  "searchTerm": "junior AI engineer OR entry level machine learning OR associate ML engineer",
  "isRemote": true,
  "hoursOld": 48,
  "resultsWanted": 100,
  "siteType": ["remoteok", "remotive", "..."]
}
```

| Param | Notes |
| ----- | ----- |
| `isRemote: true` | Honored by Indeed, LinkedIn, some others at query time |
| `hoursOld: 48` | Widen window for scarce roles; tune down once stable |
| `resultsWanted` | Per batch, not global |
| `dedup` | `true` on API (cross-source); notifier dedupes again vs seen store |

---

## 4. Post-fetch filters (notifier)

Two passes after each batch returns.

### 4.1 AI / role match (title + optional description snippet)

**Include** if title matches any:

```
\b(ai|ml|machine learning|llm|nlp|deep learning|data scientist)\b
```

AND any junior signal:

```
\b(junior|entry[- ]?level|associate|grad(uate)?|new grad|intern(ship)?|0-2 years?|0-1 years?|early career)\b
```

**Exclude** if title (or `jobLevel` when present) matches:

```
\b(senior|staff|principal|lead|manager|director|head of|architect|5\+ years?|7\+ years?|10\+ years?)\b
```

### 4.2 Remote-only

Accept if **any** of:

- `job.isRemote === true`
- Location string matches: `remote`, `work from home`, `wfh`, `anywhere`, `distributed`
- Title contains `remote` (weak signal — use with location check)

**Reject** if location/title clearly on-site:

```
\b(on[- ]site|in[- ]office|hybrid)\b
```

> **Open decision:** Allow hybrid? Default plan: **reject hybrid** unless title also says "remote-first" or location is explicitly remote-friendly. Revisit after first week of alerts.

### 4.3 Quality gate

- Must have `jobUrl`
- Must have `title` and `companyName` (or equivalent)
- Optional: drop listings with empty description if too many false positives

---

## 5. Dedup & state

| Store | Purpose |
| ----- | ------- |
| `seen_jobs` | `job_url` (PK), `first_seen_at`, `title`, `company`, `notified_at` |
| Backend | SQLite file (simplest) or Ever Jobs store if already running Postgres |

**Flow**

1. Filter batch results → candidate list
2. Drop any `jobUrl` already in `seen_jobs`
3. Send Telegram for survivors
4. Insert into `seen_jobs` **after** successful send (or before, with `notified_at` null + retry — pick one; recommend insert-after-send)

**Canonical key:** normalized URL (strip tracking params, lowercase host).

---

## 6. Telegram delivery

### 6.1 Setup

1. Create bot via [@BotFather](https://t.me/BotFather) → `TELEGRAM_BOT_TOKEN`
2. Get chat id (DM or group) → `TELEGRAM_CHAT_ID`

### 6.2 Message format

One message per job (low volume expected):

```
🆕 Junior AI — Remote

{title}
{companyName}
{location or "Remote"}

{jobUrl}

via {site}
```

Use `parse_mode: HTML` or plain text. Link preview on.

### 6.3 Behavior

| Case | Action |
| ---- | ------ |
| 0 new jobs | Silent (no message) |
| 1–10 new jobs | Individual messages |
| >10 new jobs | Optional daily digest mode (phase 2) |

Rate limit: max 1 msg/sec to respect Telegram limits.

---

## 7. Proposed layout

```
apps/notifier/
  src/
    main.ts              # entry: run once or cron loop
    config.ts            # env + filter rules
    ever-jobs.client.ts  # POST /api/jobs/search wrapper
    filters/
      ai-role.filter.ts
      remote.filter.ts
      seniority.filter.ts
    store/
      seen-jobs.store.ts # SQLite
    telegram/
      telegram.service.ts
    scheduler/
      batches.ts         # source group definitions
  package.json
  .env.example
```

---

## 8. Environment variables

| Variable | Required | Description |
| -------- | -------- | ----------- |
| `EVER_JOBS_API_URL` | yes | e.g. `http://localhost:3001` |
| `EVER_JOBS_API_KEY` | no | If API auth enabled |
| `TELEGRAM_BOT_TOKEN` | yes | From BotFather |
| `TELEGRAM_CHAT_ID` | yes | Target chat |
| `NOTIS_DB_PATH` | no | Default `./data/seen-jobs.sqlite` |
| `NOTIS_HOURS_OLD` | no | Default `48` |
| `NOTIS_CRON` | no | e.g. `*/30 * * * *` or run via system cron |
| `NOTIS_ALLOW_HYBRID` | no | Default `false` |

Ever Jobs side (existing):

| Variable | Notes |
| -------- | ----- |
| `EVER_JOBS_DISABLED_SOURCES` | Optional — disable chronically broken sources |
| API keys for Exa, Adzuna, etc. | Only if those batches are included |

---

## 9. Implementation phases

### Phase 1 — MVP (1–2 days)

- [ ] Scaffold `apps/notifier`
- [ ] Ever Jobs client (single batch: remote boards only)
- [ ] Post-fetch filters (AI + junior + remote)
- [ ] SQLite seen store
- [ ] Telegram send
- [ ] Manual run: `npm run notis` or `node dist/main.js`

### Phase 2 — Full coverage

- [ ] All four source batches + staggered cron
- [ ] Error handling + logging per batch
- [ ] Health log: `{ batch, fetched, matched, new, sent, errors }`

### Phase 3 — Hardening

- [ ] Retry failed Telegram sends
- [ ] Disable flaky sources via env without code change
- [ ] Optional: wire to Ever Jobs `/health` before polling
- [ ] Tune filter rules from 1–2 weeks of false positive/negative review

### Phase 4 — Nice-to-have

- [ ] `/status` Telegram command (jobs seen today, last run)
- [ ] Digest mode for busy days
- [ ] Salary line in alert when `compensation` present

---

## 10. Operational notes

| Topic | Approach |
| ----- | -------- |
| Ever Jobs uptime | Run API via Docker (`docker compose up`); notifier exits gracefully if API down |
| Scrape fragility | Circuit breaker in Ever Jobs skips dead sources; batches continue |
| Cost | Self-hosted; Telegram free; watch Playwright-heavy sources if enabled |
| Legal | User responsibility — scraping ToS varies by board |

---

## 11. Success criteria

- [ ] Receive Telegram alert within ~1 hour of a matching job appearing on any monitored source
- [ ] Zero duplicate alerts for the same URL
- [ ] <20% false positives (senior/on-site/non-AI) after phase 3 tuning
- [ ] Stable daily operation without manual restarts

---

## 12. Open questions

| # | Question | Default |
| - | -------- | ------- |
| Q1 | Allow hybrid roles? | No |
| Q2 | Include "AI intern" / unpaid internships? | Yes, if remote |
| Q3 | Include adjacent titles (MLOps junior, AI SWE)? | Yes — widen AI regex |
| Q4 | Notifier inside monorepo vs separate repo? | `apps/notifier` in this repo |
| Q5 | Run frequency? | Every 30 min, batches staggered 15 min |

---

## 13. Related docs

- [DEPLOYMENT.md](./DEPLOYMENT.md) — run Ever Jobs API
- [CLI.md](./CLI.md) — alternative to HTTP for local dev
- [AUTHENTICATION.md](./AUTHENTICATION.md) — API key setup

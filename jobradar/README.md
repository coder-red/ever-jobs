# jobradar

Entry-level AI/ML job notifications for a **Nigeria-based** engineer — Nigerian
roles and international roles you can actually be hired into.

Self-contained: no build step, no database, no browser automation, **zero npm
dependencies**. Node 18+ and a Telegram bot token are all it needs.

```bash
node radar.mjs               # collect, score, verify, send to Telegram
node radar.mjs --dry         # everything except sending
node radar.mjs --why         # also show why things were rejected
node radar.mjs --track ng    # Nigeria only (or: intl)
node radar.mjs --no-enrich   # skip page verification (faster, less accurate)
node radar.mjs --no-agencies # jobs only, skip agency suggestions
node radar.mjs --find-chat   # recover your Telegram chat id

node bot.mjs                 # interactive Telegram UI (commands + buttons)
node bot.mjs --once          # drain pending updates and exit (used by CI)

node verify.mjs              # audit: is each result's CLAIM true on the page?
node eval.mjs                # audit: is each result still live and dated?
node report.mjs              # render data/latest.json to data/report.html
node health.mjs              # is the bot alive? pipeline + scan freshness

test-all.cmd                 # all four suites (100 tests)
```

## Where it runs

**GitHub Actions — free, and independent of your laptop.** `.github/workflows/jobradar.yml`:

| Cron | Mode | Does |
|---|---|---|
| `7 * * * *` | scan | full collect → score → verify → notify |
| `*/10 * * * *` | drain | handles `/agencies`, `/jobs` and every button tap since the last run |

State (`seen.json`, `outreach.json`, `source-health.json`, `latest.json`) is
committed to the **`jobradar-data`** branch each run. That branch must stay
distinct from ever-jobs' `data` branch or the two pipelines overwrite each other.

Credentials come from repository **Secrets** (`TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`) — never from a file, never in the code. `process.env` takes
priority over any local `.env`, so the same code runs in both places unchanged.

Every run executes all four test suites first and fails the job if any break, so
a bad scorer can never reach your phone.

**Trade-off vs a always-on server:** button taps are handled on the next drain,
so the UI responds in up to ~10 minutes rather than instantly. GitHub's cron is
also best-effort and can fire 5–20 minutes late. Free, and good enough for job
alerts; if you ever want instant buttons, that needs a host that stays awake.

### Optional: also run locally

Not required — the workflow covers it. If you want it on your PC too:

```powershell
schtasks /create /tn "jobradar" /tr "C:\...\jobradar\run.cmd" /sc hourly /mo 1
```

Plus `bot.mjs` for an instant-response listener (autostarts via a `.vbs` in the
Startup folder). **Only one poller may hold the bot token at a time** — if the
workflow is draining every 10 minutes, don't also run a local listener, or they
will fight and taps get dropped. Remove the local pieces with
`schtasks /delete /tn jobradar /f` and by deleting `jobradar-bot.vbs` from
Startup.

---

## Why this exists

The `ever-jobs` pipeline was producing noise. The diagnosis, from its own data:

| Finding | Evidence |
|---|---|
| Pipeline dead 5 weeks | last run in `data/collector.json` was `2026-06-17`; inspected `2026-07-25` |
| Every stored job was a repost farm | TekVizor, "ChatGPT Jobs", Hire Feed, CodeGeniusRecruit, "Jobs via Dice" |
| Telegram got gig work, not jobs | `notified.json`: "CUDA Kernel Optimization Specialist — **AI Trainer**", "Voice AI **Research Participant**", "Technical **Co-Founder**" |
| Remote boards matched nothing | `fetched: 119, matched: 0`, three consecutive runs |
| Nigerian boards fetched nothing | `ng-job-boards fetched: 0` every run — `DEFAULT_SEARCH_TERM` wiped them |
| **No geo-eligibility check at all** | every stored job was `"location": "United States"`; nothing in `persona.filter.ts` asked whether a Nigeria-based person could be hired |

That last row is the one that mattered. A perfectly-filtered US-remote role is
still a role you cannot take.

---

## The eligibility gate

An international role must offer **at least one route** by which someone in
Nigeria can actually be employed. This is the core idea of the whole tool.

| Route | Meaning | Score |
|---|---|---|
| `worldwide` | explicitly hires anywhere / any timezone | +30 |
| `africa-emea` | Africa, EMEA, or GMT/CET overlap in scope | +28 |
| `visa-relocation` | sponsorship or relocation offered | +30 |
| `contractor-eor` | hires via contractor / Deel / EOR | +18 |
| `remote-unconfirmed` | remote-only board, no stated geo limit — **verify before applying** | +16 |

No route → rejected. A hard geo block (`US only`, `must be authorized to work
in the US`, `no sponsorship`, `security clearance`) → rejected, unless the role
is explicitly a visa-sponsorship one.

A job pinned to a single city can only qualify via `visa-relocation`; it can
never claim `worldwide` from marketing boilerplate. That bug is why an on-site
Berlin role was briefly showing as "hires worldwide".

## Two tracks

**Nigeria** — widest possible net, as intended. Any AI/ML role, any seniority,
any employer, remote or on-site. Only gig work, founder posts, and scams are
dropped.

**International** — strict. AI/ML signal must be in the **title** (not the
description: every job ad on earth mentions AI in its boilerplate now, which is
how "Ubuntu Sales Engineer" and "Global Treasury Analyst" got through an early
version). Must be an engineering title, not senior/staff/lead/principal, not a
mega-cap employer, and must pass the eligibility gate.

## What gets rejected

- **Gig / data-labeling work** — AI trainer, annotator, search-quality rater,
  research participant, and the platforms behind them (Mercor, Scale, Surge,
  Outlier, Appen, Peroptyx, …). On a typical run this is **~34% of everything
  labeled "AI"** on remote boards. It was the single largest source of noise.
- **Staffing mills / repost farms** — seeded from the offenders actually found
  in the old `collector.json`.
- **Teaching roles** — "Artificial Intelligence Tutor", "AI Facilitator",
  "AI/ML Engineering Instructor", university lecturer/professor posts. Teaching
  AI is a different career from building it. Delete `EDUCATION_ROLE` in
  `lib/score.mjs` if you want these.
- **Founder / equity-only posts**, scam markers, stale postings (>30d).

---

## The Telegram UI

`radar.mjs` only pushes. `bot.mjs` **listens** — it long-polls `getUpdates`, so
commands and inline buttons work. That turns a firehose of messages into
something you can work through.

```bash
node bot.mjs          # foreground listener (Ctrl-C to stop)
node bot.mjs --once   # drain pending updates and exit
```

Starts automatically at logon via
`%APPDATA%\…\Startup\jobradar-bot.vbs` → `bot.cmd` (restart loop, hidden
window). Delete that .vbs to stop it.

### Commands

Registered with `setMyCommands`, so Telegram shows them in the ☰ menu.

| Command | Does |
|---|---|
| `/agencies` | Next agency to contact — **one card at a time**, highest score first |
| `/pending` | How many are still waiting |
| `/done` | Ones you've marked DM'd |
| `/skipped` | Ones you passed on |
| `/jobs` `/ng` `/intl` | Latest roles, all / Nigerian / international |
| `/stats` | Scan funnel + outreach pipeline numbers |

### Buttons

Every agency card carries inline buttons:

- **✅ Mark DM sent** — records it, rewrites the card in place, removes it from
  the queue permanently
- **⏭ Skip** — same, but filed as skipped
- **💬 They replied** / **↩️ Undo** — appear once a card is marked done
- **✉️ Email them** / **🔎 Open LinkedIn** — opens the contact directly
- **➡️ Next agency** — advances the queue without leaving the chat

State lives in `data/outreach.json`, separate from `seen.json`. The important
guarantee, locked by a test: **an hourly rescan refreshes an agency's score and
posting count but never overwrites a status you set.** Marking a firm DM'd stops
it reappearing for good, not for 30 days.

### One poller only

Telegram allows exactly **one** `getUpdates` consumer per bot token. Anything
else calling it — the old ever-jobs notifier, or a stray diagnostic — steals the
slot and the bot goes deaf.

A single 409 is treated as transient (overlapping restart, one-off call) and
retried for ~50s; only 10 consecutive conflicts mean a real second instance and
trigger a clean exit. An earlier version exited on the *first* 409, which meant
one stray API call silently killed the bot.

**So: never run `getUpdates` against this token while the bot is up.** Use
`node health.mjs`, which infers health from the process list and log instead.

## Agency radar (cold-outreach leads)

Separate from job matching. Alongside vacancies, each run suggests recruitment
and outsourcing firms worth a cold DM — Nigerian and international.

**The signal is hiring activity, not what they're hiring for.** An outsourcing
firm staffing backend roles today places AI/ML roles next quarter, so AI/ML
postings add score but are never required. A firm that posted this week is a
firm reading its inbox this week.

The neat part: the staffing-mill **blocklist** that removes reposts from job
results is the **lead list** here. Same companies, opposite purpose.

Scored on: known talent firm (+34) or Nigerian recruiter (+26) or agency-shaped
name (+20) or recruiting-on-behalf language (+18); posting volume (+5…+26);
recency (+16 this week, −10 if nothing in 90 days); AI/ML roles already (+8…+18);
a contact email on the posting (+12).

Half the slots are reserved for Nigerian firms — global names like Toptal
outscore local ones, and local firms are likelier to answer a cold DM.
Each firm is suggested once per `agencyCooldownDays` (30).

**Never suggested:** direct employers with agency-ish names (a 127-posting
hospital, "Frangipani Concrete Business School", Dangote), gig platforms, and
job boards. Generic suffixes — Limited, Group, International, Services — are
explicitly *not* evidence; they match most Nigerian company names and produced
schools and clinics as "agencies" in the first version.

Every scored lead enters the pipeline (~190 tracked) and is browsable via
`/agencies`. Only 2 are pushed unprompted per run, since the queue is on demand.
Typical run: ~190 leads found, Contact emails are rare (~4 of 190)
since most boards strip them — the rest fall back to a LinkedIn company search.

## Verification (why the feeds alone aren't enough)

An audit of the first run (`node eval.mjs`) fetched all 46 matches and found:

- **10 of 46 were dead** — all 8 Jobberman links returned "expired/removed"
  while still appearing in its search results. (2 more were Jobicy 403s, which
  are anti-bot responses, not dead jobs — those are kept.)
- **Nigerian boards ship no date at all.** MyJobMag states `Posted: <date>` on
  the job page but nothing in the listing. Without it, a Korapay role **78 days
  old** scored identically to one posted that morning.

So every match now gets its page fetched before anything is sent:

| Check | Action |
|---|---|
| 404 / 410 / "expired" | dropped |
| 403 / 429 / timeout | **kept** — inability to check is not evidence of closure |
| `Posted:` date found | job re-scored with the real date |
| `Deadline:` already passed | dropped |

That turned one run's 46 matches into **13 live and current** — 7 dead links,
3 closed deadlines, 27 dates recovered, 17 revealed as too old.

This costs ~40 fetches per run (the matched set only, never the full 1,600) and
adds a few seconds. `--no-enrich` skips it.

## Freshness

Job ads saturate within days, so age is treated as a first-class signal: it's
shown in every Telegram message and on every card, and it feeds the score
(≤3 days +10, ≤7 days +6, older than `maxAgeDays` rejected).

The hourly schedule exists for the same reason — a role posted at 09:00 reaches
you by 10:00 rather than whenever you next remember to run it. Dedupe via
`data/seen.json` means an hourly run that finds nothing new sends nothing.

## Sources

All no-auth. Each fails soft — one dead source never takes down a run.

| Source | Track | Notes |
|---|---|---|
| remoteok | intl | queried by AI tag, not the firehose |
| remotive | intl | 9 keyword searches; states eligibility directly |
| himalayas | intl | has structured `locationRestrictions` — most reliable geo signal |
| jobicy | intl | tag + geo queries (`geo=anywhere` is rejected by their API — omit geo) |
| arbeitnow | intl | best source of **visa-sponsored** EU roles |
| weworkremotely | intl | category RSS (their search RSS returns nothing) |
| workingnomads | intl | remote-only aggregator |
| **ats** | intl+NG | **company ATS boards direct** — Greenhouse/Lever/Ashby. GitLab, Canonical, Remote.com, Vercel, Moniepoint, Jumia, Andela, Cohere, Toptal. ~1,800 postings, no aggregator lag |
| myjobmag | NG | **the NG workhorse** — ~37 matches/run |
| jobberman | NG | ~17 matches/run |
| hotnigerianjobs | NG | RSS. Currently **0 AI/ML titles in 600 postings** — kept because that will change, but it contributes nothing today |

Himalayas silently **caps `limit` at 20 and needs `offset` in steps of 20** — asking for `limit=100&offset=100` returns the same 20 rows, so six "pages" were one page repeated.

Querying these boards **by keyword is essential**. Their bare endpoints return
the newest ~100 postings of any kind; sampling that way yielded 21 AI/ML jobs
out of 1,340 postings. Searching yields ~186 out of 2,020.

---

## Honest expectations

A representative run: **~2,000 raw → ~44 matched → ~43 Nigerian, ~1–3 international.**

The international number is low because the funnel is genuinely brutal, not
because the filter is broken. Of ~186 AI/ML-titled international postings:

- 57 senior/lead (you're entry-level)
- 63 gig / data-labeling work
- 35 non-engineering (AI product manager, AI designer)
- 19 geo-locked

Nigeria is where the volume is right now — Chowdeck, Korapay, Moniepoint, MTN,
Access Bank, Reliance HMO all had live AI/ML roles on the first run.

To widen the international net, lower `minScoreIntl` in `config.json` (45 today)
or raise `maxAgeDays`. Both trade precision for volume.

---

## Files

```
radar.mjs        orchestrator + CLI
test.mjs         35 regression tests, every one a real posting that was scored wrong
config.json      sources, score floors, limits
lib/sources.mjs  fetchers (JSON + RSS)
lib/score.mjs    eligibility gate + scoring — the heart of it
lib/notify.mjs   Telegram
lib/store.mjs    dedupe + .env reader
data/seen.json   dedupe state (seeded once from the old pipeline's notified.json,
                 so nothing you were already sent gets re-sent)
```

## Scheduling

```powershell
schtasks /create /tn "jobradar" /tr "node C:\Users\hp\job_notis\jobradar\radar.mjs" /sc daily /st 08:00
```

Run `node test.mjs` after any change to `lib/score.mjs`.

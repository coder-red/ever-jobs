# Job Notis — Telegram Notifier

> Plain-TS Telegram notifier. Reads `data/collector.json` (output of `apps/collector`),
> sends one Telegram message per previously-unnotified job URL, persists state in
> `data/notified.json`. No NestJS, no DI — just a cron loop and one HTTP call.

## Prerequisites

1. **Ever Jobs collector must have populated `data/collector.json`** (run
   `npm run collect` once).
2. **Telegram bot**: create via [@BotFather](https://t.me/BotFather) → copy the
   `TELEGRAM_BOT_TOKEN`. Get your `TELEGRAM_CHAT_ID` by messaging [@userinfobot](https://t.me/userinfobot)
   (or your group ID if posting to a group).

## Environment

Copy `.env.example` to `apps/notifier/.env` and fill in:

```env
TELEGRAM_BOT_TOKEN=123456789:AA...           # required
TELEGRAM_CHAT_ID=123456789                   # required (your user id or a group id)
NOTIS_DATA_PATH=./data/collector.json        # input (collector output)
NOTIS_NOTIFIED_PATH=./data/notified.json     # output (this app's state)
NOTIS_CRON=*/30 * * * *                      # schedule
NOTIS_INTERVAL_MS=1100                       # gap between sends (Telegram-safe)
```

## Commands

```bash
# Continuous cron loop
npm run notis

# One cycle and exit (for testing / cron-system mode)
npm run notis:once

# Dry-run: print what *would* be sent, no Telegram call
npm run notis:dry
```

## Output

Per cycle, prints a one-line summary:

```
[notis] cycle=1 total=12 new=2 sent=2 failed=0 notified_store=10
```

If `new > 0`, also prints each job that was sent (or would be sent in dry-run):

```
[notis] → Junior AI Engineer @ Acme (Remote) — https://...
```

## See also

- [JOB_NOTIS_PLAN.md](../../docs/JOB_NOTIS_PLAN.md) — full product plan
- [Spec 701](../../.specify/specs/701-job-notis-notifier/spec.md) — functional spec

## Deployment — GitHub Actions (24/7, $0)

Public repo = unlimited free GHA minutes. The workflow at
`.github/workflows/notis.yml` runs every 30 min: it builds the API, starts
it in the background, runs the collector against it, then the notifier. State
(`collector.json` + `notified.json`) persists on a separate `data` branch.

### One-time setup (5 min)

1. **Add two GitHub Secrets** at
   `Settings → Secrets and variables → Actions → New repository secret`:
   - `TELEGRAM_BOT_TOKEN` — from [@BotFather](https://t.t.me/BotFather) `/newbot`
   - `TELEGRAM_CHAT_ID` — from [@userinfobot](https://t.me/userinfobot) (your
     user id) or a group id (negative number, bot must be a member)

2. **Create the `data` branch** with empty state files (one-time, locally):

   ```bash
   cd ever-jobs
   git checkout --orphan data
   git rm -rf .   # remove everything from main
   printf '{"jobs":{},"runs":[],"next_id":1}\n' > collector.json
   printf '{"urls":{}}\n' > notified.json
   : > collect.log
   git add -A
   git commit -m "chore(notis): initial empty state"
   git push -u origin data
   git checkout develop   # back to your work
   ```

3. **Push the workflow**:

   ```bash
   git add .github/workflows/notis.yml
   git commit -m "ci(notis): add GitHub Actions cron"
   git push origin develop
   ```

4. **First run** (manual, to verify before waiting on the schedule):
   `Actions → Job Notifier (Telegram) → Run workflow`. Watch the logs.

### What the workflow does each cycle

1. Check out `develop` (code) and `data` (state) into separate paths.
2. `npm ci` (with `actions/setup-node` cache).
3. Restore `collector.json` + `notified.json` from the `data` branch into
   `src/data/`.
4. `npx nest build api` → `node dist/apps/api/main.js &` (background).
5. Poll `http://localhost:3001/health` until ready (max 60 s).
6. `npm run collect` (writes new jobs to `data/collector.json`).
7. `npm run notis:once` (sends to Telegram, updates `data/notified.json`).
8. Copy state files back into the `data` branch checkout, commit, push.

### Caveats

- **GHA cron is best-effort.** Scheduled jobs may be delayed 5-15 min during
  GitHub-wide peaks. This is fine for a 30-min cadence.
- **First cycle of the day may include 0 new jobs** (the persona filter is
  intentionally tight — expect mostly empty inboxes until you tune it).
- **Don't put `TELEGRAM_BOT_TOKEN` in `apps/notifier/.env` on develop** — GHA
  reads it from Secrets, not from the file. Keep the local `.env` for
  `npm run notis:once` testing only.
- **State on the `data` branch is not encrypted.** It contains only public job
  URLs + titles — no PII. If that ever changes, encrypt with
  `SOPS`/`age` before committing.

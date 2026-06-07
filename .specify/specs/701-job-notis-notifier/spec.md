# Spec 701 — Job Notis Notifier (Telegram Delivery)

| Field          | Value                              |
| -------------- | ---------------------------------- |
| Spec ID        | 701                                |
| Slug           | job-notis-notifier                 |
| Status         | draft                              |
| Owner          | opencode (per user request)        |
| Created        | 2026-06-07                         |
| Last updated   | 2026-06-07                         |
| Supersedes     | (none)                             |
| Related specs  | (none — depends on apps/collector) |

## 1. Problem Statement

`apps/collector` (built under `docs/JOB_NOTIS_PLAN.md`) already fetches, filters, dedupes,
and stores junior remote AI engineer roles into `data/collector.json`. The owner polls the
data on a manual basis via the dashboard at `localhost:3456`. There is no proactive alert
path. The owner wants a Telegram message the moment a matching role appears, without
having to keep the dashboard open.

The Ever Jobs monorepo is heavy (NestJS + Nx, 850+ source plugins). Adding a NestJS app for
a one-purpose cron poller is overkill. The notifier must be a **plain TypeScript package**
sitting alongside the existing `apps/*` workspace, with no DI container, no decorators, no
HTTP server of its own.

## 2. Goals

- Read collated jobs from `apps/collector`'s JSON store (no new write path).
- Send one Telegram message per previously-unnotified job URL.
- Run on a cron schedule (default 30 min) with a single-shot manual entrypoint for testing.
- Dedupe by URL; never alert the same URL twice.
- Honor Telegram rate limits (1 msg/sec, conservative).
- Fail gracefully if Telegram or the data file is unavailable — never crash the loop.
- Be testable: unit tests for the filter, dedupe, format, and Telegram send (with a stub).

## 3. Non-Goals

- Not a NestJS app. No `@Module`, no DI, no controllers, no GraphQL/MCP surface.
- Not a plugin. Plugins are source-side (`packages/plugins/*`); the notifier is a consumer.
- Not a real-time webhook receiver. Polling only.
- Not a multi-channel notifier. Telegram only.
- Does not modify `data/collector.json` (read-only consumer).
- Does not re-run the collect pipeline. Assumes collector has already populated the store.
- No retry queue, no dead-letter store for failed sends (v1 — log and skip).

## 4. User / Caller Stories

- *As the job seeker*, I want a Telegram message within ~1 hour of a new matching role
  appearing on any monitored source, so I can apply before the listing fills.
- *As the operator*, I want to start the notifier with `npm run notis` and leave it running
  for weeks without manual intervention.
- *As the operator*, I want a dry-run mode that prints what *would* be sent without calling
  Telegram, so I can tune the message format.
- *As the operator*, I want a one-shot mode (`npm run notis:once`) to flush a backlog
  immediately, useful after a long downtime.

## 5. Functional Requirements

| ID    | Requirement                                                                    | Priority |
| ----- | ------------------------------------------------------------------------------ | -------- |
| FR-1  | Read `data/collector.json` on every cycle; parse the `jobs` map.               | must     |
| FR-2  | For each job, compute the notifier's notion of "new" = not previously notified | must     |
| FR-3  | Persist "notified" state in a separate file `data/notified.json` keyed by URL.  | must     |
| FR-4  | Format a Telegram message: title, company, location, URL, source site.         | must     |
| FR-5  | POST to `https://api.telegram.org/bot<token>/sendMessage` per job.             | must     |
| FR-6  | Throttle to 1 message per second; use a sleep between sends.                   | must     |
| FR-7  | Run on cron schedule (default 30 min); first run after 30s warm-up.            | must     |
| FR-8  | One-shot mode: run one cycle and exit (`--once`).                              | must     |
| FR-9  | Dry-run mode: print would-be messages, no Telegram call (`--dry-run`).         | must     |
| FR-10 | Skip + log a job if the Telegram send fails (no crash).                        | should   |
| FR-11 | Print a per-cycle summary: total, new, sent, failed, errors.                   | must     |
| FR-12 | Read all config from env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,            | must     |
|       | `NOTIS_DATA_PATH`, `NOTIS_NOTIFIED_PATH`, `NOTIS_CRON`, `NOTIS_INTERVAL_MS`.   |          |
| FR-13 | Refuse to start if `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` is missing.      | must     |
| FR-14 | Exit cleanly on SIGINT/SIGTERM (finish in-flight sends, close files).          | should   |

## 6. Non-Functional Requirements

| ID     | Requirement                            | Target              |
| ------ | -------------------------------------- | ------------------- |
| NFR-1  | Cycle latency (read → send, 10 jobs)   | < 15 s end-to-end   |
| NFR-2  | Memory footprint                       | < 50 MB RSS         |
| NFR-3  | Cold-start time to first cycle         | < 2 s               |
| NFR-4  | Test coverage on core modules          | ≥ 80 %              |
| NFR-5  | No new runtime deps beyond what's declared (no transitive bloat) | yes |

## 7. Contracts

### 7.1 Input: `data/collector.json` (read-only)

Shape is owned by `apps/collector` (see `CollatedJobRow` in
`apps/collector/src/store/collated-jobs.store.ts`). The notifier consumes `jobs` map.

```ts
interface CollatedJob {
  id: number;
  job_url: string;
  title: string;
  company_name: string | null;
  site: string | null;
  is_remote: number | null;       // 0 | 1
  location: string | null;
  date_posted: string | null;
  first_seen_at: string;          // ISO
  last_seen_at: string;           // ISO
  payload_json: string;           // JobPostDto JSON
}
```

### 7.2 Output: `data/notified.json` (write)

```ts
type NotifiedStore = Record<string, { notified_at: string }>;  // keyed by job_url
```

### 7.3 Output: Telegram `sendMessage`

```ts
POST https://api.telegram.org/bot<token>/sendMessage
Content-Type: application/json

{
  "chat_id": "<env>",
  "text": "<formatted message>",
  "disable_web_page_preview": false,
  "parse_mode": "HTML"
}
```

Expected response: `{ ok: true, result: { message_id: ... } }`. Non-200 or `{ok:false}` →
log and skip.

### 7.4 Errors

| Code                  | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| `ERR_CONFIG_MISSING`  | Required env var not set; process exits with code 2.   |
| `ERR_DATA_READ`       | `collector.json` unreadable; cycle skipped, retried.   |
| `ERR_TELEGRAM_SEND`   | Non-2xx or `ok:false`; job skipped, not retried in v1. |

## 8. Test Plan

- **Unit — `format.ts`:** pure-function message template; snapshot-test against 3 jobs.
- **Unit — `dedupe.ts`:** loads `notified.json`, computes new set, merges back.
- **Unit — `telegram.ts`:** stubbed `fetch`; verifies URL, body, headers; rejects on non-2xx.
- **Unit — `notifier.ts`:** orchestrator with stubbed telegram + stubbed data file.
  - empty store → 0 sent
  - 2 new jobs → 2 sent, persisted to `notified.json`
  - 1 new + 1 already notified → 1 sent
  - telegram fails on job #2 → 1 sent, 1 error logged, file not updated for failed one
- **Integration:** write a fixture `collector.json` (5 jobs), run `--once --dry-run`,
  assert stdout lists all 5 with correct format.
- **E2E (manual):** run with real Telegram creds against a fixture, verify message in chat.

## 9. Open Questions

| # | Question                                                 | Default                    |
| - | -------------------------------------------------------- | -------------------------- |
| 1 | Daily digest vs. per-job send?                           | Per-job (low volume).      |
| 2 | Keep `notified.json` forever or TTL it?                  | Forever in v1; revisit.    |
| 3 | Should the notifier auto-trigger a `collect` cycle if the data file is stale (>1h)? | No in v1; manual or cron.  |
| 4 | Run notifier as its own process, or wrap it into a child command of `collect:dashboard`? | Standalone process.        |

## 10. Decisions

- 2026-06-07 — Plain TS package, **not** NestJS. Reasons: scope is one cron + one HTTP call.
- 2026-06-07 — Notifier reads `collector.json` directly. No new abstraction layer (no
  collector-as-lib). Decouples deploy, simplifies local dev.
- 2026-06-07 — Persist notified state in a sibling JSON file, not a new column in
  `collector.json`. Keeps notifier side-effect-free on the collector's data file.

## 11. References

- `docs/JOB_NOTIS_PLAN.md` — product plan (Phase 0 = collector, Phase 1 = notifier)
- `docs/index.md` — repo doc index
- `apps/collector/README.md` — collector usage
- `apps/collector/src/store/collated-jobs.store.ts` — store shape
- `AGENTS.md` §3, §4, §5, §6, §7, §10 — repo rules

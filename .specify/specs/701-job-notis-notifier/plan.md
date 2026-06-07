# Plan: 701 — Job Notis Notifier (Telegram Delivery)

| Field        | Value                              |
| ------------ | ---------------------------------- |
| Spec         | spec.md                            |
| Created      | 2026-06-07                         |
| Last updated | 2026-06-07                         |

## 1. Approach

The notifier is a **plain TypeScript Node.js package** at `apps/notifier/`. It is *not* a
NestJS module — that would add ~200 dependencies and a DI graph to a problem that needs a
30-line cron loop and one HTTP call. AGENTS.md §2.1 (TS-only) and §3 (apps/api, apps/cli as
core; notifier is a separate app) permit this.

Data flow: `apps/collector` writes `data/collector.json` (per its existing
`CollatedJobsStore`). The notifier reads that file on each cycle, diffs against
`data/notified.json` (its own state), sends Telegram messages for the diff, and updates
`notified.json` only for sends that succeeded. This keeps the notifier read-only against
the collector's data, which avoids race conditions when both run as separate cron processes.

Libraries chosen:

- **`node-cron`** — schedule expressions, 2 KB, no native deps. Alternative: `cron` (older
  API), system cron (no in-process control). `node-cron` wins for in-process ergonomics.
- **`node-telegram-bot-api`** — typed wrapper around the Bot API, but we only need
  `sendMessage`; raw `fetch` is simpler and 0 deps. **Decision: use raw `fetch`**, drop
  the library.
- No SQLite, no better-sqlite3. A 10-line JSON file is enough for v1. Keeps install time
  and binary footprint small.

Cron schedule is overridable via `NOTIS_CRON` (default `*/30 * * * *`). Manual modes:
`--once` for one cycle, `--dry-run` to print without sending. Logging goes to stdout in a
single-line per-cycle format suitable for `journalctl` / Docker logs.

Test stack matches the rest of the repo: **Jest + ts-jest** (already configured in
`jest.config.js`). Unit tests live under `apps/notifier/__tests__/`. We stub `fetch` with
`jest.spyOn(global, 'fetch')`. No HTTP server in tests, no test DB.

## 2. Phases

### Phase 1 — MVP (1 day)

- Goal: end-to-end notifier that reads collector.json, sends Telegram, persists notified
  state, runs on a cron.
- Deliverables: `apps/notifier/` package with `package.json`, `tsconfig.json`, `src/`,
  `__tests__/`, `.env.example`, `README.md`. Wired into root `package.json` scripts
  (`notis`, `notis:once`, `notis:dry`).
- Exit criteria: `npm run notis:once` against a fixture collector.json sends the expected
  message to a real Telegram chat. `npm run notis:dry` prints the diff without sending.
  All unit tests pass.

### Phase 2 — Hardening (0.5 day)

- Goal: production-stable loop.
- Deliverables: SIGINT/SIGTERM handler, per-cycle summary log, throttling (1 msg/sec),
  error isolation per-job (failed sends don't break the cycle).
- Exit criteria: 100-cycle soak test with simulated 10% Telegram failure rate → no
  crashes, all successful sends persisted, no duplicates.

### Phase 3 — Operational (deferred)

- TTL on `notified.json` (drop entries older than N days to bound file size).
- Optional stale-data check: log a warning if `collector.json` last-modified > 1h.
- Optional `/status` Telegram command (requires a long-polling receiver; bigger change).

## 3. Packages Touched

| Location                | Change                                                |
| ----------------------- | ----------------------------------------------------- |
| `apps/notifier/`        | **New package** — plain TS, no NestJS                 |
| `package.json` (root)   | Add `notis`, `notis:once`, `notis:dry` scripts + workspace entry |
| `tsconfig.base.json`    | Add `@ever-jobs/notifier` path alias                  |
| `jest.config.js`        | Add `moduleNameMapper` entry                          |
| `docs/index.md`         | Reference new spec                                    |
| `docs/log.md`           | Append entry for spec creation                        |
| `docs/questions.md`     | (no new open questions; defaults are documented in spec §9) |
| `AGENTS.md`             | (no change)                                           |
| `apps/collector/`       | (no change — read-only consumer)                      |

## 4. Dependencies

| Library       | Version  | Rationale                                                   |
| ------------- | -------- | ----------------------------------------------------------- |
| `node-cron`   | latest   | Small, dep-free cron runner; widely used; matches Node 20+  |
| (no others)   |          | `fetch` is built-in; no Telegram SDK needed; no SQLite yet  |

Dev-only: `jest`, `ts-jest`, `typescript` — already in repo root devDependencies.

## 5. Risks & Mitigations

| Risk                                                  | Likelihood | Impact | Mitigation                              |
| ----------------------------------------------------- | ---------- | ------ | --------------------------------------- |
| Collector rewrites `collector.json` mid-cycle         | M          | L      | Read once, snapshot, don't hold the file open across sends |
| Telegram rate-limits (429)                            | M          | M      | Honor `retry_after`, exponential backoff (v2; v1 logs and skips) |
| `notified.json` grows unbounded                       | H          | L      | Documented in §10 Decision; revisit in Phase 3 |
| Cron drift: cycle overlaps itself on slow network     | L          | M      | Mutex file lock (`data/notifier.lock`) — cheap, prevents double-send |
| Both `notis` and `notis:once` run concurrently        | L          | M      | Same mutex lock                                          |
| Collector not running → stale `collector.json`        | M          | L      | Log last-modified timestamp; optional stale warning       |
| Telegram token leaked in logs                         | L          | H      | Never log env values; redact in error paths              |

## 6. Rollback Plan

- Stop the cron: `pkill -f "node.*notis"` (or remove the system-cron entry).
- Delete `apps/notifier/` and its root `package.json` entries.
- `notified.json` and `collector.json` are untouched; no data loss.
- No migration in either direction needed.

## 7. Migration Plan

None. v1 ships with no existing notifier to replace.

## 8. Open Questions for Plan

(none unresolved — see spec §9 for product-level questions, all with defaults)

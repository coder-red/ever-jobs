# Tasks: 701 — Job Notis Notifier (Telegram Delivery)

> Status legend: `[ ]` pending • `[~]` in-progress • `[x]` done • `[-]` dropped

## Phase 1 — MVP

- [x] T01 — Scaffold `apps/notifier/` package
  - **Files:** `apps/notifier/package.json`, `apps/notifier/tsconfig.json`,
    `apps/notifier/src/main.ts` (skeleton), `apps/notifier/.env.example`,
    `apps/notifier/README.md`
  - **Acceptance:** `npm ls @ever-jobs/notifier` resolves; `tsc --noEmit` passes on the
    skeleton; `package.json` declares `"type": "module"` (or matches repo CJS choice —
    check `tsconfig.base.json` first).
  - **Estimate:** 0.5 day

- [x] T02 — Implement `format.ts` (message template)
  - **Files:** `apps/notifier/src/format.ts`,
    `apps/notifier/__tests__/format.spec.ts`
  - **Acceptance:** Pure function `formatJob(job: CollatedJob): string`. Snapshot test
    covers 3 jobs (with/without company, with/without location, with `is_remote:1`).
    Output is HTML-safe (no unescaped `<` `>` `&`).
  - **Estimate:** 0.25 day

- [x] T03 — Implement `dedupe.ts` (notified-state diff)
  - **Files:** `apps/notifier/src/dedupe.ts`,
    `apps/notifier/__tests__/dedupe.spec.ts`
  - **Acceptance:** `loadNotified(path)` returns `Record<url, {notified_at}>`. `diff(jobs, notified)` returns new jobs. `markNotified(path, urls)` writes back atomically (tmp + rename). Tests cover empty, partial-overlap, all-new.
  - **Estimate:** 0.25 day

- [x] T04 — Implement `telegram.ts` (raw `fetch` send)
  - **Files:** `apps/notifier/src/telegram.ts`,
    `apps/notifier/__tests__/telegram.spec.ts`
  - **Acceptance:** `sendMessage(token, chatId, text)` calls `https://api.telegram.org/bot<token>/sendMessage` with `{chat_id, text, parse_mode:'HTML'}` and `disable_web_page_preview:false`. Throws on non-2xx or `{ok:false}`. Tests stub `global.fetch` and assert URL, body, headers.
  - **Estimate:** 0.25 day

- [x] T05 — Implement `notifier.ts` (orchestrator)
  - **Files:** `apps/notifier/src/notifier.ts`,
    `apps/notifier/__tests__/notifier.spec.ts`
  - **Acceptance:** `runOnce({dryRun})`: reads collector.json, diffs against notified.json,
    for each new job: formats + (sends or prints), then marks notified. Returns a summary
    `{total, new, sent, failed, errors[]}`. Throws `ERR_DATA_READ` if collector.json
    missing/unreadable. Throws `ERR_CONFIG_MISSING` if token/chatId missing. Tests cover:
    empty store (0 sent), 2-new (2 sent, persisted), 1-new-1-known (1 sent), telegram
    failure on job #2 (1 sent, 1 error logged, file not updated for the failed one).
  - **Estimate:** 0.5 day

- [x] T06 — Wire `main.ts` (entry + cron + one-shot + dry-run)
  - **Note:** `main().catch(...)` is now wrapped in `if (require.main === module)` so
    importing the module (e.g. from a test) does not start the cron scheduler.
  - **Note:** `readEnv` accepts an optional `envPath` arg (default
    `path.join(__dirname, '..', '.env')`) so tests can target a temp file.
  - **Files:** `apps/notifier/src/main.ts`
  - **Acceptance:** Reads `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NOTIS_DATA_PATH`
    (default `./data/collector.json`), `NOTIS_NOTIFIED_PATH` (default
    `./data/notified.json`), `NOTIS_CRON` (default `*/30 * * * *`). Refuses to start if
    token/chatId missing. `--once` runs one cycle and exits with code 0. `--dry-run`
    forces dry-run for one cycle. Default mode starts `node-cron` schedule. SIGINT/SIGTERM
    handler stops the cron cleanly.
  - **Estimate:** 0.5 day

- [x] T07 — Wire workspace + scripts
  - **Files:** `package.json` (root), `tsconfig.base.json`, `jest.config.js`
  - **Acceptance:** Add `"notis": "node apps/notifier/dist/main.js"`,
    `"notis:once": "... --once"`, `"notis:dry": "... --dry-run"`. Add path alias
    `@ever-jobs/notifier`. Add `moduleNameMapper` entry. `npm run notis:once --dry-run`
    from repo root works.
  - **Estimate:** 0.25 day

- [x] T08 — Documentation + index updates
  - **Files:** `apps/notifier/README.md`, `docs/index.md`, `docs/log.md`
  - **Acceptance:** README documents env vars, commands, expected output. `docs/index.md`
    lists the new spec under §7. `docs/log.md` has a new top entry: "2026-06-07 — Spec
    701 created, plan/tasks in progress".
  - **Estimate:** 0.25 day

## Phase 2 — Hardening

- [ ] T09 — Throttling + per-cycle summary + mutex
  - **Files:** `apps/notifier/src/notifier.ts`, `apps/notifier/src/lock.ts`
  - **Acceptance:** Insert 1100 ms sleep between sends (skipped in dry-run). Print
    `cycle=N total=N new=N sent=N failed=N` per cycle. Acquire `data/notifier.lock` (file
    with `wx` flag, removed in `finally`) before each cycle; release in `finally`. Refuse
    to run if lock held.
  - **Estimate:** 0.5 day

- [ ] T10 — Soak test (manual)
  - **Files:** none (runbook in PR description)
  - **Acceptance:** Run `npm run notis` for 100 cycles against a fixture collector.json
    with 10% simulated Telegram failure. All successful sends persisted, no duplicates,
    no crashes, lock files cleaned up.
  - **Estimate:** 0.25 day

## Notes

- Write tests alongside each implementation task; do not batch testing into a final task.
- Update `docs/log.md` with each completed task in the same commit.
- AGENTS.md §10 cross-check applies to every PR: spec exists, index updated, log
  appended, tests pass, no `console.log` outside dev scripts, no JS sources added, no
  plugin registered (this is an app, not a plugin).

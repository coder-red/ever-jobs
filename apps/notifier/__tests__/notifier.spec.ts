import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runOnce } from '../src/notifier';
import { CollectorStore } from '../src/types';

function tmpPath(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notis-run-')), name);
}

function writeStore(p: string, jobs: Array<{ url: string; title?: string }>): void {
  const store: CollectorStore = {
    next_id: jobs.length + 1,
    jobs: {},
    runs: [],
  };
  for (const j of jobs) {
    store.jobs[j.url] = {
      id: store.next_id++,
      job_url: j.url,
      title: j.title ?? 'Junior AI Engineer',
      company_name: 'Acme',
      site: 'remoteok',
      is_remote: 1,
      location: 'Remote',
      date_posted: '2026-06-07',
      first_seen_at: '2026-06-07T00:00:00.000Z',
      last_seen_at: '2026-06-07T00:00:00.000Z',
      payload_json: '{}',
    };
  }
  fs.writeFileSync(p, JSON.stringify(store, null, 2));
}

function baseOpts(overrides: Partial<Parameters<typeof runOnce>[0]> = {}): Parameters<typeof runOnce>[0] {
  return {
    dataPath: tmpPath('collector.json'),
    notifiedPath: tmpPath('notified.json'),
    token: 't',
    chatId: 'c',
    dryRun: true,
    intervalMs: 0,
    cycle: 1,
    ...overrides,
  };
}

describe('runOnce', () => {
  it('returns 0 new when store is empty', async () => {
    const opts = baseOpts();
    writeStore(opts.dataPath, []);
    const summary = await runOnce(opts);
    expect(summary).toMatchObject({ total: 0, new: 0, sent: 0, failed: 0 });
  });

  it('sends one message per new job in dry-run, does NOT persist notified state', async () => {
    const opts = baseOpts();
    writeStore(opts.dataPath, [
      { url: 'https://a.example/1' },
      { url: 'https://a.example/2' },
    ]);
    const summary = await runOnce(opts);
    expect(summary).toMatchObject({ total: 2, new: 2, sent: 2, failed: 0 });
    // Dry-run must not touch the notified file so a real run can still see them.
    expect(fs.existsSync(opts.notifiedPath)).toBe(false);
  });

  it('skips already-notified jobs on a second non-dryRun pass', async () => {
    const opts = baseOpts({ dryRun: false, intervalMs: 0 });
    writeStore(opts.dataPath, [
      { url: 'https://a.example/1' },
      { url: 'https://a.example/2' },
    ]);
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 1 } }),
    });
    const first = await runOnce({ ...opts, fetchImpl });
    expect(first).toMatchObject({ total: 2, new: 2, sent: 2, failed: 0 });
    const second = await runOnce({ ...opts, fetchImpl });
    expect(second).toMatchObject({ total: 2, new: 0, sent: 0, failed: 0 });
  });

  it('sends successfully when Telegram responds ok=true', async () => {
    const opts = baseOpts({ dryRun: false, intervalMs: 0 });
    writeStore(opts.dataPath, [{ url: 'https://a.example/1' }]);
    const fetchImpl = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, result: { message_id: 99 } }),
    });
    const summary = await runOnce({ ...opts, fetchImpl });
    expect(summary).toMatchObject({ total: 1, new: 1, sent: 1, failed: 0 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('isolates per-job failures: one bad, one good', async () => {
    const opts = baseOpts({ dryRun: false, intervalMs: 0 });
    writeStore(opts.dataPath, [
      { url: 'https://a.example/1' },
      { url: 'https://a.example/2' },
    ]);
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 1 } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'kaboom',
      });
    const summary = await runOnce({ ...opts, fetchImpl });
    expect(summary).toMatchObject({ total: 2, new: 2, sent: 1, failed: 1 });
    expect(summary.errors).toHaveLength(1);
    expect(summary.errors[0].jobUrl).toBe('https://a.example/2');
    // Only the successful one is persisted
    const notified = JSON.parse(fs.readFileSync(opts.notifiedPath, 'utf-8'));
    expect(Object.keys(notified)).toEqual(['https://a.example/1']);
  });
});

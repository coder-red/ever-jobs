import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  findNewJobs,
  loadCollectorStore,
  loadNotifiedStore,
  saveNotifiedStore,
  StoreError,
} from '../src/dedupe';
import { CollatedJob, CollectorStore } from '../src/types';

function tmpFile(name: string): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'notis-')), name);
}

function job(url: string): CollatedJob {
  return {
    id: 1,
    job_url: url,
    title: 'Junior AI Engineer',
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

describe('dedupe', () => {
  it('throws StoreError when collector file is missing', () => {
    const p = tmpFile('missing.json');
    expect(() => loadCollectorStore(p)).toThrow(StoreError);
  });

  it('throws StoreError when collector JSON is malformed', () => {
    const p = tmpFile('bad.json');
    fs.writeFileSync(p, 'not json');
    expect(() => loadCollectorStore(p)).toThrow(StoreError);
  });

  it('returns empty store when notified file is missing', () => {
    const p = tmpFile('absent.json');
    expect(loadNotifiedStore(p)).toEqual({});
  });

  it('returns empty store when notified JSON is malformed', () => {
    const p = tmpFile('bad-notified.json');
    fs.writeFileSync(p, '{not json');
    expect(loadNotifiedStore(p)).toEqual({});
  });

  it('findNewJobs returns only jobs whose url is not in notified', () => {
    const jobs: Record<string, CollatedJob> = {
      a: job('https://a'),
      b: job('https://b'),
      c: job('https://c'),
    };
    const notified = { 'https://b': { notified_at: '2026-06-07T00:00:00.000Z' } };
    const result = findNewJobs(jobs, notified).map((j) => j.job_url).sort();
    expect(result).toEqual(['https://a', 'https://c']);
  });

  it('saveNotifiedStore writes atomically (tmp + rename) and is readable back', () => {
    const p = tmpFile('notified.json');
    const store = { 'https://a': { notified_at: '2026-06-07T00:00:00.000Z' } };
    saveNotifiedStore(p, store);
    const loaded = loadNotifiedStore(p);
    expect(loaded).toEqual(store);
  });
});

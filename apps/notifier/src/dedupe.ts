import * as fs from 'fs';
import * as path from 'path';
import { CollatedJob, CollectorStore, NotifiedStore } from './types';

export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_DATA_READ';
  }
}

export function loadCollectorStore(dataPath: string): CollectorStore {
  if (!fs.existsSync(dataPath)) {
    throw new StoreError(`Collector data file not found at ${dataPath}. Run \`npm run collect\` first.`);
  }
  let raw: string;
  try {
    raw = fs.readFileSync(dataPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new StoreError(`Failed to read ${dataPath}: ${message}`);
  }
  try {
    const parsed = JSON.parse(raw) as CollectorStore;
    if (!parsed || typeof parsed !== 'object' || !parsed.jobs) {
      throw new StoreError(`Malformed collector data: missing "jobs" field`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof StoreError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new StoreError(`Failed to parse ${dataPath}: ${message}`);
  }
}

export function loadNotifiedStore(notifiedPath: string): NotifiedStore {
  if (!fs.existsSync(notifiedPath)) return {};
  try {
    const raw = fs.readFileSync(notifiedPath, 'utf-8');
    const parsed = JSON.parse(raw) as NotifiedStore;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveNotifiedStore(notifiedPath: string, store: NotifiedStore): void {
  const dir = path.dirname(notifiedPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${notifiedPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf-8');
  fs.renameSync(tmp, notifiedPath);
}

export function findNewJobs(jobs: Record<string, CollatedJob>, notified: NotifiedStore): CollatedJob[] {
  return Object.values(jobs).filter((j) => !notified[j.job_url]);
}

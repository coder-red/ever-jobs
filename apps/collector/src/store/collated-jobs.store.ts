import * as fs from 'fs';
import * as path from 'path';
import { JobPostDto } from '@ever-jobs/models';
import { normalizeJobUrl } from '../filters/persona.filter';

export interface CollatedJobRow {
  id: number;
  job_url: string;
  title: string;
  company_name: string | null;
  site: string | null;
  is_remote: number | null;
  location: string | null;
  date_posted: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload_json: string;
}

export interface UpsertResult {
  inserted: number;
  updated: number;
}

export interface CollectRunRecord {
  batch_name: string;
  fetched: number;
  matched: number;
  inserted: number;
  updated: number;
  error?: string;
}

interface StoredJob {
  id: number;
  job_url: string;
  title: string;
  company_name: string | null;
  site: string | null;
  is_remote: number | null;
  location: string | null;
  date_posted: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload_json: string;
}

interface StoreFile {
  next_id: number;
  jobs: Record<string, StoredJob>;
  runs: Array<CollectRunRecord & { started_at: string; finished_at: string }>;
}

function formatLocation(job: JobPostDto): string | null {
  const loc = job.location;
  if (!loc) return null;
  const text = [loc.city, loc.state, loc.country].filter(Boolean).join(', ');
  return text || null;
}

function emptyStore(): StoreFile {
  return { next_id: 1, jobs: {}, runs: [] };
}

export class CollatedJobsStore {
  private readonly filePath: string;
  private data: StoreFile;

  constructor(dbPath: string) {
    this.filePath = dbPath.endsWith('.json')
      ? dbPath
      : `${dbPath.replace(/\.sqlite$/i, '')}.json`;

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.data = fs.existsSync(this.filePath)
      ? (JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as StoreFile)
      : emptyStore();
  }

  private persist(): void {
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
    fs.renameSync(tmp, this.filePath);
  }

  upsertJobs(jobs: JobPostDto[], now = new Date()): UpsertResult {
    const iso = now.toISOString();
    let inserted = 0;
    let updated = 0;

    for (const job of jobs) {
      const jobUrl = normalizeJobUrl(job.jobUrl);
      const existing = this.data.jobs[jobUrl];

      const row: StoredJob = {
        id: existing?.id ?? this.data.next_id++,
        job_url: jobUrl,
        title: job.title,
        company_name: job.companyName ?? null,
        site: job.site ?? null,
        is_remote: job.isRemote ? 1 : 0,
        location: formatLocation(job),
        date_posted: job.datePosted ? String(job.datePosted) : null,
        first_seen_at: existing?.first_seen_at ?? iso,
        last_seen_at: iso,
        payload_json: JSON.stringify(job),
      };

      this.data.jobs[jobUrl] = row;
      if (existing) updated += 1;
      else inserted += 1;
    }

    this.persist();
    return { inserted, updated };
  }

  recordRun(startedAt: Date, record: CollectRunRecord): void {
    this.data.runs.push({
      ...record,
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
    });
    this.persist();
  }

  listJobs(limit = 50): CollatedJobRow[] {
    return Object.values(this.data.jobs)
      .sort((a, b) => b.last_seen_at.localeCompare(a.last_seen_at))
      .slice(0, limit);
  }

  listAllJobs(): CollatedJobRow[] {
    return Object.values(this.data.jobs).sort((a, b) =>
      b.last_seen_at.localeCompare(a.last_seen_at),
    );
  }

  listRuns(limit = 20): Array<CollectRunRecord & { started_at: string; finished_at: string }> {
    return [...this.data.runs]
      .sort((a, b) => b.started_at.localeCompare(a.started_at))
      .slice(0, limit);
  }

  getFilePath(): string {
    return this.filePath;
  }

  countJobs(): number {
    return Object.keys(this.data.jobs).length;
  }

  close(): void {
    // no-op for file store
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JobPostDto, ScraperInputDto } from '@ever-jobs/models';
import { EverJobsClient } from './client/ever-jobs.client';
import {
  DEFAULT_SEARCH_TERM,
  SOURCE_BATCHES,
  SourceBatch,
} from './config/batches';
import { matchesAiMlRemoteRole } from './filters/persona.filter';
import { LlmRankerService } from './rankers/llm-ranker.service';
import { CollatedJobsStore, CollatedJobRow } from './store/collated-jobs.store';

function isWithinHoursOld(datePosted: string | undefined | null, hoursOld: number): boolean {
  if (!datePosted) return false;
  const posted = new Date(datePosted).getTime();
  if (isNaN(posted)) return false;
  return Date.now() - posted <= hoursOld * 60 * 60 * 1000;
}

export interface CollectSummary {
  batches: Array<{
    name: string;
    fetched: number;
    matched: number;
    inserted: number;
    updated: number;
    error?: string;
  }>;
  totalMatched: number;
  totalInserted: number;
  totalUpdated: number;
  storeTotal: number;
}

@Injectable()
export class CollectorService {
  private readonly logger = new Logger(CollectorService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly llmRanker: LlmRankerService,
  ) {}

  async collect(options?: {
    batch?: string;
    dryRun?: boolean;
  }): Promise<CollectSummary> {
    const baseUrl = this.config.get<string>(
      'COLLECTOR_EVER_JOBS_URL',
      'http://localhost:3001',
    );
    const apiKey = this.config.get<string>('COLLECTOR_EVER_JOBS_API_KEY');
    const dbPath = this.config.get<string>(
      'COLLECTOR_DB_PATH',
      './data/collector.json',
    );
    const searchTerm = this.config.get<string>(
      'COLLECTOR_SEARCH_TERM',
      DEFAULT_SEARCH_TERM,
    );
    const hoursOld = Number(this.config.get('COLLECTOR_HOURS_OLD', 72));
    const resultsWanted = Number(this.config.get('COLLECTOR_RESULTS_WANTED', 100));
    const allowHybrid =
      this.config.get<string>('COLLECTOR_ALLOW_HYBRID', 'false') === 'true';

    const client = new EverJobsClient({
      baseUrl,
      apiKey,
      timeoutMs: this.config.get<number>('COLLECTOR_TIMEOUT_MS', 180_000),
    });

    const healthy = await client.healthCheck();
    if (!healthy) {
      throw new Error(
        `Ever Jobs API not reachable at ${baseUrl}. Start it with: npm run start:dev`,
      );
    }

    const batches = this.resolveBatches(options?.batch);
    const store = options?.dryRun ? null : new CollatedJobsStore(dbPath);
    const summary: CollectSummary = {
      batches: [],
      totalMatched: 0,
      totalInserted: 0,
      totalUpdated: 0,
      storeTotal: store?.countJobs() ?? 0,
    };

    try {
      for (const batch of batches) {
        const startedAt = new Date();
        let fetched = 0;
        let matched = 0;
        let inserted = 0;
        let updated = 0;
        let error: string | undefined;

        try {
          this.logger.log(`Batch "${batch.name}" — ${batch.sites.length} sources`);

          // Nigerian boards: fetch on-site + remote (user wants EVERY local
          // AI/ML role). International boards stay remote-only to cut noise.
          const isNigeriaBatch = batch.name === 'ng-job-boards';
          const input = new ScraperInputDto({
            siteType: batch.sites,
            searchTerm,
            isRemote: isNigeriaBatch ? false : true,
            hoursOld,
            resultsWanted,
          });

          const response = await client.search(input);
          const allJobs = response.jobs ?? [];
          fetched = allJobs.length;

          const rejectSamples: string[] = [];
          const matchedJobs = allJobs.filter((job: JobPostDto) => {
            const dateStr = job.datePosted instanceof Date ? job.datePosted.toISOString() : job.datePosted;
            if (!isWithinHoursOld(dateStr, hoursOld)) return false;
            if (matchesAiMlRemoteRole(job, { allowHybrid })) return true;
            if (rejectSamples.length < 5) {
              rejectSamples.push(`${job.title} @ ${job.companyName ?? job.site ?? '?'}`);
            }
            return false;
          });
          matched = matchedJobs.length;
          if (rejectSamples.length > 0) {
            this.logger.warn(
              `Rejected (first ${rejectSamples.length}): ${rejectSamples.join(' | ')}`,
            );
          }

          const rankedJobs: JobPostDto[] = [];
          for (const job of matchedJobs) {
            try {
              const result = await this.llmRanker.rank(job.title, job.description);
              (job as any).llmScore = result.score;
              (job as any).llmReason = result.reason;
              (job as any).llmSource = result.source;
              if (result.zeroExpFriendly !== undefined) {
                (job as any).zeroExpFriendly = result.zeroExpFriendly;
              }
              if (result.experienceRequired !== undefined) {
                (job as any).experienceRequired = result.experienceRequired;
              }
            } catch {
              (job as any).llmScore = 60;
              (job as any).llmReason = 'ranking failed';
              (job as any).llmSource = 'error';
            }
            rankedJobs.push(job);
          }

          if (!options?.dryRun && store && rankedJobs.length > 0) {
            const result = store.upsertJobs(rankedJobs);
            inserted = result.inserted;
            updated = result.updated;
          }

          this.logger.log(
            `Batch "${batch.name}": fetched=${fetched} matched=${matched} new=${inserted} updated=${updated}`,
          );
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
          this.logger.warn(`Batch "${batch.name}" failed: ${error}`);
        }

        summary.batches.push({
          name: batch.name,
          fetched,
          matched,
          inserted,
          updated,
          error,
        });
        summary.totalMatched += matched;
        summary.totalInserted += inserted;
        summary.totalUpdated += updated;

        if (store) {
          store.recordRun(startedAt, {
            batch_name: batch.name,
            fetched,
            matched,
            inserted,
            updated,
            error,
          });
        }
      }

      summary.storeTotal = store?.countJobs() ?? summary.storeTotal;
      return summary;
    } finally {
      store?.close();
    }
  }

  listJobs(limit = 50): JobPostDto[] {
    const dbPath = this.config.get<string>(
      'COLLECTOR_DB_PATH',
      './data/collector.json',
    );
    const store = new CollatedJobsStore(dbPath);
    try {
      return store.listJobs(limit).map((row: CollatedJobRow) => JSON.parse(row.payload_json) as JobPostDto);
    } finally {
      store.close();
    }
  }

  getDashboardData() {
    const dbPath = this.config.get<string>(
      'COLLECTOR_DB_PATH',
      './data/collector.json',
    );
    const store = new CollatedJobsStore(dbPath);
    try {
      const jobs = store.listAllJobs();
      const runs = store.listRuns(10);
      return {
        total: store.countJobs(),
        storePath: store.getFilePath(),
        jobs: jobs.map((row) => ({
          id: row.id,
          title: row.title,
          company: row.company_name,
          site: row.site,
          location: row.location,
          isRemote: row.is_remote === 1,
          jobUrl: row.job_url,
          datePosted: row.date_posted,
          firstSeenAt: row.first_seen_at,
          lastSeenAt: row.last_seen_at,
        })),
        runs: runs.map((run) => ({
          batch: run.batch_name,
          fetched: run.fetched,
          matched: run.matched,
          inserted: run.inserted,
          updated: run.updated,
          error: run.error ?? null,
          startedAt: run.started_at,
          finishedAt: run.finished_at,
        })),
      };
    } finally {
      store.close();
    }
  }

  getStorePath(): string {
    return this.config.get<string>('COLLECTOR_DB_PATH', './data/collector.json');
  }

  private resolveBatches(batchName?: string): SourceBatch[] {
    if (!batchName) return [...SOURCE_BATCHES];
    const batch = SOURCE_BATCHES.find((b: SourceBatch) => b.name === batchName);
    if (!batch) {
      const names = SOURCE_BATCHES.map((b: SourceBatch) => b.name).join(', ');
      throw new Error(`Unknown batch "${batchName}". Available: ${names}`);
    }
    return [batch];
  }
}

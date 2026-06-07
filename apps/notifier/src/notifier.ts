import {
  findNewJobs,
  loadCollectorStore,
  loadNotifiedStore,
  saveNotifiedStore,
  StoreError,
} from './dedupe';
import { formatJob } from './format';
import { sendMessage, sleep, TelegramError } from './telegram';
import { NotifierSummary, RunOnceOptions } from './types';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_CONFIG_MISSING';
  }
}

export function validateConfig(opts: Partial<RunOnceOptions>): asserts opts is RunOnceOptions {
  if (!opts.token) throw new ConfigError('TELEGRAM_BOT_TOKEN is not set');
  if (!opts.chatId) throw new ConfigError('TELEGRAM_CHAT_ID is not set');
  if (!opts.dataPath) throw new ConfigError('NOTIS_DATA_PATH is not set');
  if (!opts.notifiedPath) throw new ConfigError('NOTIS_NOTIFIED_PATH is not set');
}

export async function runOnce(opts: RunOnceOptions): Promise<NotifierSummary> {
  validateConfig(opts);

  const store = loadCollectorStore(opts.dataPath);
  const notified = loadNotifiedStore(opts.notifiedPath);
  const newJobs = findNewJobs(store.jobs, notified);

  const errors: NotifierSummary['errors'] = [];
  let sent = 0;
  let failed = 0;

  for (const job of newJobs) {
    const text = formatJob(job);
    if (opts.dryRun) {
      console.log(`[notis] → ${text.replace(/\n/g, ' | ')}`);
      sent += 1;
      notified[job.job_url] = { notified_at: new Date().toISOString() };
      continue;
    }
    try {
      await sendMessage({
        token: opts.token,
        chatId: opts.chatId,
        text,
        fetchImpl: opts.fetchImpl,
      });
      notified[job.job_url] = { notified_at: new Date().toISOString() };
      sent += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ jobUrl: job.job_url, message });
      if (err instanceof TelegramError) {
        console.warn(`[notis] send failed for ${job.job_url}: ${message}`);
      } else {
        throw err;
      }
    }
    if (opts.intervalMs > 0) await sleep(opts.intervalMs);
  }

  if (!opts.dryRun) {
    saveNotifiedStore(opts.notifiedPath, notified);
  }

  return {
    cycle: opts.cycle,
    total: Object.keys(store.jobs).length,
    new: newJobs.length,
    sent,
    failed,
    notifiedStoreSize: Object.keys(notified).length,
    errors,
  };
}

export { StoreError, TelegramError };

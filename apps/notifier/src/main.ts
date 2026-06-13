import * as cron from 'node-cron';
import * as path from 'path';
import * as fs from 'fs';
import { setGlobalDispatcher, ProxyAgent } from 'undici';
import { runOnce, ConfigError } from './notifier';
import { RunOnceOptions } from './types';

const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '';
if (proxyUrl && proxyUrl.trim()) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl.trim()));
}

const LOCK_PATH = path.join(process.cwd(), 'data/notifier.lock');

function acquireLock(): boolean {
  try {
    const fd = fs.openSync(LOCK_PATH, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch {
    // already gone
  }
}

export function readEnv(envPath: string = path.join(__dirname, '..', '.env')): { token?: string; chatId?: string; dataPath: string; notifiedPath: string; cron: string; intervalMs: number } {
  if (fs.existsSync(envPath)) {
    for (const raw of fs.readFileSync(envPath, 'utf-8').split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim();
      if (!line) continue;
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && process.env[m[1]] === undefined) {
        let value = m[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[m[1]] = value;
      }
    }
  }
  return {
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: process.env.TELEGRAM_CHAT_ID,
    dataPath: process.env.NOTIS_DATA_PATH ?? './data/collector.json',
    notifiedPath: process.env.NOTIS_NOTIFIED_PATH ?? './data/notified.json',
    cron: process.env.NOTIS_CRON ?? '*/30 * * * *',
    intervalMs: Number(process.env.NOTIS_INTERVAL_MS ?? 1100),
  };
}

function makeOptions(env: ReturnType<typeof readEnv>, cycle: number, dryRun: boolean): RunOnceOptions {
  return {
    token: env.token ?? '',
    chatId: env.chatId ?? '',
    dataPath: env.dataPath,
    notifiedPath: env.notifiedPath,
    intervalMs: env.intervalMs,
    cycle,
    dryRun,
  };
}

async function tickCycle(env: ReturnType<typeof readEnv>, cycle: number, dryRun: boolean): Promise<void> {
  if (!acquireLock()) {
    console.warn(`[notis] cycle=${cycle} skipped — another notifier holds the lock at ${LOCK_PATH}`);
    return;
  }
  try {
    const summary = await runOnce(makeOptions(env, cycle, dryRun));
    console.log(
      `[notis] cycle=${summary.cycle} total=${summary.total} new=${summary.new} sent=${summary.sent} failed=${summary.failed} notified_store=${summary.notifiedStoreSize}`,
    );
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(`[notis] config error: ${err.message}`);
      console.error('[notis] set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in apps/notifier/.env');
      process.exit(2);
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[notis] cycle=${cycle} error: ${message}`);
  } finally {
    releaseLock();
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const dryRun = args.includes('--dry-run');

  const env = readEnv();

  if (once || dryRun) {
    await tickCycle(env, 1, dryRun);
    return;
  }

  if (!env.cron || !cron.validate(env.cron)) {
    console.error(`[notis] invalid cron expression: ${env.cron}`);
    process.exit(2);
  }

  console.log(`[notis] starting scheduler: "${env.cron}", data=${env.dataPath}, notified=${env.notifiedPath}`);

  let cycle = 0;
  let running = false;
  const task = cron.schedule(env.cron, async () => {
    if (running) {
      console.warn('[notis] previous cycle still running; skipping overlap');
      return;
    }
    running = true;
    cycle += 1;
    try {
      await tickCycle(env, cycle, false);
    } finally {
      running = false;
    }
  });

  const stop = (): void => {
    console.log('[notis] stopping...');
    task.stop();
    releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('[notis] fatal:', err);
    process.exit(1);
  });
}

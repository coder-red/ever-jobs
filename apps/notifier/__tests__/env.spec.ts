import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readEnv } from '../src/main';

function tmpEnv(content: string): { envPath: string; cleanup: () => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notis-env-'));
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(envPath, content);
  return { envPath, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function clearProcessEnv(keys: string[]): void {
  for (const k of keys) delete process.env[k];
}

describe('readEnv', () => {
  const KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'NOTIS_DATA_PATH', 'NOTIS_NOTIFIED_PATH', 'NOTIS_CRON', 'NOTIS_INTERVAL_MS'];
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      snapshot[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it('parses plain KEY=value pairs', () => {
    const { envPath, cleanup } = tmpEnv('TELEGRAM_BOT_TOKEN=abc:def\nTELEGRAM_CHAT_ID=42\n');
    try {
      const env = readEnv(envPath);
      expect(env.token).toBe('abc:def');
      expect(env.chatId).toBe('42');
    } finally {
      cleanup();
    }
  });

  it('strips trailing # comments from values', () => {
    const { envPath, cleanup } = tmpEnv('TELEGRAM_BOT_TOKEN=tok # comment\nTELEGRAM_CHAT_ID=99 # chat id\n');
    try {
      const env = readEnv(envPath);
      expect(env.token).toBe('tok');
      expect(env.chatId).toBe('99');
    } finally {
      cleanup();
    }
  });

  it('strips surrounding double and single quotes', () => {
    const { envPath, cleanup } = tmpEnv('TELEGRAM_BOT_TOKEN="abc:def"\nTELEGRAM_CHAT_ID=\'42\'\n');
    try {
      const env = readEnv(envPath);
      expect(env.token).toBe('abc:def');
      expect(env.chatId).toBe('42');
    } finally {
      cleanup();
    }
  });

  it('skips blank lines and full-line comments', () => {
    const { envPath, cleanup } = tmpEnv('\n# leading comment\nTELEGRAM_BOT_TOKEN=tok\n  \n# trailing comment\n');
    try {
      const env = readEnv(envPath);
      expect(env.token).toBe('tok');
    } finally {
      cleanup();
    }
  });

  it('uses defaults when env file is missing', () => {
    clearProcessEnv(KEYS);
    const env = readEnv(path.join(os.tmpdir(), 'definitely-does-not-exist-' + Date.now(), '.env'));
    expect(env.dataPath).toBe('./data/collector.json');
    expect(env.notifiedPath).toBe('./data/notified.json');
    expect(env.cron).toBe('*/30 * * * *');
    expect(env.intervalMs).toBe(1100);
    expect(env.token).toBeUndefined();
    expect(env.chatId).toBeUndefined();
  });

  it('prefers real process.env over .env file values', () => {
    process.env.TELEGRAM_BOT_TOKEN = 'override';
    const { envPath, cleanup } = tmpEnv('TELEGRAM_BOT_TOKEN=from-file\n');
    try {
      const env = readEnv(envPath);
      expect(env.token).toBe('override');
    } finally {
      cleanup();
    }
  });
});

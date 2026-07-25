/** Dedupe store + .env reader. Plain JSON on disk — no database, no daemon. */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * Parse a KEY=VALUE .env file.
 *
 * Handles INLINE comments — ever-jobs/.env stores them as
 *   TELEGRAM_BOT_TOKEN=123456:AA...    # Bot token. From @BotFather
 * and swallowing the comment into the value produces a 111-character token
 * that Telegram answers with 404. Quoted values keep their `#` verbatim.
 */
export function readEnv(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (/^\s*#/.test(line)) continue;
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    let value = m[2].trim();
    const quoted = value.match(/^(["'])([\s\S]*?)\1/);
    if (quoted) {
      value = quoted[2];
    } else {
      value = value.replace(/\s+#.*$/, '').trim(); // strip trailing comment
    }
    out[m[1]] = value;
  }
  return out;
}

/** Canonical URL — strips tracking params so the same job dedupes across runs. */
export function canonical(url) {
  try {
    const u = new URL(String(url).trim());
    u.hash = '';
    for (const k of [...u.searchParams.keys()]) {
      if (/^utm_|^ref$|^source$|^gh_src$|^lever-source/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    return u.toString().replace(/\/$/, '');
  } catch {
    return String(url).trim().toLowerCase();
  }
}

export function loadSeen(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return {};
  }
}

export function saveSeen(path, seen) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(seen, null, 2), 'utf8');
}

/**
 * Seed the store from the old pipeline's notified.json so jobs already pushed
 * to Telegram are never re-sent. One-time, idempotent.
 */
export function seedFromLegacy(seen, legacyPath) {
  if (!existsSync(legacyPath)) return 0;
  let added = 0;
  try {
    const legacy = JSON.parse(readFileSync(legacyPath, 'utf8'));
    for (const url of Object.keys(legacy)) {
      const key = canonical(url);
      if (!seen[key]) {
        seen[key] = { notifiedAt: legacy[url]?.notified_at ?? null, legacy: true };
        added++;
      }
    }
  } catch { /* corrupt legacy file is not fatal */ }
  return added;
}

export function pathFrom(base, ...parts) {
  return resolve(base, ...parts);
}

/**
 * Source health — the alarm the old pipeline never had.
 *
 * ever-jobs ran for five weeks with `ng-job-boards fetched: 0` on every single
 * run and nothing said a word. Scrapers don't fail loudly; sites get redesigned
 * and a parser quietly returns an empty array forever.
 *
 * This tracks each source's yield over time and flags a source that USED to
 * return postings and now returns none. A source that has always returned zero
 * is not an alarm — it's just empty today.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const KEEP = 30; // runs of history per source

export function load(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

export function save(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Record this run's yields and return anything that looks broken.
 *
 * @param {object} state   previous history (mutated)
 * @param {object} stats   { sourceName: count } from this run
 * @returns {{broken: Array, recovered: Array, state: object}}
 */
export function record(state, stats) {
  const now = new Date().toISOString();
  const broken = [];
  const recovered = [];

  for (const [name, count] of Object.entries(stats)) {
    const rec = state[name] ?? (state[name] = { history: [], everProduced: false, alerted: false });
    rec.history.push({ at: now, count });
    if (rec.history.length > KEEP) rec.history = rec.history.slice(-KEEP);
    if (count > 0) rec.everProduced = true;
    rec.last = count;
    rec.lastAt = now;

    // The two most recent runs. Slicing 3 meant [70, 0, 0] failed "all zero"
    // and a genuinely broken source stayed silent for an extra run.
    const recent = rec.history.slice(-2);
    const allZero = recent.length >= 2 && recent.every((h) => h.count === 0);
    const best = Math.max(0, ...rec.history.map((h) => h.count));

    if (rec.everProduced && allZero) {
      // Was working, now silent across consecutive runs.
      if (!rec.alerted) { broken.push({ name, best, runs: recent.length }); rec.alerted = true; }
    } else if (count > 0 && rec.alerted) {
      recovered.push({ name, count });
      rec.alerted = false;
    }
  }
  return { broken, recovered, state };
}

/** Sources that have never produced anything — dead weight, not a fault. */
export function neverProduced(state) {
  return Object.entries(state)
    .filter(([, r]) => !r.everProduced && r.history.length >= 3)
    .map(([name]) => name);
}

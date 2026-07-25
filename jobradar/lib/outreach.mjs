/**
 * Outreach pipeline state — which agencies you've cold-DM'd, skipped, or not
 * touched yet. Kept separate from `seen.json` (which only stops re-sending)
 * because this is a workflow you act on, not a dedupe log.
 *
 * data/outreach.json:
 *   { "<id>": { key, name, status, score, postings, aiPostings, inNigeria,
 *               emails, linkedin, firstSeen, updatedAt, note } }
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export const STATUS = { NEW: 'new', DMD: 'dmd', SKIPPED: 'skipped', REPLIED: 'replied' };

/**
 * Telegram caps callback_data at 64 bytes, so agencies are addressed by a short
 * stable id rather than their full name.
 */
export function shortId(key) {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 8);
}

export function load(path) {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return {}; }
}

export function save(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * Merge freshly-scored agencies into the pipeline without clobbering status.
 * Re-scoring updates the numbers; your decision on a firm is never overwritten.
 * @returns {{added: string[], state: object}}
 */
export function upsert(state, agencies) {
  const now = new Date().toISOString();
  const added = [];
  for (const a of agencies) {
    const id = shortId(a.key);
    const prev = state[id];
    if (!prev) {
      added.push(id);
      state[id] = {
        id, key: a.key, name: a.name, status: STATUS.NEW,
        score: a.score, postings: a.postings, aiPostings: a.aiPostings,
        inNigeria: a.inNigeria, emails: a.emails ?? [], linkedin: a.linkedin,
        locations: a.locations ?? [], titles: (a.titles ?? []).slice(0, 3),
        reasons: (a.reasons ?? []).slice(0, 3),
        firstSeen: now, updatedAt: now, note: '',
      };
    } else {
      // Refresh the live numbers; leave status and note alone.
      Object.assign(prev, {
        score: a.score, postings: a.postings, aiPostings: a.aiPostings,
        emails: a.emails?.length ? a.emails : prev.emails,
        locations: a.locations ?? prev.locations,
        titles: (a.titles ?? []).slice(0, 3),
        reasons: (a.reasons ?? []).slice(0, 3),
        updatedAt: now,
      });
    }
  }
  return { added, state };
}

export function setStatus(state, id, status, note) {
  const rec = state[id];
  if (!rec) return null;
  rec.status = status;
  rec.updatedAt = new Date().toISOString();
  if (note !== undefined) rec.note = note;
  return rec;
}

export function list(state, { status = null, sort = 'score' } = {}) {
  let rows = Object.values(state);
  if (status) rows = rows.filter((r) => r.status === status);
  if (sort === 'score') rows.sort((a, b) => b.score - a.score);
  else if (sort === 'recent') rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  return rows;
}

export function counts(state) {
  const out = { total: 0, new: 0, dmd: 0, skipped: 0, replied: 0, ng: 0, withEmail: 0 };
  for (const r of Object.values(state)) {
    out.total++;
    out[r.status] = (out[r.status] ?? 0) + 1;
    if (r.inNigeria) out.ng++;
    if (r.emails?.length) out.withEmail++;
  }
  return out;
}

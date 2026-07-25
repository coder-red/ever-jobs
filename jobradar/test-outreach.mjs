#!/usr/bin/env node
/** Outreach pipeline state machine — what the Telegram buttons drive. */
import * as O from './lib/outreach.mjs';

let pass = 0;
const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) pass++; else fails.push(`  ✗ ${name}${extra ? `\n      ${extra}` : ''}`);
};

const ag = (key, over = {}) => ({
  key, name: key, score: 60, postings: 5, aiPostings: 0, inNigeria: false,
  emails: [], linkedin: `https://li/${key}`, locations: [], titles: [], reasons: [], ...over,
});

// --- ids are stable and short enough for Telegram's 64-byte callback_data ---
check('shortId stable', O.shortId('toptal') === O.shortId('toptal'));
check('shortId distinct', O.shortId('toptal') !== O.shortId('andela'));
check('shortId fits callback_data', `d:${O.shortId('a'.repeat(200))}`.length <= 64);

// --- upsert -----------------------------------------------------------------
let st = {};
let r = O.upsert(st, [ag('toptal'), ag('andela')]);
check('upsert adds both', r.added.length === 2 && Object.keys(st).length === 2);

r = O.upsert(st, [ag('toptal'), ag('andela')]);
check('upsert is idempotent', r.added.length === 0 && Object.keys(st).length === 2);

// --- status transitions -----------------------------------------------------
const tid = O.shortId('toptal');
O.setStatus(st, tid, O.STATUS.DMD);
check('mark DMd', st[tid].status === 'dmd');
check('new count drops', O.counts(st).new === 1);
check('dmd count rises', O.counts(st).dmd === 1);

// The critical one: a rescan must never undo a decision you made in Telegram.
O.upsert(st, [ag('toptal', { score: 99, postings: 40 })]);
check('rescan preserves status', st[tid].status === 'dmd',
  `got "${st[tid].status}" — a rescan wiped the user's action`);
check('rescan refreshes numbers', st[tid].score === 99 && st[tid].postings === 40);

// Undo returns it to the queue.
O.setStatus(st, tid, O.STATUS.NEW);
check('undo restores to queue', st[tid].status === 'new' && O.counts(st).new === 2);

// Notes survive.
O.setStatus(st, tid, O.STATUS.DMD, 'sent via LinkedIn');
check('note stored', st[tid].note === 'sent via LinkedIn');
O.upsert(st, [ag('toptal')]);
check('rescan preserves note', st[tid].note === 'sent via LinkedIn');

// --- listing ----------------------------------------------------------------
O.upsert(st, [ag('lemon', { score: 82 }), ag('alan', { score: 76, inNigeria: true })]);
const queue = O.list(st, { status: O.STATUS.NEW });
check('list filters by status', queue.every((x) => x.status === 'new'));
check('list sorts by score desc', queue[0].score >= queue[queue.length - 1].score,
  queue.map((x) => `${x.name}:${x.score}`).join(' '));
check('counts track NG', O.counts(st).ng === 1);

// --- unknown id is handled, not thrown --------------------------------------
check('unknown id returns null', O.setStatus(st, 'nope', O.STATUS.DMD) === null);

const total = pass + fails.length;
console.log(`\n${pass}/${total} passed`);
if (fails.length) { console.log('\nFAILURES:'); console.log(fails.join('\n')); process.exit(1); }
console.log('all green\n');

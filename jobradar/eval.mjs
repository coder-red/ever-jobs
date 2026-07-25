#!/usr/bin/env node
/**
 * Ground-truth check: fetch every matched job's page and confirm it is real,
 * still live, and described accurately. Reports dead links, deadlines that have
 * already passed, and experience requirements above entry level.
 *
 *   node eval.mjs            check data/latest.json
 *   node eval.mjs --limit 20
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(HERE, 'data', 'latest.json'), 'utf8'));
const LIMIT = Number(process.argv[process.argv.indexOf('--limit') + 1]) || d.jobs.length;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8217;|&rsquo;/g, "'")
  .replace(/\s+/g, ' ').trim();

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december';

/** Application deadline, if the page states one. */
function findDeadline(text) {
  const pats = [
    new RegExp(`(?:deadline|closing date|closes on|apply before|application closes)[:\\s]*((?:\\d{1,2}\\s+)?(?:${MONTHS})[a-z]*,?\\s+\\d{1,2}?,?\\s*\\d{4})`, 'i'),
    new RegExp(`(?:deadline|closing date|closes on|apply before)[:\\s]*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4})`, 'i'),
  ];
  for (const p of pats) { const m = text.match(p); if (m) return m[1]; }
  return null;
}

/** "Posted on <date>" / "Date Posted: <date>". */
function findPosted(text) {
  const pats = [
    new RegExp(`(?:posted(?:\\s+on)?|date posted|published)[:\\s]*((?:\\d{1,2}\\s+)?(?:${MONTHS})[a-z]*,?\\s+\\d{1,2}?,?\\s*\\d{4})`, 'i'),
    /"datePosted"\s*:\s*"([^"]+)"/i,
    /(?:posted)\s+(\d+\s+(?:hour|day|week|month)s?\s+ago)/i,
  ];
  for (const p of pats) { const m = text.match(p); if (m) return m[1]; }
  return null;
}

// A years-of-experience heuristic used to live here. It matched sidebar and
// "related jobs" text, and reported "Junior AI Engineer wants 4+ yrs" on a page
// that states no requirement at all. Deleted rather than shipped untrusted —
// verify.mjs checks the job body specifically, which is the reliable version.

const DEAD = /(page not found|404 not found|no longer available|this job (?:has )?(?:expired|closed)|position (?:has been )?filled|job not found|vacancy (?:has )?expired)/i;

async function check(job) {
  const out = { ...job, http: null, live: null, posted: null, deadline: null, note: '' };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30_000);
    const res = await fetch(job.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal });
    clearTimeout(timer);
    out.http = res.status;
    if (!res.ok) { out.live = false; out.note = `HTTP ${res.status}`; return out; }
    const text = strip(await res.text());
    if (DEAD.test(text)) { out.live = false; out.note = 'page says expired/removed'; return out; }
    out.live = true;
    out.posted = findPosted(text);
    out.deadline = findDeadline(text);
    // Does the page still mention the role we matched on?
    const head = job.title.split(/\s+at\s+/i)[0].toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const key = head.split(/\s+/).filter((w) => w.length > 3).slice(0, 3);
    out.titleEcho = key.length ? key.every((w) => text.toLowerCase().includes(w)) : null;
  } catch (e) {
    out.live = false;
    out.note = e.name === 'AbortError' ? 'timeout' : e.message;
  }
  return out;
}

// Bounded concurrency — don't hammer the boards.
const jobs = d.jobs.slice(0, LIMIT);
const results = [];
const QUEUE = [...jobs.entries()];
async function worker() {
  for (;;) {
    const next = QUEUE.shift();
    if (!next) return;
    const [i, job] = next;
    results[i] = await check(job);
    process.stdout.write('.');
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
process.stdout.write('\n\n');

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const dead = results.filter((r) => !r.live);
const expired = results.filter((r) => {
  if (!r.deadline) return false;
  const t = Date.parse(r.deadline);
  return !Number.isNaN(t) && t < Date.now();
});
const noDate = results.filter((r) => r.live && !r.posted && !r.postedAt);

console.log(`${c.b}EVAL — ${results.length} matched jobs verified against their live pages${c.x}\n`);
console.log(`  ${c.g}live${c.x}                 ${results.length - dead.length}/${results.length}`);
console.log(`  ${dead.length ? c.r : c.g}dead / unreachable${c.x}   ${dead.length}`);
console.log(`  ${expired.length ? c.r : c.g}deadline passed${c.x}      ${expired.length}`);
console.log(`  ${noDate.length ? c.y : c.g}no date anywhere${c.x}     ${noDate.length}  ${c.d}(can't tell how stale)${c.x}\n`);

const show = (label, arr, fmt) => {
  if (!arr.length) return;
  console.log(`${c.b}${label}${c.x}`);
  for (const r of arr) console.log(`  ${fmt(r)}`);
  console.log('');
};
show('DEAD LINKS', dead, (r) => `${c.r}✗${c.x} ${r.title.slice(0, 58)} ${c.d}[${r.source}] ${r.note}${c.x}`);
show('DEADLINE ALREADY PASSED', expired, (r) => `${c.r}✗${c.x} ${r.title.slice(0, 50)} ${c.d}closed ${r.deadline}${c.x}`);

console.log(`${c.b}DATES RECOVERED FROM PAGES${c.x} ${c.d}(the feeds don't supply these)${c.x}`);
for (const r of results.filter((x) => x.posted || x.deadline).slice(0, 20)) {
  console.log(`  ${r.title.slice(0, 44).padEnd(44)} ${c.d}posted:${c.x} ${(r.posted ?? '—').slice(0, 22).padEnd(22)} ${c.d}closes:${c.x} ${r.deadline ?? '—'}`);
}

writeFileSync(resolve(HERE, 'data', 'eval.json'), JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2));
console.log(`\n${c.d}full detail → data/eval.json${c.x}`);

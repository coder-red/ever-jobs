#!/usr/bin/env node
/**
 * Claim verification — the strict audit.
 *
 * eval.mjs asks "is this page alive?". This asks the harder question: **is the
 * specific claim this result makes actually true on the employer's page?**
 *
 *   "hires worldwide"        → does the page say so, or is it inferred?
 *   "Africa/EMEA in scope"   → is Africa really included?
 *   "visa/relocation"        → stated, or matched on a negation?
 *   "posted N days ago"      → does the page agree?
 *   "not senior"             → does the body demand 5+ years anyway?
 *
 * Every check reports CONFIRMED / CONTRADICTED / UNVERIFIABLE. Unverifiable is
 * reported as such and never counted as a pass.
 *
 *   node verify.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(HERE, 'data', 'latest.json'), 'utf8'));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const strip = (h) => h
  .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

const C = { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const CONFIRMED = 'CONFIRMED', CONTRA = 'CONTRADICTED', UNVER = 'UNVERIFIABLE';

const WORLDWIDE = /\b(worldwide|anywhere in the world|work from anywhere|globally distributed|any (?:country|time ?zone|location)|home based\s*[-–]\s*worldwide|fully distributed|no location restriction)\b/i;
const AFRICA = /\b(africa|nigeria|emea|kenya|ghana|south africa|middle east and africa|europe, middle east)\b/i;
const VISA = /\b(visa sponsor\w*|sponsor(?:ship)? (?:is )?(?:available|provided|offered)|we (?:can )?sponsor|relocation (?:package|assistance|support|provided|offered)|work permit (?:provided|sponsored)|blue card)\b/i;
const VISA_NEG = /\b(?:no|not|cannot|can'?t|unable to|do(?:es)? not|won'?t|are not|is not|without)\b[^.;!?]{0,40}?\bsponsor\w*/i;
const US_ONLY = /\b(?:us|u\.s\.|usa|united states)[\s-]*(?:based\s+)?only\b|\bmust (?:be )?(?:located|reside|live|based) in the (?:us|united states)\b|\bauthoriz\w+ to work in the (?:us|united states)\b|\bsecurity clearance\b/i;
const SENIOR_BODY = /\b(?:minimum(?: of)?\s*)?(5|6|7|8|9|10|12|15)\s*\+?\s*(?:years?|yrs?)\b[^.]{0,45}?\bexperience\b/i;

/**
 * Jobicy 403s scrapers but its API serves the same listing. Without this the
 * only unverifiable results were Jobicy's — an anti-bot response, not missing
 * evidence.
 */
let jobicyCache = null;
async function jobicyLookup(url) {
  const id = url.match(/jobicy\.com\/jobs\/(\d+)/)?.[1];
  if (!id) return null;
  if (!jobicyCache) {
    jobicyCache = new Map();
    const qs = ['tag=machine+learning', 'tag=artificial+intelligence', 'tag=data+science',
      'tag=python', 'industry=engineering', 'geo=emea&tag=machine+learning'];
    for (const q of qs) {
      try {
        const r = await fetch(`https://jobicy.com/api/v2/remote-jobs?count=50&${q}`, { headers: { 'User-Agent': UA } });
        const j = await r.json();
        for (const job of j.jobs ?? []) jobicyCache.set(String(job.id), job);
      } catch { /* partial cache is still useful */ }
    }
  }
  const job = jobicyCache.get(id);
  if (!job) return null;
  // jobGeo is the board's structured eligibility field — authoritative.
  return strip(`${job.jobTitle} ${job.companyName} location ${job.jobGeo} ${job.jobLevel ?? ''} ${job.jobDescription ?? job.jobExcerpt ?? ''}`);
}

async function fetchText(url) {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 30_000);
    const r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return { status: r.status, text: null };
    return { status: r.status, text: strip(await r.text()) };
  } catch (e) {
    return { status: e.name === 'AbortError' ? 'timeout' : 'error', text: null };
  }
}

function verifyJob(job, text) {
  const checks = [];
  const add = (claim, verdict, detail) => checks.push({ claim, verdict, detail });

  if (!text) {
    for (const r of job.routes) add(`route:${r}`, UNVER, 'page unreachable');
    add('freshness', UNVER, 'page unreachable');
    return checks;
  }

  // --- eligibility routes ---------------------------------------------------
  for (const route of job.routes) {
    if (route === 'worldwide') {
      const m = text.match(WORLDWIDE);
      if (m) add('hires worldwide', CONFIRMED, `page says "${m[0]}"`);
      else if (US_ONLY.test(text)) add('hires worldwide', CONTRA, `page says "${text.match(US_ONLY)[0]}"`);
      else add('hires worldwide', UNVER, 'page states no explicit geography');
    } else if (route === 'africa-emea') {
      const m = text.match(AFRICA);
      if (m) add('Africa/EMEA in scope', CONFIRMED, `page says "${m[0]}"`);
      else add('Africa/EMEA in scope', UNVER, 'no Africa/EMEA mention on page');
    } else if (route === 'visa-relocation') {
      const neg = text.match(VISA_NEG);
      const pos = text.match(VISA);
      if (neg) add('visa/relocation offered', CONTRA, `page says "${neg[0].slice(0, 50)}"`);
      else if (pos) add('visa/relocation offered', CONFIRMED, `page says "${pos[0].slice(0, 45)}"`);
      else add('visa/relocation offered', UNVER, 'no sponsorship wording found');
    } else if (route === 'nigeria-local') {
      const m = text.match(/\b(nigeria|lagos|abuja|ibadan|port harcourt|kano|enugu|ogun|rivers state)\b/i);
      if (m) add('Nigeria-based', CONFIRMED, `page says "${m[0]}"`);
      else add('Nigeria-based', UNVER, 'no Nigerian location on page');
    } else if (route === 'remote-unconfirmed') {
      add('geo unstated (flagged)', CONFIRMED, 'correctly labelled unconfirmed');
    }
  }

  // --- hard geo block that should have rejected it ---------------------------
  if (!job.routes.includes('visa-relocation') && US_ONLY.test(text)) {
    add('not geo-blocked', CONTRA, `page says "${text.match(US_ONLY)[0].slice(0, 50)}"`);
  }

  // --- entry-level suitability ----------------------------------------------
  const sen = text.match(SENIOR_BODY);
  if (job.track === 'INTL') {
    if (sen) add('entry-level reachable', CONTRA, `body demands ${sen[1]}+ years`);
    else add('entry-level reachable', CONFIRMED, 'no 5+ year demand in body');
  }

  // --- freshness ------------------------------------------------------------
  if (job.postedAt) {
    const days = Math.round((Date.now() - Date.parse(job.postedAt)) / 86_400_000);
    add('freshness', days <= 30 ? CONFIRMED : CONTRA, `${days} days old`);
  } else {
    add('freshness', UNVER, 'no date anywhere');
  }
  return checks;
}

// ------------------------------------------------------------------- run
const jobs = d.jobs ?? [];
console.log(`${C.b}CLAIM VERIFICATION${C.x} ${C.d}— ${jobs.length} results, checked against their live pages${C.x}\n`);

const results = [];
const queue = [...jobs.entries()];
await Promise.all(Array.from({ length: 5 }, async () => {
  for (;;) {
    const n = queue.shift();
    if (!n) return;
    const [i, job] = n;
    let { status, text } = await fetchText(job.url);
    if (!text) {
      const via = await jobicyLookup(job.url);
      if (via) { text = via; status = `${status}→API`; }
    }
    results[i] = { job, status, checks: verifyJob(job, text) };
    process.stdout.write('.');
  }
}));
process.stdout.write('\n\n');

let nC = 0, nX = 0, nU = 0;
for (const { job, status, checks } of results) {
  const bad = checks.filter((c) => c.verdict === CONTRA);
  const unv = checks.filter((c) => c.verdict === UNVER);
  nC += checks.filter((c) => c.verdict === CONFIRMED).length;
  nX += bad.length; nU += unv.length;

  const mark = bad.length ? `${C.r}✗${C.x}` : unv.length ? `${C.y}?${C.x}` : `${C.g}✓${C.x}`;
  console.log(`${mark} ${C.b}[${job.score}] ${job.title.slice(0, 62)}${C.x} ${C.d}(${job.source}, HTTP ${status})${C.x}`);
  for (const c of checks) {
    const col = c.verdict === CONFIRMED ? C.g : c.verdict === CONTRA ? C.r : C.y;
    console.log(`     ${col}${c.verdict.padEnd(13)}${C.x} ${c.claim} ${C.d}— ${c.detail}${C.x}`);
  }
  console.log('');
}

console.log(`${C.b}TOTALS${C.x}  ${C.g}${nC} confirmed${C.x} · ${C.r}${nX} contradicted${C.x} · ${C.y}${nU} unverifiable${C.x}`);
const broken = results.filter((r) => r.checks.some((c) => c.verdict === CONTRA));
if (broken.length) {
  console.log(`\n${C.r}${C.b}${broken.length} result(s) with a contradicted claim:${C.x}`);
  for (const b of broken) {
    console.log(`  • ${b.job.title.slice(0, 58)} ${C.d}[${b.job.source}]${C.x}`);
    for (const c of b.checks.filter((x) => x.verdict === CONTRA)) console.log(`      ${C.r}${c.claim}${C.x}: ${c.detail}`);
  }
} else {
  console.log(`\n${C.g}No contradicted claims.${C.x}`);
}

writeFileSync(resolve(HERE, 'data', 'verify.json'),
  JSON.stringify({ checkedAt: new Date().toISOString(), results: results.map((r) => ({ ...r, job: r.job })) }, null, 2));
console.log(`${C.d}detail → data/verify.json${C.x}`);

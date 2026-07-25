#!/usr/bin/env node
/**
 * jobradar — entry-level AI/ML jobs a Nigeria-based engineer can actually get.
 *
 *   node radar.mjs                 collect, score, send to Telegram
 *   node radar.mjs --dry           collect + score, print, send nothing
 *   node radar.mjs --why           also print why each job was rejected
 *   node radar.mjs --top 30        change how many results to show/send
 *   node radar.mjs --no-seed       don't seed dedupe from the old notified.json
 *   node radar.mjs --track ng      only NG (or: intl)
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { fetchAll } from './lib/sources.mjs';
import { evaluate } from './lib/score.mjs';
import { enrich } from './lib/enrich.mjs';
import { findAgencies } from './lib/agencies.mjs';
import {
  load as loadOutreach, save as saveOutreach, upsert as upsertOutreach,
  counts as outreachCounts, shortId,
} from './lib/outreach.mjs';
import { load as loadHealth, save as saveHealth, record as recordHealth } from './lib/srchealth.mjs';
import { readEnv, canonical, loadSeen, saveSeen, seedFromLegacy } from './lib/store.mjs';
import { sendJobs, verifyBot, sendSummary, formatJob, formatAgency, ageLabel } from './lib/notify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(HERE, 'config.json'), 'utf8'));

// --------------------------------------------------- chat-id discovery helper
// `TELEGRAM_CHAT_ID` in ever-jobs/.env is the BOT's own id, so every send fails
// with "the bot can't send messages to the bot". Run this after messaging the
// bot to find the real one.
if (process.argv.includes('--find-chat')) {
  const { readEnv: re } = await import('./lib/store.mjs');
  const env0 = re(resolve(HERE, cfg.envPath));
  const tok = process.env.TELEGRAM_BOT_TOKEN ?? env0.TELEGRAM_BOT_TOKEN;
  if (!tok) { console.log('No TELEGRAM_BOT_TOKEN found.'); process.exit(1); }
  const me = await (await fetch(`https://api.telegram.org/bot${tok}/getMe`)).json();
  if (!me.ok) { console.log(`Bad token: ${me.description}`); process.exit(1); }
  console.log(`Bot is @${me.result.username}.`);
  const upd = await (await fetch(`https://api.telegram.org/bot${tok}/getUpdates`)).json();
  const chats = new Map();
  for (const u of upd.result ?? []) {
    const m = u.message ?? u.edited_message ?? u.channel_post;
    if (m?.chat) chats.set(m.chat.id, m.chat);
  }
  if (!chats.size) {
    console.log(`\nNo messages yet. Open Telegram, message @${me.result.username} (say "hi"), then re-run:`);
    console.log('  node radar.mjs --find-chat');
    process.exit(0);
  }
  console.log('\nFound:');
  for (const [id, ch] of chats) {
    console.log(`  TELEGRAM_CHAT_ID=${id}   (${ch.type}: ${ch.first_name ?? ch.title ?? ch.username ?? ''})`);
  }
  console.log('\nPut that line in ever-jobs/.env (replacing the current value), then run: node radar.mjs');
  process.exit(0);
}

// ------------------------------------------------------------------ CLI args
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY = flag('dry');
const WHY = flag('why');
const TRACK = String(opt('track', 'all')).toLowerCase();
const TOP = Number(opt('top', cfg.maxNotificationsPerRun));

const c = { g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m', cy: '\x1b[36m' };
const log = (...a) => console.log(...a);

// ------------------------------------------------------------------- run
const t0 = Date.now();
log(`${c.b}jobradar${c.x} ${c.d}— entry-level AI/ML, Nigeria-eligible${c.x}\n`);

log(`${c.d}fetching ${cfg.sources.length} sources...${c.x}`);
const { jobs, stats, errors } = await fetchAll(cfg.sources);

for (const [name, n] of Object.entries(stats)) {
  const bad = n === 0;
  log(`  ${bad ? c.r + '✗' : c.g + '✓'}${c.x} ${name.padEnd(16)} ${String(n).padStart(4)} raw`);
}
for (const e of errors) log(`  ${c.r}!${c.x} ${c.d}${e}${c.x}`);
log(`${c.d}${jobs.length} raw postings${c.x}\n`);

// --- source health -----------------------------------------------------------
// A scraper that breaks returns [] forever without complaining. ever-jobs ran
// five weeks with every Nigerian source at 0 and never said so.
const healthPath = resolve(HERE, 'data', 'source-health.json');
const healthState = loadHealth(healthPath);
const { broken: brokenSources, recovered: recoveredSources } = recordHealth(healthState, stats);
saveHealth(healthPath, healthState);
for (const b of brokenSources) {
  log(`  ${c.r}⚠ ${b.name} has stopped returning results${c.x} ${c.d}(peak ${b.best}, zero for ${b.runs} runs — parser likely broken)${c.x}`);
}
for (const r of recoveredSources) log(`  ${c.g}✓ ${r.name} recovered (${r.count})${c.x}`);

// ------------------------------------------------------- dedupe within batch
const byUrl = new Map();
const byTitleCo = new Set();
for (const j of jobs) {
  const key = canonical(j.url);
  if (byUrl.has(key)) continue;
  // Same role reposted under different slugs (Arbeitnow), or listed on both an
  // aggregator and the employer's own ATS. "Canonical Ltd." and "canonical" are
  // the same firm, so strip legal suffixes before comparing.
  const co = j.company.toLowerCase()
    .replace(/\b(ltd|limited|inc|llc|corp|corporation|gmbh|bv|plc|co|company|group|holdings?)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  const ti = j.title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const sig = `${ti}|${co}`;
  if (ti.length > 6 && byTitleCo.has(sig)) continue;
  byTitleCo.add(sig);
  byUrl.set(key, { ...j, key });
}

// ------------------------------------------------------------------- score
const kept = [];
const rejected = [];
for (const job of byUrl.values()) {
  const verdict = evaluate(job, cfg);
  if (TRACK !== 'all' && verdict.track.toLowerCase() !== TRACK) continue;
  (verdict.keep ? kept : rejected).push({ job, verdict });
}
kept.sort((a, b) => b.verdict.score - a.verdict.score);

log(`${c.b}${kept.length} matched${c.x} ${c.d}from ${byUrl.size} unique${c.x}`);
let enrichStats = null;

// ------------------------------------------------------------------ enrich
// NG boards ship no dates and Jobberman serves expired listings in search, so
// verify the matched set against its own pages before anything is sent.
if (!flag('no-enrich') && kept.length) {
  process.stdout.write(`${c.d}verifying ${kept.length} pages...${c.x}`);
  const checked = await enrich(kept.map((k) => k.job), { concurrency: 6 });

  let dead = 0, closed = 0, dated = 0;
  const survivors = [];
  for (let i = 0; i < checked.length; i++) {
    const job = checked[i];
    if (job.live === 'dead') { dead++; continue; }
    if (job.deadline && Date.parse(job.deadline) < Date.now()) { closed++; continue; }
    if (job.postedAt && !kept[i].job.postedAt) dated++;
    // Re-score with the recovered date so a 78-day-old post can't outrank today's.
    survivors.push({ job, verdict: evaluate(job, cfg) });
  }
  log(`\r${c.d}verified ${checked.length} pages — ${c.x}${c.r}${dead} dead${c.x}${c.d}, ${c.x}${c.y}${closed} closed${c.x}${c.d}, ${c.x}${c.g}${dated} dates recovered${c.x}`);
  const stale = survivors.filter((s) => !s.verdict.keep).length;
  enrichStats = { checked: checked.length, dead, closed, datesRecovered: dated, staleAfterDating: stale };

  kept.length = 0;
  kept.push(...survivors.filter((s) => s.verdict.keep));
  kept.sort((a, b) => b.verdict.score - a.verdict.score);
}

const ng = kept.filter((k) => k.verdict.track === 'NG');
const intl = kept.filter((k) => k.verdict.track === 'INTL');
log(`${c.b}${kept.length} live and current${c.x} ${c.d}(${intl.length} international, ${ng.length} Nigeria)${c.x}\n`);

// ----------------------------------------------------------- agency radar
// Outreach leads, from the corpus already fetched. An agency that is hiring is
// an agency worth a DM — what it is hiring for doesn't have to be AI/ML.
const agencies = flag('no-agencies')
  ? []
  : findAgencies([...byUrl.values()], { minScore: cfg.minScoreAgency ?? 45 });
if (agencies.length) {
  const withAi = agencies.filter((a) => a.aiPostings > 0).length;
  log(`${c.b}${agencies.length} agency leads${c.x} ${c.d}(${withAi} already hiring AI/ML, ${agencies.filter((a) => a.emails.length).length} with an email)${c.x}\n`);
}

// ------------------------------------------------------------------ dedupe
const seenPath = resolve(HERE, 'data', 'seen.json');
const seen = loadSeen(seenPath);
if (!flag('no-seed')) {
  const added = seedFromLegacy(seen, resolve(HERE, cfg.legacyNotifiedPath));
  if (added) log(`${c.d}seeded ${added} already-notified URLs from the old pipeline${c.x}`);
}

const fresh = kept.filter(({ job }) => !seen[canonical(job.url)]);
log(`${c.b}${fresh.length} new${c.x} ${c.d}(${kept.length - fresh.length} already sent previously)${c.x}\n`);

// ------------------------------------------------------------------ display
/**
 * Nigerian boards out-produce the international ones roughly 40:1, so a plain
 * score sort would fill every slot with NG roles. Reserve up to half the run
 * for international, then backfill from whichever track has more left.
 */
function balance(items, limit) {
  const a = items.filter((x) => x.verdict.track === 'INTL');
  const b = items.filter((x) => x.verdict.track === 'NG');
  const half = Math.ceil(limit / 2);
  const picked = [...a.slice(0, half), ...b.slice(0, limit - Math.min(a.length, half))];
  return picked.sort((x, y) => y.verdict.score - x.verdict.score).slice(0, limit);
}

const toSend = balance(fresh, TOP);

// Agency leads are deduped on their own key so a firm is suggested once, then
// again only if it goes quiet and starts hiring afresh.
const AGENCY_COOLDOWN_DAYS = cfg.agencyCooldownDays ?? 30;
// Every scored agency goes into the outreach pipeline, browsable any time via
// the bot's /agencies command. Only a small digest is pushed unprompted.
const outreachPath = resolve(HERE, 'data', 'outreach.json');
const outreach = loadOutreach(outreachPath);
const { added: newAgencyIds } = upsertOutreach(outreach, agencies);
saveOutreach(outreachPath, outreach);
if (agencies.length) {
  const waiting = outreachCounts(outreach).new;
  log(`${c.d}pipeline: ${newAgencyIds.length} new, ${waiting} waiting for a DM — browse with /agencies${c.x}\n`);
}

// Push only firms not already actioned or announced. Anything you've marked
// DM'd or skipped in Telegram never comes back.
const actioned = new Set(
  Object.values(outreach).filter((r) => r.status !== 'new').map((r) => r.key),
);
const agencyPool = agencies.filter((a) => {
  if (actioned.has(a.key)) return false;
  const prev = seen[`agency:${a.key}`];
  if (!prev?.notifiedAt) return true;
  return (Date.now() - Date.parse(prev.notifiedAt)) / 86_400_000 > AGENCY_COOLDOWN_DAYS;
});
// Global talent firms outscore Nigerian ones, so reserve half the slots for
// local firms — they're the ones most likely to answer a cold DM.
const agencyCap = cfg.maxAgenciesPerRun ?? 5;
const agHalf = Math.ceil(agencyCap / 2);
const agNg = agencyPool.filter((a) => a.inNigeria);
const agIntl = agencyPool.filter((a) => !a.inNigeria);
const freshAgencies = [
  ...agNg.slice(0, agHalf),
  ...agIntl.slice(0, agencyCap - Math.min(agNg.length, agHalf)),
].sort((a, b) => b.score - a.score).slice(0, agencyCap);
if (!toSend.length && !freshAgencies.length) log(`${c.y}nothing new to send this run.${c.x}`);

toSend.forEach(({ job, verdict }, i) => {
  const badge = verdict.track === 'NG' ? '🇳🇬' : '🌍';
  log(`${c.b}${String(i + 1).padStart(2)}. [${verdict.score}] ${badge} ${job.title}${c.x}`);
  const age = ageLabel(job.postedAt);
  log(`    ${c.cy}${job.company || '—'}${c.x} ${c.d}· ${job.location || '—'} · ${job.source}${c.x}` +
      (age ? `  ${/just|h ago|yesterday/.test(age) ? c.g : /days old/.test(age) ? c.y : c.d}${age.replace(/[🔥🕒⚠️]\s*/gu, '')}${c.x}` : ''));
  log(`    ${c.g}${verdict.routes.join(' · ')}${c.x} ${c.d}— ${verdict.reasons.slice(0, 4).join(', ')}${c.x}`);
  log(`    ${c.d}${job.url}${c.x}\n`);
});

// Always write the full matched set to disk — Telegram delivery can fail, the
// results shouldn't be lost with it.
{
  const out = resolve(HERE, 'data', 'latest.json');
  // Rejection reasons, normalised so counts group (drops names, numbers, quotes).
  const tally = {};
  for (const { verdict } of rejected) {
    if (verdict.reject === 'no AI/ML signal in title') continue; // the bulk; not informative
    const k = (verdict.reject ?? 'unknown')
      .replace(/\s*\(.*?\)/g, '').replace(/"[^"]*"/g, '').replace(/\s*\d+.*$/, '').trim();
    tally[k] = (tally[k] ?? 0) + 1;
  }
  const payload = {
    generatedAt: new Date().toISOString(),
    rawCount: jobs.length,
    uniqueCount: byUrl.size,
    aiTitled: rejected.filter((r) => r.verdict.reject !== 'no AI/ML signal in title').length + kept.length,
    matched: kept.length,
    enrichment: enrichStats,
    rejectionTally: Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1])),
    sourceStats: stats,
    sourceErrors: errors,
    jobs: kept.map(({ job, verdict }) => ({
      score: verdict.score, track: verdict.track, routes: verdict.routes,
      reasons: verdict.reasons, title: job.title, company: job.company,
      location: job.location, url: job.url, source: job.source,
      postedAt: job.postedAt, salary: job.salary,
    })),
    agencies: agencies.slice(0, 30).map((a) => ({
      name: a.name, score: a.score, postings: a.postings, aiPostings: a.aiPostings,
      inNigeria: a.inNigeria, locations: a.locations, emails: a.emails,
      reasons: a.reasons, titles: a.titles.slice(0, 3), linkedin: a.linkedin,
      sampleUrl: a.sampleUrl,
    })),
  };
  const { mkdirSync, writeFileSync } = await import('node:fs');
  mkdirSync(resolve(HERE, 'data'), { recursive: true });
  writeFileSync(out, JSON.stringify(payload, null, 2), 'utf8');
  log(`${c.d}full results → data/latest.json (${kept.length} jobs)${c.x}\n`);
}

if (freshAgencies.length) {
  log(`${c.b}suggested agencies to cold-DM:${c.x}`);
  freshAgencies.forEach((a, i) => {
    log(`${c.b}${String(i + 1).padStart(2)}. [${a.score}] 🏢 ${a.name}${c.x}`);
    log(`    ${c.d}${a.postings} postings · ${a.aiPostings ? `${a.aiPostings} AI/ML` : 'no AI/ML yet'}` +
        `${a.locations.length ? ` · ${a.locations[0]}` : ''}${c.x}`);
    log(`    ${a.emails.length ? c.g + a.emails.join(', ') : c.d + 'no email — search LinkedIn'}${c.x}`);
    log(`    ${c.d}${a.reasons.slice(0, 3).join(', ')}${c.x}\n`);
  });
}

if (WHY) {
  const tally = {};
  for (const { verdict } of rejected) {
    const k = (verdict.reject ?? 'unknown').replace(/\(.*\)|"[^"]*"|\d+/g, '').trim();
    tally[k] = (tally[k] ?? 0) + 1;
  }
  log(`${c.b}rejected ${rejected.length}:${c.x}`);
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 15)) {
    log(`  ${c.d}${String(n).padStart(4)} × ${k}${c.x}`);
  }
  log('');
}

// ------------------------------------------------------------------- notify
const env = readEnv(resolve(HERE, cfg.envPath));
const token = process.env.TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID;

if (DRY) {
  log(`${c.y}--dry: nothing sent.${c.x}`);
} else if (!token || !chatId) {
  log(`${c.r}no TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID found — skipping send.${c.x}`);
} else if (toSend.length || freshAgencies.length) {
  try {
    const me = await verifyBot(token);
    log(`${c.d}bot @${me.username} → chat ${chatId}${c.x}`);
  } catch (e) {
    log(`${c.r}telegram auth failed: ${e.message}${c.x}`);
    process.exit(1);
  }
  const queue = [
    ...toSend,
    ...freshAgencies.map((a) => ({
      agency: a,
      keyboard: {
        inline_keyboard: [
          [
            { text: "✅ Mark DM sent", callback_data: `d:${shortId(a.key)}` },
            { text: '⏭ Skip', callback_data: `s:${shortId(a.key)}` },
          ],
          [{
            text: a.emails?.length ? '✉️ Email them' : '🔎 Open LinkedIn',
            url: a.emails?.length ? `mailto:${a.emails[0]}` : a.linkedin,
          }],
        ],
      },
    })),
  ];
  // A broken scraper is worth interrupting you for — it's how the old pipeline
  // went five weeks returning nothing without anyone noticing.
  if (brokenSources.length) {
    await sendSummary(token, chatId,
      `⚠️ <b>Source broken</b>\n${brokenSources.map((b) => `• <b>${b.name}</b> — was returning up to ${b.best}, now 0 for ${b.runs} runs`).join('\n')}\n\n<i>Its parser probably needs fixing; the site may have been redesigned.</i>`)
      .catch(() => {});
  }

  const { sent, failed } = await sendJobs(token, chatId, queue, { delayMs: cfg.telegramDelayMs });
  const now = new Date().toISOString();
  for (const url of sent) {
    // Agency keys are already canonical ("agency:<key>"); job URLs need normalising.
    seen[url.startsWith('agency:') ? url : canonical(url)] = { notifiedAt: now };
  }
  saveSeen(seenPath, seen);
  log(`${c.g}sent ${sent.length}${c.x}${failed.length ? ` ${c.r}(${failed.length} failed)${c.x}` : ''}`);
  for (const f of failed) log(`  ${c.r}✗${c.x} ${c.d}${f.error} — ${f.url}${c.x}`);
} else {
  saveSeen(seenPath, seen);
}

log(`\n${c.d}done in ${((Date.now() - t0) / 1000).toFixed(1)}s${c.x}`);

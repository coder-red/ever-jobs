#!/usr/bin/env node
/**
 * Interactive Telegram bot — the UI layer.
 *
 * `radar.mjs` only pushes. This process LISTENS: it long-polls getUpdates and
 * handles commands and inline-button taps, so agencies can be browsed on their
 * own, one at a time, and marked done as you work through them.
 *
 *   node bot.mjs            run in the foreground (Ctrl-C to stop)
 *   node bot.mjs --once     drain pending updates and exit (for scheduling)
 *
 * NOTE: Telegram permits only ONE getUpdates consumer per bot token. The old
 * ever-jobs notifier also polled; don't run both against @aiengr_bot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { readEnv } from './lib/store.mjs';
import * as O from './lib/outreach.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(HERE, 'config.json'), 'utf8'));
const env = readEnv(resolve(HERE, cfg.envPath));
const TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
const CHAT = String(process.env.TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID ?? '');
const OUT_PATH = resolve(HERE, 'data', 'outreach.json');
const LATEST = resolve(HERE, 'data', 'latest.json');
const ONCE = process.argv.includes('--once');
const PAGE = 1; // one agency per message — the point is to act on them singly

if (!TOKEN) { console.error('No TELEGRAM_BOT_TOKEN'); process.exit(1); }

const API = `https://api.telegram.org/bot${TOKEN}`;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function call(method, body) {
  const r = await fetch(`${API}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!j.ok && j.error_code !== 400) console.error(`[${method}] ${j.description ?? r.status}`);
  return j;
}

// ------------------------------------------------------------------ rendering

const STATUS_BADGE = {
  new: '⚪ not contacted', dmd: '✅ DM sent', skipped: '⏭ skipped', replied: '💬 replied',
};

function agencyCard(a, position) {
  const contact = a.emails?.length
    ? `✉️ <code>${esc(a.emails[0])}</code>`
    : `🔎 <a href="${esc(a.linkedin)}">LinkedIn search</a>`;
  const lines = [
    position ? `🏢 <b>Agency ${position}</b>` : '🏢 <b>Agency</b>',
    `<b>${esc(a.name)}</b>${a.inNigeria ? ' 🇳🇬' : ' 🌍'}`,
    a.locations?.length ? `📍 ${esc(a.locations.join(' · '))}` : null,
    `📈 <b>${a.postings}</b> live posting${a.postings === 1 ? '' : 's'}` +
      (a.aiPostings ? ` · <b>${a.aiPostings}</b> AI/ML` : ' · none in AI/ML yet'),
    contact,
    `⭐ ${a.score}/100 — ${esc((a.reasons ?? []).slice(0, 2).join(', '))}`,
    a.titles?.length ? `\n<i>Hiring now:</i>\n${a.titles.map((t) => `· ${esc(t.slice(0, 54))}`).join('\n')}` : null,
    `\n${STATUS_BADGE[a.status] ?? ''}${a.note ? ` — <i>${esc(a.note)}</i>` : ''}`,
  ].filter(Boolean);
  return lines.join('\n');
}

/** Buttons under an agency card. `i` drives the "next" cursor. */
function agencyKeys(a, cursor) {
  const rows = [];
  if (a.status !== O.STATUS.DMD) {
    rows.push([
      { text: '✅ Mark DM sent', callback_data: `d:${a.id}` },
      { text: '⏭ Skip', callback_data: `s:${a.id}` },
    ]);
  } else {
    rows.push([
      { text: '💬 They replied', callback_data: `r:${a.id}` },
      { text: '↩️ Undo', callback_data: `u:${a.id}` },
    ]);
  }
  const link = a.emails?.length ? `mailto:${a.emails[0]}` : a.linkedin;
  rows.push([{ text: a.emails?.length ? '✉️ Email them' : '🔎 Open LinkedIn', url: link }]);
  if (cursor !== null) rows.push([{ text: '➡️ Next agency', callback_data: `n:${cursor}` }]);
  return { inline_keyboard: rows };
}

// ------------------------------------------------------------------ commands

function help() {
  return [
    '🤖 <b>Job radar</b>',
    '',
    '<b>Agencies</b> (cold outreach)',
    '/agencies — next agency to contact, one at a time',
    '/pending — how many are left',
    '/done — the ones you have DM\'d',
    '/skipped — the ones you passed on',
    '',
    '<b>Jobs</b>',
    '/jobs — latest matched roles',
    '/ng — Nigerian roles only',
    '/intl — international roles only',
    '',
    '<b>Other</b>',
    '/stats — pipeline numbers from the last scan',
    '/help — this message',
    '',
    '<i>Agencies are rescanned every hour. Marking one done stops it coming back.</i>',
  ].join('\n');
}

/** Next un-actioned agency, highest score first. */
function nextAgency(state, fromIndex = 0) {
  const queue = O.list(state, { status: O.STATUS.NEW });
  if (!queue.length) return { agency: null, cursor: null, total: 0, index: 0 };
  const i = Math.min(fromIndex, queue.length - 1);
  return {
    agency: queue[i],
    cursor: i + 1 < queue.length ? i + 1 : null,
    total: queue.length,
    index: i,
  };
}

async function sendNextAgency(chatId, state, fromIndex = 0) {
  const { agency, cursor, total, index } = nextAgency(state, fromIndex);
  if (!agency) {
    const c = O.counts(state);
    return call('sendMessage', {
      chat_id: chatId, parse_mode: 'HTML',
      text: `🎉 No agencies waiting.\n\n✅ ${c.dmd} DM'd · ⏭ ${c.skipped} skipped · ${c.total} tracked total.\n\n<i>New ones arrive as they start hiring — the scan runs hourly.</i>`,
    });
  }
  return call('sendMessage', {
    chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true,
    text: agencyCard(agency, `${index + 1} of ${total}`),
    reply_markup: agencyKeys(agency, cursor),
  });
}

function jobsText(track) {
  let d;
  try { d = JSON.parse(readFileSync(LATEST, 'utf8')); } catch { return 'No scan data yet. Run the radar first.'; }
  let rows = d.jobs ?? [];
  if (track) rows = rows.filter((j) => j.track === track);
  if (!rows.length) return `No ${track === 'NG' ? 'Nigerian' : track === 'INTL' ? 'international' : ''} roles in the last scan.`;
  const age = (iso) => {
    if (!iso) return '';
    const n = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
    return Number.isNaN(n) ? '' : n <= 0 ? ' · today' : n === 1 ? ' · 1d ago' : ` · ${n}d ago`;
  };
  return [`<b>${rows.length} role${rows.length === 1 ? '' : 's'}</b> from the last scan\n`]
    .concat(rows.slice(0, 15).map((j) => {
      const flag = j.track === 'NG' ? '🇳🇬' : '🌍';
      return `${flag} <b>${esc(j.title.slice(0, 70))}</b>\n   ${j.score}/100${esc(age(j.postedAt))}\n   <a href="${esc(j.url)}">open</a>`;
    })).join('\n\n');
}

function statsText(state) {
  let d = {};
  try { d = JSON.parse(readFileSync(LATEST, 'utf8')); } catch { /* no scan yet */ }
  const c = O.counts(state);
  const en = d.enrichment ?? {};
  return [
    '📊 <b>Last scan</b>',
    d.generatedAt ? `<i>${new Date(d.generatedAt).toUTCString()}</i>` : '<i>no scan yet</i>',
    '',
    `Collected: <b>${(d.rawCount ?? 0).toLocaleString()}</b> postings`,
    `AI/ML titled: <b>${d.aiTitled ?? 0}</b>`,
    `Live &amp; reachable: <b>${d.matched ?? 0}</b>`,
    en.checked ? `Verified: ${en.checked} pages · ${en.dead} dead · ${en.datesRecovered} dates recovered` : null,
    '',
    '🏢 <b>Agency pipeline</b>',
    `Tracked: <b>${c.total}</b> (${c.ng} Nigerian)`,
    `⚪ Waiting: <b>${c.new}</b>`,
    `✅ DM'd: <b>${c.dmd}</b>`,
    `💬 Replied: <b>${c.replied}</b>`,
    `⏭ Skipped: <b>${c.skipped}</b>`,
    `✉️ With an email: ${c.withEmail}`,
  ].filter(Boolean).join('\n');
}

function listText(state, status, title) {
  const rows = O.list(state, { status, sort: 'recent' });
  if (!rows.length) return `Nothing ${title.toLowerCase()} yet.`;
  return [`<b>${title}</b> (${rows.length})\n`]
    .concat(rows.slice(0, 25).map((r) => {
      const when = new Date(r.updatedAt).toISOString().slice(0, 10);
      const via = r.emails?.length ? r.emails[0] : 'LinkedIn';
      return `${r.inNigeria ? '🇳🇬' : '🌍'} <b>${esc(r.name)}</b>\n   ${when} · ${esc(via)}`;
    })).join('\n');
}

// ------------------------------------------------------------------- handlers

async function onCommand(msg, state) {
  const chatId = msg.chat.id;
  const text = (msg.text ?? '').trim().toLowerCase().split('@')[0];

  switch (text) {
    case '/start':
    case '/help':
      return call('sendMessage', { chat_id: chatId, text: help(), parse_mode: 'HTML' });
    case '/agencies':
      return sendNextAgency(chatId, state, 0);
    case '/pending': {
      const c = O.counts(state);
      return call('sendMessage', {
        chat_id: chatId, parse_mode: 'HTML',
        text: `⚪ <b>${c.new}</b> agencies waiting for a DM.\n✅ ${c.dmd} done · ⏭ ${c.skipped} skipped\n\nSend /agencies to work through them.`,
      });
    }
    case '/done':
      return call('sendMessage', { chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true, text: listText(state, O.STATUS.DMD, 'DM sent') });
    case '/skipped':
      return call('sendMessage', { chat_id: chatId, parse_mode: 'HTML', disable_web_page_preview: true, text: listText(state, O.STATUS.SKIPPED, 'Skipped') });
    case '/stats':
      return call('sendMessage', { chat_id: chatId, text: statsText(state), parse_mode: 'HTML' });
    case '/jobs':
      return call('sendMessage', { chat_id: chatId, text: jobsText(null), parse_mode: 'HTML', disable_web_page_preview: true });
    case '/ng':
      return call('sendMessage', { chat_id: chatId, text: jobsText('NG'), parse_mode: 'HTML', disable_web_page_preview: true });
    case '/intl':
      return call('sendMessage', { chat_id: chatId, text: jobsText('INTL'), parse_mode: 'HTML', disable_web_page_preview: true });
    default:
      if (text.startsWith('/')) {
        return call('sendMessage', { chat_id: chatId, text: 'Unknown command. /help for the list.' });
      }
  }
}

async function onCallback(cb, state) {
  const [action, arg] = (cb.data ?? '').split(':');
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;

  if (action === 'n') {
    await call('answerCallbackQuery', { callback_query_id: cb.id });
    return sendNextAgency(chatId, state, Number(arg) || 0);
  }

  const map = { d: O.STATUS.DMD, s: O.STATUS.SKIPPED, r: O.STATUS.REPLIED, u: O.STATUS.NEW };
  const status = map[action];
  if (!status) return call('answerCallbackQuery', { callback_query_id: cb.id });

  const rec = O.setStatus(state, arg, status);
  if (!rec) {
    return call('answerCallbackQuery', { callback_query_id: cb.id, text: 'Not found — rescan may have reset it.' });
  }
  O.save(OUT_PATH, state);

  const toast = {
    [O.STATUS.DMD]: `✅ ${rec.name} marked DM'd`,
    [O.STATUS.SKIPPED]: `⏭ ${rec.name} skipped`,
    [O.STATUS.REPLIED]: `💬 ${rec.name} — nice one`,
    [O.STATUS.NEW]: `↩️ ${rec.name} back in the queue`,
  }[status];
  await call('answerCallbackQuery', { callback_query_id: cb.id, text: toast });

  // Rewrite the card in place so the message reflects its new state.
  const { cursor } = nextAgency(state, 0);
  await call('editMessageText', {
    chat_id: chatId, message_id: msgId, parse_mode: 'HTML', disable_web_page_preview: true,
    text: agencyCard(rec, null),
    reply_markup: agencyKeys(rec, cursor === null ? 0 : 0),
  });
}

// ---------------------------------------------------------------------- loop

async function registerCommands() {
  await call('setMyCommands', {
    commands: [
      { command: 'agencies', description: 'Next agency to cold-DM' },
      { command: 'pending', description: 'How many agencies are waiting' },
      { command: 'done', description: "Agencies you've DM'd" },
      { command: 'skipped', description: 'Agencies you passed on' },
      { command: 'jobs', description: 'Latest matched roles' },
      { command: 'ng', description: 'Nigerian roles only' },
      { command: 'intl', description: 'International roles only' },
      { command: 'stats', description: 'Pipeline numbers' },
      { command: 'help', description: 'Show all commands' },
    ],
  });
}

let offset = 0;
let backoff = 1000;
let conflicts = 0;
async function poll(timeout) {
  const r = await fetch(`${API}/getUpdates?offset=${offset}&timeout=${timeout}`)
    .then((x) => x.json())
    .catch(() => null);

  if (!r?.ok) {
    // Telegram allows one getUpdates consumer per token. A 409 is usually
    // TRANSIENT — an overlapping restart, or a one-off diagnostic call. Only a
    // sustained conflict means a real second instance, so retry before giving
    // up; exiting on the first 409 let a single stray call kill the bot.
    if (r?.error_code === 409) {
      conflicts++;
      if (conflicts >= 10) {
        console.error('409 x10: another process owns this bot token. Exiting.');
        process.exit(0);
      }
      console.error(`409 conflict (${conflicts}/10) — retrying in 5s`);
      await new Promise((res) => setTimeout(res, 5000));
      return 0;
    }
    await new Promise((res) => setTimeout(res, backoff));
    backoff = Math.min(backoff * 2, 60_000);
    return 0;
  }
  backoff = 1000;
  conflicts = 0;
  let n = 0;
  for (const u of r.result ?? []) {
    offset = Math.max(offset, u.update_id + 1);
    const state = O.load(OUT_PATH);
    try {
      if (u.message?.text) await onCommand(u.message, state);
      else if (u.callback_query) await onCallback(u.callback_query, state);
      n++;
    } catch (e) {
      console.error('handler error:', e.message);
    }
  }
  return n;
}

const me = await call('getMe', {});
if (!me.ok) { console.error('Bad token.'); process.exit(1); }
await registerCommands();
console.log(`bot @${me.result.username} listening${ONCE ? ' (single drain)' : ''} — chat ${CHAT}`);
console.log(`outreach state: ${OUT_PATH}`);

if (ONCE) {
  // Drain everything queued since the last run, then CONFIRM the offset.
  // Telegram only marks updates delivered once you call getUpdates with a
  // higher offset — without this final call every tap is replayed next run.
  let total = 0;
  for (let i = 0; i < 10; i++) {
    const n = await poll(0);
    total += n;
    if (n === 0) break;
  }
  if (offset > 0) {
    await fetch(`${API}/getUpdates?offset=${offset}&timeout=0`).catch(() => {});
  }
  console.log(`handled ${total} update(s)`);
} else {
  for (;;) await poll(30);
}

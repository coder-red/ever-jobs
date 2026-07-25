/** Telegram delivery. Reuses the bot token/chat id from the ever-jobs .env. */

const API = 'https://api.telegram.org';

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const ROUTE_LABEL = {
  worldwide: '🌍 hires worldwide',
  'africa-emea': '🌍 Africa/EMEA in scope',
  'contractor-eor': '📄 contractor/EOR',
  'visa-relocation': '✈️ visa/relocation',
  'remote-unconfirmed': '❓ remote, geo unstated — verify before applying',
  'nigeria-local': '🇳🇬 Nigeria',
};

/** Job ads saturate within days — age is the first thing worth seeing. */
export function ageLabel(postedAt) {
  if (!postedAt) return null;
  const ms = Date.now() - Date.parse(postedAt);
  if (Number.isNaN(ms)) return null;
  const h = Math.round(ms / 3.6e6);
  if (h < 1) return '🔥 just posted';
  if (h < 24) return `🔥 ${h}h ago`;
  const d = Math.round(h / 24);
  if (d === 1) return '🔥 yesterday';
  if (d <= 7) return `🕒 ${d} days ago`;
  if (d <= 21) return `🕒 ${d} days ago`;
  return `⚠️ ${d} days old`;
}

export function formatJob(job, verdict) {
  const routes = verdict.routes.map((r) => ROUTE_LABEL[r] ?? r).join(' · ');
  const age = ageLabel(job.postedAt);
  const lines = [
    `<b>${esc(job.title)}</b>`,
    job.company ? `🏢 ${esc(job.company)}` : null,
    job.location ? `📍 ${esc(job.location)}` : null,
    age ? `${esc(age)}` : null,
    job.deadline ? `⏳ closes ${esc(new Date(job.deadline).toDateString())}` : null,
    job.salary ? `💰 ${esc(job.salary)}` : null,
    routes ? `✅ ${esc(routes)}` : null,
    `⭐ <b>${verdict.score}</b>/100 — ${esc(verdict.reasons.slice(0, 4).join(', '))}`,
    `🔗 ${esc(job.url)}`,
    `<i>${esc(job.source)}</i>`,
  ].filter(Boolean);
  return lines.join('\n');
}

/**
 * Agency lead — an outreach target, not a job. Formatted differently on purpose
 * so it never reads like a vacancy you can apply to.
 */
export function formatAgency(a) {
  const contact = a.emails.length
    ? `✉️ ${a.emails.map(esc).join(', ')}`
    : `🔎 <a href="${esc(a.linkedin)}">find on LinkedIn</a>`;
  const roles = a.titles.slice(0, 3).map((t) => `· ${esc(t.slice(0, 58))}`).join('\n');
  const lines = [
    `🏢 <b>SUGGESTED AGENCY</b> — cold outreach`,
    `<b>${esc(a.name)}</b>`,
    a.locations.length ? `📍 ${esc(a.locations.join(' · '))}` : null,
    `📈 <b>${a.postings}</b> live posting${a.postings > 1 ? 's' : ''}` +
      (a.aiPostings ? ` · <b>${a.aiPostings}</b> AI/ML` : ' · none in AI/ML yet'),
    contact,
    `⭐ <b>${a.score}</b>/100 — ${esc(a.reasons.slice(0, 3).join(', '))}`,
    roles ? `\n<i>Currently hiring:</i>\n${roles}` : null,
    a.sampleUrl ? `🔗 ${esc(a.sampleUrl)}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

async function call(token, method, body) {
  const res = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!data.ok) throw new Error(data.description ?? `HTTP ${res.status}`);
  return data.result;
}

export async function verifyBot(token) {
  return call(token, 'getMe', {});
}

/**
 * Send one message per job, rate-limited. Returns the URLs successfully sent so
 * the caller only marks those as seen — a failed send is retried next run.
 */
export async function sendJobs(token, chatId, items, { delayMs = 1200, dryRun = false } = {}) {
  const sent = [];
  const failed = [];
  for (const item of items) {
    // Agency leads travel through the same sender with their own layout.
    const isAgency = !!item.agency;
    const job = isAgency ? { url: `agency:${item.agency.key}` } : item.job;
    const text = isAgency ? formatAgency(item.agency) : formatJob(item.job, item.verdict);
    if (dryRun) { sent.push(job.url); continue; }
    try {
      await call(token, 'sendMessage', {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: isAgency,
        // Agency cards are actionable in place — tap to mark DM'd or skip.
        ...(isAgency && item.keyboard ? { reply_markup: item.keyboard } : {}),
      });
      sent.push(job.url);
    } catch (e) {
      failed.push({ url: job.url, error: e.message });
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return { sent, failed };
}

export async function sendSummary(token, chatId, text, { dryRun = false } = {}) {
  if (dryRun) return;
  await call(token, 'sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
}

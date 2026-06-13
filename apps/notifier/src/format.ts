import { CollatedJob } from './types';

const STARTUP_SITES = new Set([
  'wellfound', 'hackernews', 'berlinstartupjobs', 'startup.jobs',
  '4dayweek', 'workingnomads', 'landing.jobs',
  'hn-hiring', 'hn-seeking',
]);

const PLATFORM_EMOJI: Record<string, string> = {
  twitter: '🐦',
  linkedin: '💼',
  reddit: '🤖',
  hackernews: '🔶',
  bluesky: '🦋',
  mastodon: '🐘',
  web: '🌐',
};

const ENTRY_KEYWORDS = /\b(junior|jr\b|entry|entry.level|graduate|new.?grad|early.?career|intern|internship|trainee|apprentice)\b/i;
const MID_KEYWORDS = /\b(mid\b|mid.level|intermediate)\b/i;
const SENIOR_KEYWORDS = /\b(senior|sr\b|staff\b|principal|lead\b|architect|head\s+of|director|vp\b|vice.?president|manager|principal)\b/i;

function parsePayload(payloadJson: string): Record<string, unknown> {
  try {
    return JSON.parse(payloadJson);
  } catch {
    return {};
  }
}

function computeScore(title: string, payloadJson: string): { score: number; label: string; source: string } {
  const payload = parsePayload(payloadJson);

  if (typeof payload.llmScore === 'number') {
    const score = payload.llmScore;
    const reason = (payload.llmReason as string) || 'LLM-evaluated';
    const source = (payload.llmSource as string) || 'llm';
    const label = scoreLabel(score);
    return { score, label, source: `${source}: ${reason}` };
  }

  const text = title + ' ' + payloadJson;

  let score: number;
  if (/\bintern\b/i.test(text)) score = 100;
  else if (ENTRY_KEYWORDS.test(text)) score = 90;
  else if (MID_KEYWORDS.test(text)) score = 70;
  else if (SENIOR_KEYWORDS.test(text)) score = 30;
  else score = 60;

  return { score, label: scoreLabel(score), source: 'keyword' };
}

function scoreLabel(score: number): string {
  if (score >= 90) return '🔥';
  if (score >= 70) return '👍';
  if (score >= 50) return '➖';
  return '👎';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDate(raw: string | null): string {
  if (!raw) return '';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function zeroExpBadge(payload: Record<string, unknown>): string | null {
  if (typeof payload.zeroExpFriendly === 'boolean') {
    if (payload.zeroExpFriendly) return '🎓 Portfolio/zero-exp OK';
    const expReq = payload.experienceRequired as string | null;
    if (expReq) return `⚠️ ${expReq}`;
    return '⚠️ Exp required';
  }
  return null;
}

function isSocialPost(site: string | null): boolean {
  return !!site && site.toLowerCase().startsWith('social-');
}

function formatSocialJob(job: CollatedJob): string {
  const payload = parsePayload(job.payload_json);
  const title = escapeHtml((job.title ?? '').trim() || 'Untitled');
  const platform = (payload.platform as string) || 'web';
  const author = (payload.author as string) || null;
  const companyName = (payload.companyName as string) || null;
  const roleType = (payload.roleType as string) || null;
  const contactInfo = (payload.contactInfo as string) || null;
  const date = formatDate(job.date_posted);
  const emoji = PLATFORM_EMOJI[platform] || '📱';

  const lines: string[] = [];
  lines.push(`${emoji} <b>${title}</b>`);

  if (companyName) lines.push(escapeHtml(`🏢 ${companyName}`));
  if (author) lines.push(escapeHtml(`👤 ${author}`));
  if (date) lines.push(`📅 ${date}`);

  if (roleType === 'vibe-coder-gig') {
    lines.push(`🎨 Vibe coder gig`);
  }

  if (contactInfo) {
    lines.push(escapeHtml(`📬 ${contactInfo}`));
  }

  const description = (payload.description as string) || '';
  if (description) {
    const desc = escapeHtml(description.slice(0, 300));
    lines.push('');
    lines.push(desc);
  }

  const { score, label, source } = computeScore(job.title ?? '', job.payload_json);
  lines.push(`🏆 Fit: ${label} ${score}/100 (${source})`);

  const badge = zeroExpBadge(payload);
  if (badge) lines.push(badge);

  lines.push('');
  lines.push(`<a href="${escapeHtml(job.job_url)}">View post</a>`);
  lines.push('');
  lines.push(escapeHtml(`via ${platform}`));

  return lines.join('\n');
}

export function formatJob(job: CollatedJob): string {
  if (isSocialPost(job.site)) {
    return formatSocialJob(job);
  }

  const title = escapeHtml((job.title ?? '').trim() || 'Untitled role');
  const company = job.company_name ? job.company_name.trim() : null;
  const location = job.location
    ? job.location.trim()
    : job.is_remote === 1
      ? 'Remote'
      : 'Location unspecified';
  const site = job.site ? job.site : 'unknown source';
  const url = job.job_url;
  const date = formatDate(job.date_posted);
  const isStartup = job.site && STARTUP_SITES.has(job.site.toLowerCase());
  const { score, label, source } = computeScore(job.title ?? '', job.payload_json);

  const payload = parsePayload(job.payload_json);

  const lines: string[] = [];
  lines.push(`<b>${title}</b>`);
  if (company) lines.push(escapeHtml(`@ ${company}`));
  if (date) lines.push(`📅 ${date}`);
  lines.push(escapeHtml(`📍 ${location}`));
  lines.push(`🏆 Fit: ${label} ${score}/100 (${source})`);
  if (isStartup) lines.push(`🚀 Startup / seed`);

  const badge = zeroExpBadge(payload);
  if (badge) lines.push(badge);

  lines.push('');
  lines.push(`<a href="${escapeHtml(url)}">Apply / view</a>`);
  lines.push('');
  lines.push(escapeHtml(`via ${site}`));

  return lines.join('\n');
}

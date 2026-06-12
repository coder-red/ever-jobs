import { CollatedJob } from './types';

const STARTUP_SITES = new Set([
  'wellfound', 'hackernews', 'berlinstartupjobs', 'startup.jobs',
  '4dayweek', 'workingnomads', 'landing.jobs',
  'hn-hiring', 'hn-seeking',
]);

const ENTRY_KEYWORDS = /\b(junior|jr\b|entry|entry.level|graduate|new.?grad|early.?career|intern|internship|trainee|apprentice)\b/i;
const MID_KEYWORDS = /\b(mid\b|mid.level|intermediate)\b/i;
const SENIOR_KEYWORDS = /\b(senior|sr\b|staff\b|principal|lead\b|architect|head\s+of|director|vp\b|vice.?president|manager|principal)\b/i;

function computeScore(title: string, description?: string): number {
  const text = title + ' ' + (description ?? '');

  if (ENTRY_KEYWORDS.test(text)) {
    // Entry/intern has highest priority
    if (/\bintern\b/i.test(text)) return 100;
    return 90;
  }
  if (MID_KEYWORDS.test(text)) return 70;
  if (SENIOR_KEYWORDS.test(text)) return 30;

  // No clear signal — default to mid-ish
  return 60;
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

export function formatJob(job: CollatedJob): string {
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
  const score = computeScore(job.title ?? '', job.payload_json);
  const label = scoreLabel(score);

  const lines: string[] = [];
  lines.push(`<b>${title}</b>`);
  if (company) lines.push(escapeHtml(`@ ${company}`));
  if (date) lines.push(`📅 ${date}`);
  lines.push(escapeHtml(`📍 ${location}`));
  lines.push(`🏆 Fit: ${label} ${score}/100`);
  if (isStartup) lines.push(`🚀 Startup / seed`);
  lines.push('');
  lines.push(`<a href="${escapeHtml(url)}">Apply / view</a>`);
  lines.push('');
  lines.push(escapeHtml(`via ${site}`));

  return lines.join('\n');
}

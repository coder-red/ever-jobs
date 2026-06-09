import { CollatedJob } from './types';

const STARTUP_SITES = new Set([
  'wellfound', 'hackernews', 'berlinstartupjobs', 'startup.jobs',
  '4dayweek', 'workingnomads', 'landing.jobs',
]);

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatDate(raw: string | null): string {
  if (!raw) return '';
  // raw is YYYY-MM-DD
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

  const lines: string[] = [];
  lines.push(`<b>${title}</b>`);
  if (company) lines.push(escapeHtml(`@ ${company}`));
  if (date) lines.push(`📅 ${date}`);
  lines.push(escapeHtml(`📍 ${location}`));
  if (isStartup) lines.push(`🚀 Startup / seed`);
  lines.push('');
  lines.push(`<a href="${escapeHtml(url)}">Apply / view</a>`);
  lines.push('');
  lines.push(escapeHtml(`via ${site}`));

  return lines.join('\n');
}

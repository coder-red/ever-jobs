import { CollatedJob } from './types';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

  const lines: string[] = [];
  lines.push(`<b>${title}</b>`);
  if (company) lines.push(escapeHtml(`@ ${company}`));
  lines.push(escapeHtml(`📍 ${location}`));
  lines.push('');
  lines.push(`<a href="${escapeHtml(url)}">Apply / view</a>`);
  lines.push('');
  lines.push(escapeHtml(`via ${site}`));

  return lines.join('\n');
}

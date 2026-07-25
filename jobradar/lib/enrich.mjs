/**
 * Enrichment pass — runs on the MATCHED set only (a few dozen pages, not the
 * full 1,600).
 *
 * Two things the feeds don't give us and that decide whether a lead is worth
 * your time:
 *
 *   liveness  — Jobberman listing pages 404 or say "expired" while still being
 *               served in search results. 8/8 were dead on the first eval.
 *   real date — MyJobMag carries no date in its listing, but every job page
 *               states `Posted: <date>`. Without it a 78-day-old post scored
 *               identically to one from this morning.
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const strip = (h) =>
  h.replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

const DEAD_MARKER =
  /(page not found|404 not found|no longer (?:available|accepting)|this job (?:has )?(?:expired|closed)|job (?:has )?expired|position (?:has been )?filled|job not found|vacancy (?:has )?expired|listing (?:has )?(?:expired|been removed))/i;

/** `Posted: Jul 1, 2026` (MyJobMag), JSON-LD datePosted, or a generic form. */
function extractPosted(text, html) {
  const ld = html.match(/"datePosted"\s*:\s*"([^"]+)"/i);
  if (ld) { const t = Date.parse(ld[1]); if (!Number.isNaN(t)) return new Date(t).toISOString(); }

  const m = text.match(new RegExp(`\\bPosted:?\\s*((?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s*\\d{4})`, 'i'))
    ?? text.match(new RegExp(`\\bPosted(?:\\s+on)?:?\\s*(\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\.?,?\\s*\\d{4})`, 'i'));
  if (m) { const t = Date.parse(m[1]); if (!Number.isNaN(t)) return new Date(t).toISOString(); }

  const rel = text.match(/\bposted\s+(\d+)\s+(hour|day|week|month)s?\s+ago/i);
  if (rel) {
    const n = Number(rel[1]);
    const ms = { hour: 3.6e6, day: 8.64e7, week: 6.048e8, month: 2.592e9 }[rel[2].toLowerCase()];
    return new Date(Date.now() - n * ms).toISOString();
  }
  return null;
}

/** `Deadline: Aug 15, 2026`. "Not specified" is common and means no deadline. */
function extractDeadline(text) {
  const m = text.match(new RegExp(`\\bDeadline:?\\s*((?:${MONTHS})[a-z]*\\.?\\s+\\d{1,2},?\\s*\\d{4})`, 'i'))
    ?? text.match(new RegExp(`\\b(?:deadline|closing date|closes on|apply before):?\\s*(\\d{1,2}\\s+(?:${MONTHS})[a-z]*\\.?,?\\s*\\d{4})`, 'i'));
  if (!m) return null;
  const t = Date.parse(m[1]);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function inspect(job) {
  const res = { live: 'unknown', postedAt: job.postedAt ?? null, deadline: null, http: null };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 25_000);
    const r = await fetch(job.url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: ctl.signal });
    clearTimeout(timer);
    res.http = r.status;

    // 403/429 are anti-bot responses, not evidence the job is gone. Jobicy
    // blocks scrapers while its API happily serves the same listing.
    if (r.status === 403 || r.status === 429) { res.live = 'unknown'; return res; }
    if (r.status === 404 || r.status === 410) { res.live = 'dead'; return res; }
    if (!r.ok) { res.live = 'unknown'; return res; }

    const html = await r.text();
    const text = strip(html);
    if (DEAD_MARKER.test(text)) { res.live = 'dead'; return res; }

    res.live = 'live';
    res.postedAt = extractPosted(text, html) ?? res.postedAt;
    res.deadline = extractDeadline(text);
  } catch {
    res.live = 'unknown';
  }
  return res;
}

/**
 * Fetch each job's page with bounded concurrency and merge what we learn.
 * Never throws — an unreachable page yields `live: 'unknown'` and the job is
 * kept, since being unable to check is not evidence of being closed.
 */
export async function enrich(jobs, { concurrency = 6, onProgress } = {}) {
  const out = new Array(jobs.length);
  const queue = [...jobs.entries()];
  let done = 0;

  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const [i, job] = next;
      const info = await inspect(job);
      out[i] = { ...job, ...info, enriched: true };
      onProgress?.(++done, jobs.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return out;
}

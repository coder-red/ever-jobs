/**
 * Source fetchers. Every source is no-auth, no-Playwright, no-browser — plain
 * JSON or RSS over HTTPS. Each one fails soft: one dead source must never take
 * down a run (allSettled, never all).
 *
 * Normalized job shape:
 *   { id, title, company, location, url, description, postedAt, salary,
 *     source, locationRestrictions?: string[] }
 */

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';

const TIMEOUT_MS = 30_000;

async function req(url, { json = true, headers = {} } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: json ? 'application/json,*/*' : 'text/html,application/xml,*/*', ...headers },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json ? await res.json() : await res.text();
  } finally {
    clearTimeout(timer);
  }
}

const strip = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const decode = (s) =>
  String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&apos;|&#x27;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#x2F;/g, '/').replace(/&hellip;/g, '…').replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

/** Minimal RSS <item> extractor — enough for the feeds we consume. */
function parseRss(xml) {
  const out = [];
  for (const chunk of xml.split(/<item[\s>]/i).slice(1)) {
    const pick = (tag) => {
      const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
      return m ? decode(m[1]).trim() : '';
    };
    const link = pick('link') || pick('guid');
    if (!link) continue;
    out.push({
      title: pick('title'),
      link,
      description: strip(pick('description')),
      pubDate: pick('pubDate'),
      category: pick('category'),
    });
  }
  return out;
}

const iso = (d) => {
  if (!d) return null;
  const t = typeof d === 'number' ? new Date(d * (d > 1e12 ? 1 : 1000)) : new Date(d);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
};

// ============================================================ INTERNATIONAL

/**
 * These boards' bare endpoints return the newest ~100 postings of ANY kind —
 * sampling them yields almost no AI/ML. Always query by keyword/tag instead.
 */
const AI_TERMS = [
  'machine learning', 'ai engineer', 'artificial intelligence',
  'data scientist', 'deep learning', 'mlops', 'llm', 'computer vision', 'nlp',
];
const AI_TAGS = ['machine-learning', 'ai', 'artificial-intelligence', 'data-science', 'deep-learning', 'nlp', 'llm'];

async function remoteok() {
  const all = [];
  const seen = new Set();
  for (const tag of AI_TAGS) {
    let raw;
    try { raw = await req(`https://remoteok.com/api?tag=${tag}`); } catch { continue; }
    for (const j of raw) {
      if (!j || !j.id || !j.position || seen.has(j.id)) continue;
      seen.add(j.id);
      all.push({
        id: `remoteok:${j.id}`,
        title: decode(j.position),
        company: decode(j.company ?? ''),
        location: decode(j.location || (Array.isArray(j.tags) && j.tags.includes('digital nomad') ? 'Worldwide' : '')),
        url: j.url || `https://remoteok.com/remote-jobs/${j.slug}`,
        description: `${strip(decode(j.description ?? ''))} ${(j.tags ?? []).join(' ')}`,
        postedAt: iso(j.date ?? j.epoch),
        salary: j.salary_min ? `$${j.salary_min}–$${j.salary_max}` : null,
        source: 'remoteok',
      });
    }
  }
  return all;
}

async function remotive() {
  const all = [];
  for (const term of AI_TERMS) {
    let r;
    try { r = await req(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=100`); } catch { continue; }
    for (const j of r.jobs ?? []) {
      all.push({
        id: `remotive:${j.id}`,
        title: decode(j.title),
        company: decode(j.company_name ?? ''),
        location: decode(j.candidate_required_location ?? ''),
        url: j.url,
        description: strip(decode(j.description ?? '')),
        postedAt: iso(j.publication_date),
        salary: j.salary || null,
        source: 'remotive',
        // Remotive states eligibility directly — treat it as structured truth.
        locationRestrictions: /worldwide|anywhere/i.test(j.candidate_required_location ?? '')
          ? []
          : [j.candidate_required_location].filter(Boolean),
      });
    }
  }
  return all;
}

/** Placeholder company values that mean "missing", not a real employer name. */
const BOGUS_COMPANY = /^(name|company|companyname|n\/?a|null|undefined|-|unknown)$/i;

const slugToName = (slug) => String(slug ?? '')
  .split(/[-_]/).filter(Boolean)
  .map((w) => (w.length <= 3 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
  .join(' ');

function himalayasCompany(j) {
  const raw = decode(j.companyName ?? '').trim();
  if (raw && !BOGUS_COMPANY.test(raw)) return raw;
  if (j.companySlug) return slugToName(j.companySlug);
  const m = String(j.guid ?? '').match(/himalayas\.app\/companies\/([^/]+)/);
  return m ? slugToName(m[1]) : '';
}

async function himalayas() {
  const all = [];
  const seen = new Set();
  // The API caps `limit` at 20 no matter what you ask for, so paginate in 20s.
  // Requesting limit=100&offset=100 silently returned the same 20 rows.
  for (let offset = 0; offset <= 500; offset += 20) {
    let r;
    try { r = await req(`https://himalayas.app/jobs/api?limit=20&offset=${offset}`); } catch { break; }
    const jobs = r.jobs ?? [];
    if (!jobs.length) break;
    for (const j of jobs) {
      const key = j.guid ?? j.applicationLink;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      all.push({
        id: `himalayas:${j.guid ?? j.applicationLink}`,
        title: decode(j.title ?? ''),
        // Himalayas currently serves the literal string "name" in companyName
        // for every row (their bug). companySlug is correct, so prefer it and
        // fall back to the slug in the job URL.
        company: himalayasCompany(j),
        location: (j.locationRestrictions ?? []).join(', ') || 'Remote',
        url: j.applicationLink ?? j.guid,
        description: `${strip(decode(j.description ?? j.excerpt ?? ''))} ${(j.seniority ?? []).join(' ')} ${(j.categories ?? []).join(' ')}`,
        postedAt: iso(j.pubDate),
        salary: j.minSalary ? `${j.minSalary}–${j.maxSalary} ${j.currency ?? ''}`.trim() : null,
        source: 'himalayas',
        locationRestrictions: j.locationRestrictions ?? [],
      });
    }
  }
  return all;
}

async function jobicy() {
  // NOTE: geo=anywhere is rejected by the API (400) — omit geo for global results.
  const queries = [
    'tag=machine+learning', 'tag=artificial+intelligence', 'tag=data+science',
    'tag=python', 'geo=emea&tag=machine+learning', 'industry=engineering',
  ];
  const all = [];
  const seen = new Set();
  for (const q of queries) {
    let r;
    try { r = await req(`https://jobicy.com/api/v2/remote-jobs?count=50&${q}`); } catch { continue; }
    for (const j of r.jobs ?? []) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      all.push({
        id: `jobicy:${j.id}`,
        title: decode(j.jobTitle ?? ''),
        company: decode(j.companyName ?? ''),
        location: decode(j.jobGeo ?? ''),
        url: j.url,
        description: `${strip(decode(j.jobDescription ?? j.jobExcerpt ?? ''))} ${(j.jobLevel ?? '')}`,
        postedAt: iso(j.pubDate),
        salary: j.annualSalaryMin ? `${j.annualSalaryMin}–${j.annualSalaryMax} ${j.salaryCurrency ?? ''}`.trim() : null,
        source: 'jobicy',
      });
    }
  }
  return all;
}

/**
 * Arbeitnow — Europe/Germany board, and the single best source of explicitly
 * visa-sponsored roles. The `visa_sponsorship=true` feed is queried first and
 * its results are tagged so the scorer can credit the visa/relocation route.
 */
async function arbeitnow() {
  const all = [];
  const seen = new Set();
  const feeds = [
    { q: 'visa_sponsorship=true', visa: true },
    { q: 'visa_sponsorship=true&page=2', visa: true },
    { q: 'page=1', visa: false },
    { q: 'page=2', visa: false },
    { q: 'page=3', visa: false },
  ];
  for (const { q, visa } of feeds) {
    let r;
    try { r = await req(`https://www.arbeitnow.com/api/job-board-api?${q}`); } catch { continue; }
    for (const j of r.data ?? []) {
      if (seen.has(j.slug)) continue;
      seen.add(j.slug);
      const tags = [...(j.tags ?? []), ...(j.job_types ?? [])].join(' ');
      const sponsored = visa || j.visa_sponsorship === true;
      all.push({
        id: `arbeitnow:${j.slug}`,
        title: decode(j.title ?? ''),
        company: decode(j.company_name ?? ''),
        location: decode(j.location ?? ''),
        url: j.url,
        description: `${strip(decode(j.description ?? ''))} ${tags}${sponsored ? ' visa sponsorship available relocation support' : ''}`,
        postedAt: iso(j.created_at),
        salary: null,
        source: 'arbeitnow',
      });
    }
  }
  return all;
}

/**
 * Company ATS boards — the actual employer's posting, not a board's stale copy.
 * No aggregator lag, no repost farms, and the description is the real one.
 *
 * Tokens were probed for a live response; dead ones are omitted rather than
 * left to fail every run. Add a company by finding its board token:
 *   Greenhouse  boards-api.greenhouse.io/v1/boards/<token>/jobs
 *   Lever       api.lever.co/v0/postings/<token>?mode=json
 *   Ashby       api.ashbyhq.com/posting-api/job-board/<token>
 */
const ATS = [
  // remote-first / hire-worldwide employers
  ['greenhouse', 'gitlab'], ['greenhouse', 'canonical'], ['greenhouse', 'remotecom'],
  ['greenhouse', 'grafanalabs'], ['greenhouse', 'elastic'], ['greenhouse', 'mozilla'],
  ['greenhouse', 'vercel'], ['greenhouse', 'clickhouse'],
  // Africa / Nigeria employers
  ['greenhouse', 'moniepoint'], ['greenhouse', 'jumia'], ['greenhouse', 'carbon'],
  ['ashby', 'andela'],
  // AI-native
  ['ashby', 'cohere'], ['ashby', 'linear'], ['ashby', 'vanta'], ['ashby', 'resend'],
  ['lever', 'toptal'],
];

const ATS_URL = {
  greenhouse: (t) => `https://boards-api.greenhouse.io/v1/boards/${t}/jobs?content=true`,
  lever: (t) => `https://api.lever.co/v0/postings/${t}?mode=json`,
  ashby: (t) => `https://api.ashbyhq.com/posting-api/job-board/${t}?includeCompensation=true`,
};

function atsNormalize(kind, token, raw) {
  if (kind === 'greenhouse') {
    return (raw.jobs ?? []).map((j) => ({
      id: `gh:${token}:${j.id}`,
      title: decode(j.title ?? ''),
      company: token,
      location: decode(j.location?.name ?? ''),
      url: j.absolute_url,
      description: strip(decode(j.content ?? '')),
      postedAt: iso(j.updated_at ?? j.first_published),
      salary: null,
      source: `ats:${token}`,
    }));
  }
  if (kind === 'lever') {
    return (raw ?? []).map((j) => ({
      id: `lv:${token}:${j.id}`,
      title: decode(j.text ?? ''),
      company: token,
      location: decode(j.categories?.location ?? ''),
      url: j.hostedUrl,
      description: strip(decode(j.descriptionPlain ?? j.description ?? '')),
      postedAt: iso(j.createdAt),
      salary: null,
      source: `ats:${token}`,
    }));
  }
  // ashby
  return (raw.jobs ?? []).map((j) => ({
    id: `ab:${token}:${j.id ?? j.jobUrl}`,
    title: decode(j.title ?? ''),
    company: token,
    location: decode(j.location ?? (j.isRemote ? 'Remote' : '')),
    url: j.jobUrl ?? j.applyUrl,
    description: strip(decode(j.descriptionPlain ?? j.descriptionHtml ?? '')),
    postedAt: iso(j.publishedAt ?? j.updatedAt),
    salary: null,
    source: `ats:${token}`,
  }));
}

async function ats() {
  const settled = await Promise.allSettled(
    ATS.map(async ([kind, token]) => atsNormalize(kind, token, await req(ATS_URL[kind](token)))),
  );
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((j) => j.url && j.title);
}

/** Working Nomads — remote-only aggregator, strong on worldwide-eligible roles. */
async function workingnomads() {
  const raw = await req('https://www.workingnomads.com/api/exposed_jobs/');
  return (raw ?? []).map((j) => ({
    id: `workingnomads:${j.url}`,
    title: decode(j.title ?? ''),
    company: decode(j.company_name ?? ''),
    location: decode(j.location ?? ''),
    url: j.url,
    description: `${strip(decode(j.description ?? ''))} ${j.tags ?? ''} ${j.category_name ?? ''}`,
    postedAt: iso(j.pub_date),
    salary: null,
    source: 'workingnomads',
  }));
}

async function weworkremotely() {
  const feeds = [
    'https://weworkremotely.com/categories/remote-programming-jobs.rss',
    'https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss',
  ];
  const all = [];
  for (const f of feeds) {
    const xml = await req(f, { json: false });
    for (const it of parseRss(xml)) {
      const [company, ...rest] = it.title.split(':');
      all.push({
        id: `wwr:${it.link}`,
        title: (rest.join(':') || it.title).trim(),
        company: rest.length ? company.trim() : '',
        location: (it.description.match(/\b(Anywhere in the World|Worldwide|EMEA|Europe|Africa)\b/i) ?? [''])[0],
        url: it.link,
        description: it.description,
        postedAt: iso(it.pubDate),
        salary: null,
        source: 'weworkremotely',
      });
    }
  }
  return all;
}

// ================================================================== NIGERIA

async function hotnigerianjobs() {
  const xml = await req('https://www.hotnigerianjobs.com/feed/', { json: false });
  return parseRss(xml).map((it) => {
    const m = it.title.match(/^(.*?)\s+at\s+(.+)$/i);
    return {
      id: `hnj:${it.link}`,
      title: (m ? m[1] : it.title).trim(),
      company: (m ? m[2] : '').trim(),
      location: `Nigeria ${(it.description.match(/located in ([A-Za-z ]+State)/i) ?? ['', ''])[1]}`.trim(),
      url: it.link,
      description: it.description,
      postedAt: iso(it.pubDate),
      salary: null,
      source: 'hotnigerianjobs',
    };
  });
}

async function myjobmag() {
  const all = [];
  for (const q of ['machine+learning', 'artificial+intelligence', 'data+scientist', 'ai+engineer', 'data+analyst']) {
    const html = await req(`https://www.myjobmag.com/search/jobs?q=${q}`, { json: false });
    const re = /<h2[^>]*>\s*<a[^>]+href="(\/job\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(html))) {
      const title = decode(strip(m[2]));
      if (!title) continue;
      all.push({
        id: `myjobmag:${m[1]}`,
        title,
        company: '',
        location: 'Nigeria',
        url: `https://www.myjobmag.com${m[1]}`,
        description: `${title} Nigeria`,
        postedAt: null,
        salary: null,
        source: 'myjobmag',
      });
    }
  }
  return all;
}

async function jobberman() {
  const all = [];
  for (const q of ['machine-learning', 'artificial-intelligence', 'data-scientist', 'ai-engineer']) {
    const html = await req(`https://www.jobberman.com/jobs?q=${q}`, { json: false });
    const re = /href="(https:\/\/www\.jobberman\.com\/listings\/[^"]+)"[^>]*>([\s\S]{0,300}?)<\/a>/gi;
    let m;
    const seen = new Set();
    while ((m = re.exec(html))) {
      const url = m[1].split('?')[0];
      if (seen.has(url)) continue;
      seen.add(url);
      const title = decode(strip(m[2])).slice(0, 120);
      if (!title || title.length < 4) continue;
      all.push({
        id: `jobberman:${url}`,
        title,
        company: '',
        location: 'Nigeria',
        url,
        description: `${title} Nigeria`,
        postedAt: null,
        salary: null,
        source: 'jobberman',
      });
    }
  }
  return all;
}

// ==================================================================== registry

export const SOURCES = {
  remoteok, remotive, himalayas, jobicy, arbeitnow, weworkremotely, workingnomads, ats,
  hotnigerianjobs, myjobmag, jobberman,
};

/**
 * Fetch every enabled source concurrently. Never throws — a failed source is
 * reported in `errors` and the run continues.
 */
export async function fetchAll(enabled = Object.keys(SOURCES)) {
  const names = enabled.filter((n) => SOURCES[n]);
  const settled = await Promise.allSettled(names.map((n) => SOURCES[n]()));

  const jobs = [];
  const stats = {};
  const errors = [];

  settled.forEach((r, i) => {
    const name = names[i];
    if (r.status === 'fulfilled') {
      const list = (r.value ?? []).filter((j) => j && j.url && j.title);
      stats[name] = list.length;
      jobs.push(...list);
    } else {
      stats[name] = 0;
      errors.push(`${name}: ${r.reason?.message ?? r.reason}`);
    }
  });

  return { jobs, stats, errors };
}

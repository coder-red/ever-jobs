#!/usr/bin/env ts-node
/**
 * Social Discovery — LLM-powered search for AI/ML Engineer hiring signals + vibe coder gigs
 * across social media platforms and the open web.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... npx tsx scripts/social-discovery.ts
 *
 * Output: Appends to data/collector.json (same format as collector app)
 */

import * as fs from 'fs';
import * as path from 'path';

// ── Configuration ──────────────────────────────────────────────────────────────

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const DATA_PATH = process.env.SOCIAL_DATA_PATH || './data/collector.json';

const SOCIAL_QUERIES = [
  // Twitter / X
  'site:twitter.com "hiring" "AI" "engineer" since:3d',
  'site:twitter.com "looking for" "ML engineer" since:3d',
  'site:twitter.com "vibe coder" since:3d',
  'site:x.com "hiring" "AI engineer" since:3d',
  'site:x.com "vibe coder" since:3d',
  // Reddit
  'site:reddit.com "hiring" "AI engineer" entry level since:3d',
  'site:reddit.com "vibe coder" since:3d',
  'site:reddit.com "ML engineer" "looking for" since:3d',
  // LinkedIn
  'site:linkedin.com/posts "hiring" "AI engineer" since:3d',
  'site:linkedin.com/posts "ML engineer" since:3d',
  // Hacker News
  'site:news.ycombinator.com "AI engineer" since:3d',
  'site:news.ycombinator.com "ML engineer" since:3d',
  'site:news.ycombinator.com "vibe coder" since:3d',
  // Bluesky
  'site:bsky.app "hiring" "AI engineer" since:3d',
  'site:bsky.app "vibe coder" since:3d',
  // General web
  '"looking for a vibe coder" since:3d',
  '"hiring vibe coders" since:3d',
  '"AI/ML engineer" "remote" entry level since:3d',
  '"AI engineer" "entry level" remote since:3d',
];

const DDG_URL = 'https://html.duckduckgo.com/html';
const MAX_RESULTS_PER_QUERY = 10;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── Types ──────────────────────────────────────────────────────────────────────

interface SocialPost {
  url: string;
  title: string;
  author: string | null;
  platform: string;
  description: string | null;
  datePosted: string | null;
  roleType: 'ai-engineer-job' | 'ml-engineer-job' | 'vibe-coder-gig' | null;
  contactInfo: string | null;
  companyName: string | null;
}

interface CollectorJob {
  id: number;
  job_url: string;
  title: string;
  company_name: string | null;
  site: string;
  is_remote: number;
  location: string | null;
  date_posted: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload_json: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function detectPlatform(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes('twitter.com') || host.includes('x.com')) return 'twitter';
  if (host.includes('reddit.com')) return 'reddit';
  if (host.includes('linkedin.com')) return 'linkedin';
  if (host.includes('news.ycombinator.com') || host.includes('hn.algolia.com')) return 'hackernews';
  if (host.includes('bsky.app')) return 'bluesky';
  if (host.includes('mastodon')) return 'mastodon';
  return 'web';
}

function extractDomain(url: string): string {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    return host.split('.')[0];
  } catch {
    return 'unknown';
  }
}

// ── DuckDuckGo Search ──────────────────────────────────────────────────────────

async function searchDuckDuckGo(query: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const params = new URLSearchParams({ q: query });
  const res = await fetch(`${DDG_URL}?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    throw new Error(`DDG HTTP ${res.status}`);
  }

  const html = await res.text();
  const cheerio = await import('cheerio');
  const $ = cheerio.load(html);
  const results: Array<{ url: string; title: string; snippet: string }> = [];

  $('.result').each((_: number, el: any) => {
    if (results.length >= MAX_RESULTS_PER_QUERY) return false;

    const linkEl = $(el).find('.result__a');
    const url = linkEl.attr('href') || '';
    const title = linkEl.text().trim();
    const snippet = $(el).find('.result__snippet').text().trim();

    const actualUrl = extractDdgUrl(url);
    if (actualUrl && title) {
      results.push({ url: actualUrl, title, snippet });
    }
  });

  return results;
}

function extractDdgUrl(redirectUrl: string): string | null {
  try {
    const u = new URL(redirectUrl);
    const redirectParam = u.searchParams.get('uddg');
    if (redirectParam) return redirectParam;
    return redirectUrl;
  } catch {
    return null;
  }
}

// ── Fetch Page ─────────────────────────────────────────────────────────────────

async function fetchPageContent(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return null;
    }

    const html = await res.text();
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);

    // Remove scripts, styles, nav
    $('script, style, nav, header, footer, iframe, noscript').remove();

    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return text.slice(0, 4000);
  } catch {
    return null;
  }
}

// ── LLM Classification ─────────────────────────────────────────────────────────

async function classifyPost(
  url: string,
  title: string,
  content: string,
): Promise<SocialPost | null> {
  const prompt = `You are a job-hunting assistant. Classify this web page content as a hiring signal or not.

Categories:
- "ai-engineer-job" — A job posting or hiring call for an AI Engineer role
- "ml-engineer-job" — A job posting or hiring call for an ML Engineer role  
- "vibe-coder-gig" — Someone looking for a "vibe coder" (AI-assisted builder) for a project/startup
- null — Not a hiring signal for AI/ML Engineer or vibe coder (ignore)

If it IS a hiring signal, extract these fields:
- title: The job title or role being offered/sought
- companyName: The company or project name
- author: The person who posted it
- description: Key details (up to 500 chars)
- datePosted: Date found in the post (ISO format if possible, otherwise null)
- contactInfo: Email, URL, or "DM" for how to apply

URL: ${url}
Title: ${title}
Content: ${content.slice(0, 3000)}

Return JSON: {
  "category": "ai-engineer-job" | "ml-engineer-job" | "vibe-coder-gig" | null,
  "title": string | null,
  "companyName": string | null,
  "author": string | null,
  "description": string | null,
  "datePosted": string | null,
  "contactInfo": string | null
}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/ever-jobs',
      'X-Title': 'Ever Jobs Social Discovery',
    },
    body: JSON.stringify({
      model: 'qwen3-235b-a22b:free',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 300,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[social] LLM error ${res.status}: ${errText.slice(0, 200)}`);
    return null;
  }

  const data: any = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[social] LLM JSON parse failed: ${raw.slice(0, 200)}`);
    return null;
  }

  if (!parsed.category) return null;

  const platform = detectPlatform(url);

  return {
    url,
    title: parsed.title || title.slice(0, 200),
    author: parsed.author || null,
    platform,
    description: parsed.description || null,
    datePosted: parsed.datePosted || null,
    roleType: parsed.category,
    contactInfo: parsed.contactInfo || null,
    companyName: parsed.companyName || null,
  };
}

// ── Store ──────────────────────────────────────────────────────────────────────

function loadCollectorStore(filePath: string): { next_id: number; jobs: Record<string, CollectorJob>; runs: any[] } {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { next_id: 1, jobs: {}, runs: [] };
  }
}

function saveCollectorStore(filePath: string, store: any): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, filePath);
}

function upsertPost(
  store: { next_id: number; jobs: Record<string, CollectorJob>; runs: any[] },
  post: SocialPost,
): { inserted: boolean } {
  const normalizedUrl = post.url.toLowerCase().replace(/[#?].*$/, '');
  const existing = store.jobs[normalizedUrl];
  const now = new Date().toISOString();

  if (existing) {
    existing.last_seen_at = now;
    return { inserted: false };
  }

  const payload = {
    title: post.title,
    companyName: post.companyName,
    author: post.author,
    platform: post.platform,
    description: post.description,
    contactInfo: post.contactInfo,
    roleType: post.roleType,
    source: 'social-discovery',
  };

  // Determine nice site tag
  const siteTag = `social-${post.platform}`;

  store.jobs[normalizedUrl] = {
    id: store.next_id++,
    job_url: post.url,
    title: post.title,
    company_name: post.companyName || post.author || extractDomain(post.url),
    site: siteTag,
    is_remote: 1,
    location: null,
    date_posted: post.datePosted || now.split('T')[0],
    first_seen_at: now,
    last_seen_at: now,
    payload_json: JSON.stringify(payload),
  };

  return { inserted: true };
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[social] Starting social discovery...');
  console.log(`[social] ${SOCIAL_QUERIES.length} queries configured`);

  if (!OPENROUTER_API_KEY) {
    console.error('[social] ERROR: OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  const store = loadCollectorStore(DATA_PATH);
  let totalInserted = 0;
  let totalClassified = 0;
  const seenUrls = new Set<string>();

  for (let qi = 0; qi < SOCIAL_QUERIES.length; qi++) {
    const query = SOCIAL_QUERIES[qi];
    console.log(`[social] Query ${qi + 1}/${SOCIAL_QUERIES.length}: ${query}`);

    try {
      const results = await searchDuckDuckGo(query);
      console.log(`[social]   → ${results.length} results`);

      for (const result of results) {
        if (seenUrls.has(result.url)) continue;
        seenUrls.add(result.url);

        // Fetch the page
        await sleep(1500 + Math.random() * 1000); // polite delay
        const content = await fetchPageContent(result.url);

        if (!content) {
          console.log(`[social]   ↻ skipped (no content): ${result.url.slice(0, 80)}`);
          continue;
        }

        // Classify with LLM
        await sleep(500 + Math.random() * 500);
        const post = await classifyPost(result.url, result.title, content);

        if (post) {
          totalClassified++;
          const { inserted } = upsertPost(store, post);
          if (inserted) {
            totalInserted++;
            console.log(`[social]   ✓ ${post.roleType}: ${post.title} (${post.platform})`);
          } else {
            console.log(`[social]   ∼ already exists: ${post.title}`);
          }
        } else {
          console.log(`[social]   ✗ not relevant: ${result.title.slice(0, 60)}`);
        }
      }
    } catch (err: any) {
      console.error(`[social]   ✗ query failed: ${err.message}`);
    }

    // Rate limit: 1.5s between queries
    if (qi < SOCIAL_QUERIES.length - 1) {
      await sleep(1500 + Math.random() * 1000);
    }
  }

  // Record run
  store.runs.push({
    batch_name: 'social-discovery',
    fetched: seenUrls.size,
    matched: totalClassified,
    inserted: totalInserted,
    updated: 0,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  });

  saveCollectorStore(DATA_PATH, store);
  console.log(`[social] Done. ${totalInserted} new posts added, ${totalClassified} total classified, ${seenUrls.size} URLs checked`);
}

main().catch((err) => {
  console.error('[social] Fatal:', err);
  process.exit(1);
});

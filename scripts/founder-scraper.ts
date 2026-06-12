#!/usr/bin/env ts-node
import * as fs from 'fs';
import * as path from 'path';

const HN_API = 'https://hn.algolia.com/api/v1';

function isAIRole(text: string): boolean {
  const lower = text.toLowerCase();
  if (/\bai\b.*\b(engineer|developer|co-founder|intern)\b/i.test(lower)) return true;
  if (/\b(machine learning|llm|deep learning|gen ai|generative ai)\b.*\b(engineer|developer|intern)\b/i.test(lower)) return true;
  if (/\b(ml)\b.*\b(engineer|developer|intern)\b/i.test(lower)) return true;
  return false;
}

function extractCompany(text: string): string | null {
  const m = text.match(/^([\w\s.&]+?)\s+[-–|]\s+/);
  if (m && m[1].length < 30) return m[1].trim();
  const m2 = text.match(/^([\w\s.&]+?)\s+(is hiring|hiring|seeking)\b/i);
  if (m2) return m2[1].trim();
  return null;
}

function extractTitleFromComment(text: string): string {
  // HN "Who's hiring" format: "Company | Role | Location | Type"
  // Only split on | with spaces or — surrounded by spaces
  const firstLine = text.split('\n')[0].trim();
  // Try pipe-separated format first
  const pipeParts = firstLine.split(/\s*\|\s*/);
  if (pipeParts.length >= 3) {
    // Second part is usually the role
    const role = pipeParts[1].replace(/<[^>]*>/g, '').trim();
    if (role.length > 2 && role.length < 100) return role;
  }
  if (pipeParts.length === 2) {
    const role = pipeParts[1].replace(/<[^>]*>/g, '').trim();
    if (role.length > 2 && role.length < 100) return role;
  }
  // Strip HTML tags
  const cleaned = firstLine.replace(/<[^>]*>/g, '').trim();
  // Remove "SEEKING FREELANCER" or "SEEKING CO-FOUNDER" prefix
  const deSeeked = cleaned.replace(/^(seeking\s+(freelancer|co-founder|work)\s*\||seeking\s+(freelancer|co-founder|work))/i, '').trim();
  if (deSeeked.length > 10 && deSeeked.length < 120) return deSeeked;
  if (cleaned.length > 10) return cleaned.slice(0, 100);
  return 'HN Hiring: AI/ML role';
}

async function fetchJSON(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ever-jobs/1.0' },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getWhoIsHiringStoryId(): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 60 * 24 * 3600;
  try {
    const data = await fetchJSON(
      `${HN_API}/search?tags=story,author_whoishiring&query=Ask%20HN%20Who%20is%20hiring&numericFilters=created_at_i>${cutoff}&hitsPerPage=1`,
    );
    return data.hits?.[0]?.objectID ?? null;
  } catch (err) {
    console.error(`[founder] couldn't find whoishiring thread: ${err}`);
    return null;
  }
}

async function getSeekingStoryIds(): Promise<string[]> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 60 * 24 * 3600;
  const ids: string[] = [];
  for (const query of ['Seeking%20freelancer', 'Seeking%20co-founder']) {
    try {
      const data = await fetchJSON(
        `${HN_API}/search?tags=story,author_whoishiring&query=${query}&numericFilters=created_at_i>${cutoff}&hitsPerPage=3`,
      );
      for (const hit of data.hits ?? []) {
        if (!ids.includes(hit.objectID)) ids.push(hit.objectID);
      }
    } catch {}
  }
  return ids;
}

async function scrapeThreadComments(storyId: string, tag: string): Promise<any[]> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - 45 * 24 * 3600; // 45 days to cover monthly threads
  const posts: any[] = [];

  const queries = [
    `tags=comment,story_${storyId}&numericFilters=created_at_i>${cutoff}&query=ai%20engineer&hitsPerPage=50`,
    `tags=comment,story_${storyId}&numericFilters=created_at_i>${cutoff}&query=ml%20engineer&hitsPerPage=50`,
    `tags=comment,story_${storyId}&numericFilters=created_at_i>${cutoff}&query=machine%20learning&hitsPerPage=50`,
    `tags=comment,story_${storyId}&numericFilters=created_at_i>${cutoff}&query=llm%20engineer&hitsPerPage=30`,
    `tags=comment,story_${storyId}&numericFilters=created_at_i>${cutoff}&query=ai%20developer&hitsPerPage=30`,
  ];

  for (const q of queries) {
    try {
      const data = await fetchJSON(`${HN_API}/search?${q}`);
      for (const hit of data.hits ?? []) {
        const title: string = hit.title ?? '';
        const commentText: string = hit.comment_text ?? '';
        const combined = commentText + ' ' + title;
        if (!isAIRole(combined)) continue;
        const url = hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`;
        const jobTitle = extractTitleFromComment(commentText) || title.slice(0, 100);
        posts.push({
          title: jobTitle.slice(0, 250),
          company_name: extractCompany(title) ?? extractCompany(commentText),
          job_url: url,
          site: tag,
          date_posted: new Date(hit.created_at).toISOString().split('T')[0],
          description: commentText.slice(0, 800),
        });
      }
    } catch (err) {
      console.error(`[founder] thread ${storyId} query error: ${err}`);
    }
  }
  return posts;
}

async function main() {
  const seen = new Set<string>();
  const posts: any[] = [];

  // 1. Get "Who is hiring" thread
  const hiringId = await getWhoIsHiringStoryId();
  if (hiringId) {
    console.log(`[founder] found Who's Hiring thread: ${hiringId}`);
    const hiringPosts = await scrapeThreadComments(hiringId, 'hn-hiring');
    for (const p of hiringPosts) {
      if (seen.has(p.job_url)) continue;
      seen.add(p.job_url);
      posts.push(p);
    }
  }

  // 2. Get "Seeking freelancer" and "Seeking co-founder" threads
  const seekingIds = await getSeekingStoryIds();
  for (const sid of seekingIds) {
    console.log(`[founder] found Seeking thread: ${sid}`);
    const seekingPosts = await scrapeThreadComments(sid, 'hn-seeking');
    for (const p of seekingPosts) {
      if (seen.has(p.job_url)) continue;
      seen.add(p.job_url);
      posts.push(p);
    }
  }

  console.log(`[founder] total unique posts: ${posts.length}`);
  const outPath = process.argv[2] || './data/founder_posts.json';
  const output = {
    next_id: posts.length + 1,
    jobs: {} as Record<string, any>,
    runs: [{
      batch_name: 'founder-posts',
      fetched: posts.length,
      matched: posts.length,
      inserted: posts.length,
      updated: 0,
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
    }],
  };

  posts.forEach((p, i) => {
    output.jobs[p.job_url] = {
      id: i + 1,
      job_url: p.job_url,
      title: p.title,
      company_name: p.company_name,
      site: p.site,
      is_remote: 1,
      location: 'Remote',
      date_posted: p.date_posted,
      first_seen_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
      payload_json: JSON.stringify(p),
    };
  });

  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
  console.log(`[founder] wrote ${posts.length} posts to ${outPath}`);
}

main().catch((err) => {
  console.error('[founder] fatal:', err);
  process.exit(1);
});

#!/usr/bin/env ts-node
/**
 * Source Discovery — LLM agent that finds new job sources not yet covered by
 * existing scraper plugins. Outputs a reviewable list of candidate sources.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... npx tsx scripts/discover-sources.ts
 *
 * Output: data/discovered-sources.json
 */

import * as fs from 'fs';
import * as path from 'path';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OUTPUT_PATH = process.env.DISCOVERY_OUTPUT || './data/discovered-sources.json';

const KNOWN_SOURCES = `Job Boards: LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Wellfound, RemoteOK, Remotive, WeWorkRemotely, Himalayas, Jobicy, Arbeitnow, NoDesk, Dice, SimplyHired, CareerBuilder, Monster, StepStone, Naukri, Bayt, BDJobs, Internshala, Upwork
ATS Platforms: Greenhouse, Lever, Ashby, Workday, BambooHR, Personio, JazzHR, Recruitee, TeamTailor, SmartRecruiters, Rippling, iCIMS, Taleo, SAP SuccessFactors, Jobvite, ADP, UKG, BreezyHR, Comeet, Pinpoint, Manatal, Paylocity, Freshteam, Bullhorn, Trakstar, HiringThing, Loxo, Fountain, Deel, Phenom, Eightfold, Workable
Company Career Pages: Google, Meta, Apple, Microsoft, Amazon, Netflix, Nvidia, Stripe, OpenAI, Anthropic, Databricks, Tesla, Uber, Airbnb, Discord, Coinbase, Figma, GitLab, Cloudflare, MongoDB, Dropbox, Pinterest, Lyft, Twitter/X, Reddit, SpaceX, Anduril, Palantir, Datadog, DeepMind, Vercel, Block, Roblox, Duolingo, Klaviyo, Ramp, Brex, Mercury, Deel, Notion, Linear, Supabase, Vercel, Cursor, Heygen, RunPod, Replicate, Fal AI, Together AI, Stability AI, Midjourney, AssemblyAI, Fireworks AI, Figure AI, Inflection AI, Scale AI, Grammarly
Niche/Remote Boards: WorkingNomads, 4DayWeek, VirtualVocations, RealWorkFromAnywhere, RemoteFirstJobs, Jobspresso, FunctionalWorks, PowerToFly, CryptoJobsList, GetOnBoard, HasJob, GermanTechJobs, PyJobs, GoLangJobs
Government/Paid: USAJobs, Adzuna, Reed, Jooble, CareerJet, FindWork, JobDataAPI, AuthenticJobs, Talroo, Arbeitsagentur, JobTechDev, FranceTravail
Social/Community: HackerNews, BuiltIn, EchoJobs, StartupJobs, JoinRise, LandingJobs, BerlinStartupJobs`;

const LLM_PROMPT = `You are a job-source research agent. The system already scrapes from the following known sources:

${KNOWN_SOURCES}

I need you to find NEW job sources that are NOT in this list. Focus on:
1. Niche AI/ML-specific job boards (smaller ones)
2. Regional job boards popular for tech hiring (Europe, Asia, Latin America, Africa)
3. Remote-specific job boards we might have missed
4. Company career pages for notable AI/ML companies not listed
5. Freelance/gig platforms where AI/ML work is posted
6. Developer community job boards
7. Startup job boards
8. Any other legitimate job listing sources for AI/ML Engineer roles

For each candidate source, provide:
- name: Human-readable name
- url: Base URL of the job listing page
- category: "job-board" | "ats" | "company" | "niche" | "government" | "freelance" | "regional" | "community"
- description: Why this source is worth adding (2-3 sentences)
- estimatedListings: Rough estimate of how many AI/ML Engineer listings per month
- difficulty: "easy" (RSS/API), "medium" (HTML scraping), "hard" (JS rendering, auth required)

Return JSON: { "sources": [{ name, url, category, description, estimatedListings, difficulty }] }

Try to find at least 15-20 candidates. Focus on quality over quantity — sources likely to
have real AI/ML Engineer entry-level listings.`;

interface DiscoveredSource {
  name: string;
  url: string;
  category: string;
  description: string;
  estimatedListings: number;
  difficulty: string;
}

async function main() {
  console.log('[discover] Starting source discovery...');
  console.log(`[discover] Using known sources across ${KNOWN_SOURCES.split('\n').length} categories`);

  if (!OPENROUTER_API_KEY) {
    console.error('[discover] ERROR: OPENROUTER_API_KEY not set');
    process.exit(1);
  }

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://github.com/ever-jobs',
      'X-Title': 'Ever Jobs Source Discovery',
    },
    body: JSON.stringify({
      model: 'qwen3-235b-a22b:free',
      messages: [{ role: 'user', content: LLM_PROMPT }],
      response_format: { type: 'json_object' },
      temperature: 0.3,
      max_tokens: 2000,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.error(`[discover] LLM error ${res.status}: ${err.slice(0, 300)}`);
    process.exit(1);
  }

  const data: any = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';

  let parsed: { sources: DiscoveredSource[] };
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[discover] LLM returned invalid JSON: ${raw.slice(0, 500)}`);
    process.exit(1);
  }

  const sources = parsed.sources || [];
  console.log(`[discover] LLM suggested ${sources.length} candidate sources\n`);

  // Write output
  const dir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const output = {
    generatedAt: new Date().toISOString(),
    total: sources.length,
    sources: sources.map((s, i) => ({ id: i + 1, ...s })),
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  console.log(`[discover] Report written to ${OUTPUT_PATH}\n`);

  // Summary
  const byCategory: Record<string, number> = {};
  const byDifficulty: Record<string, number> = {};
  for (const s of sources) {
    byCategory[s.category] = (byCategory[s.category] || 0) + 1;
    byDifficulty[s.difficulty] = (byDifficulty[s.difficulty] || 0) + 1;
  }

  console.log('=== Category breakdown ===');
  for (const [cat, count] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${count}`);
  }

  console.log('\n=== Difficulty breakdown ===');
  for (const [diff, count] of Object.entries(byDifficulty).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${diff}: ${count}`);
  }

  console.log('\n=== Candidate sources ===');
  sources.forEach((s, i) => {
    console.log(`  ${i + 1}. ${s.name} (${s.category}, ${s.difficulty})`);
    console.log(`     ${s.url}`);
    console.log(`     ${s.description.slice(0, 150)}`);
    console.log('');
  });

  console.log('[discover] Done. Review the candidates and create scraper plugins for the ones you want.');
}

main().catch((err) => {
  console.error('[discover] Fatal:', err);
  process.exit(1);
});

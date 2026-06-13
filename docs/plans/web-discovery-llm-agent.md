# Web Discovery — LLM-Powered Job Search Agent

Find jobs that your 130+ scrapers miss by searching the open web with an LLM.

## Problem

The existing pipeline covers major ATS platforms (Greenhouse, Lever, Ashby, Workday, etc.) and known job boards, but misses:
- Small niche AI/ML job boards
- Company career pages that don't use a standard ATS
- Direct postings on random sites
- New/unusual sources that don't fit a scraper pattern

## Architecture (Zero Cost)

```
GHA workflow (daily or every 12h)
│
├─ 1. LLM generates diverse search queries
├─ 2. DuckDuckGo search (free, no API key)
├─ 3. Fetch each result page
├─ 4. LLM classifies + extracts job data from HTML
├─ 5. Pass through existing matchesPersona filter
└─ 6. Upsert into collector store → triggers Telegram notification
```

### Stack

| Component | Tool | Cost |
|---|---|---|
| Search engine | DuckDuckGo (html.duckduckgo.com) | Free — no API key, no ToS restrictions |
| LLM inference | OpenRouter free tier (`qwen3-235b-a22b:free` or `llama-3.3-70b-instruct:free`) | Free — 20 RPM, 50 RPD, no credit card |
| Runtime | GitHub Actions | Free — 2000 min/month |
| HTTP fetching | Built-in `fetch` (Node 18+) | Free |

## How It Works

### Step 1 — Query Generation (LLM)

The LLM generates 10–15 diverse search queries targeting sites not already covered.

**Input prompt:**
```
You are a job search agent. Generate 10 diverse DuckDuckGo search
queries to find AI/ML Engineer remote entry-level jobs that our 130+
scrapers might miss. Focus on:
- Small niche job boards (ai-jobs, ml-jobs, etc.)
- Company career pages (site:company.com/careers)
- Remote-specific boards not in our list
- International sources
- Site-specific searches (site:workable.com, site:breezy.hr, etc.)

Use operators: site:, intitle:, "exact phrase", -exclude

Return as a JSON array of strings.
```

**Example output:**
```json
[
  "site:workable.com \"AI engineer\" remote entry level",
  "site:breezy.hr \"machine learning\" remote junior",
  "\"AI/ML engineer\" remote -senior -staff",
  "intitle:\"ML engineer\" intitle:remote entry level -senior",
  "site:ai-jobs.net remote engineer",
  "\"MLE\" remote \"entry level\" hiring",
  "site:greenhouse.io \"machine learning\" \"entry level\"",
  "site:linkedin.com \"AI Engineer\" remote entry level -senior",
  "site:lever.co \"AI\" engineer intern remote",
  "site:indeed.com \"machine learning engineer\" entry level remote"
]
```

### Step 2 — DuckDuckGo Search

For each query:
```
GET https://html.duckduckgo.com/html/?q=<encoded query>&t=h_
```

Parse HTML response with `JSDOM`, extract all result links.
Deduplicate by URL. Filter out known domains (already scraped sites).
Collect ~200–400 unique URLs per run.

**Already-scraped domains to skip (to avoid double work):**
```
linkedin.com, indeed.com, glassdoor.com, ziprecruiter.com,
greenhouse.io, lever.co, ashbyhq.com, workable.com,
remoteok.com, remotive.com, wellfound.com, himalayas.app,
and all others in the Site enum
```

### Step 3 — Fetch Each Page

Simple `fetch(url)` with 10s timeout and a polite `User-Agent`.

Skip non-HTML content (PDFs, images, etc.).

### Step 4 — LLM Classification + Extraction

For each page, pass the raw HTML text (stripped of tags, first ~4000 chars) to the LLM:

**Prompt:**
```
Extract job details from this page content. Return JSON or null if
this is not a job posting for an AI/ML Engineer role.

URL: <url>
Content: <stripped text, ~4000 chars>

Return: {
  "title": string | null,
  "company": string | null,
  "description": string | null (first 500 chars),
  "isRemote": boolean,
  "datePosted": string | null (ISO date),
  "isAiMlEngineerRole": boolean (true only if this is AI/ML Engineer)
}

If isAiMlEngineerRole is false, return null.
```

Uses OpenRouter's `response_format: { type: "json_object" }` for structured output.

### Step 5 — Persona Filter

Pass the extracted job through the existing `matchesPersona()` filter:
- Must be an AI/ML Engineer role (already classified)
- Must not be senior/staff/principal
- Must not be new-grad/campus
- Must be remote

### Step 6 — Ingest into Collector Store

Upsert into `data/collector.json` using the same `CollatedJobsStore` class the collector uses.

From there, the existing notifier picks it up and sends the Telegram notification automatically.

## Files to Create

```
scripts/
├── web-discovery.ts          # Main script: search + LLM extract
├── ingest-discovery.ts       # Reads output, filters, upserts into store

docs/plans/
└── web-discovery-llm-agent.md  # This file
```

## GitHub Actions Workflow

Add a new workflow or extend the existing one:

```yaml
# .github/workflows/discover.yml
name: Web Discovery

on:
  schedule:
    - cron: '0 */12 * * *'  # twice daily
  workflow_dispatch:

jobs:
  discover:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install deps
        run: npm ci

      - name: Web discovery search + extract
        run: npx tsx scripts/web-discovery.ts > /tmp/discovered.jsonl
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

      - name: Ingest discovered jobs
        run: npx tsx scripts/ingest-discovery.ts /tmp/discovered.jsonl

      - name: Commit updated store
        run: |
          git config user.name "web-discovery-bot"
          git config user.email "bot@ever-jobs"
          git add data/collector.json
          git diff --cached --quiet || git commit -m "feat(discovery): ingest web-discovered jobs"
          git push
```

## Edge Cases & Mitigations

| Problem | Mitigation |
|---|---|
| DuckDuckGo rate limits | Add 1s delay between queries; rotate User-Agent; cap at 15 queries/run |
| OpenRouter free tier rate limits (20 RPM) | Process URLs in batches of 20, with 60s pause between batches |
| Non-job pages (blog posts, news articles) | LLM prompt explicitly checks "is this a job posting?"; returns null for non-jobs |
| Duplicates across queries | Dedup by URL before classification |
| Duplicates with existing scrapers | Skip URLs matching known domains (linkedin.com, indeed.com, etc.) |
| GHA 6h timeout limit | 300 URLs × ~3s fetch + ~2s LLM = ~25 min total. Well within limits |
| OpenRouter free model rotation | Model IDs change — pin to latest listed in free tier docs, or use OpenRouter's `:free` suffix |

## Future Improvements (if needed)

- Add a small local cache to avoid re-classifying the same URL across runs
- Expand query templates to target specific geographic regions
- Use the LLM to also extract salary, skills, tech stack from descriptions
- Score job fit against a resume/ideal profile

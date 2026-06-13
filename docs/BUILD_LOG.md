# Build Log — Source Discovery + LLM Ranking + Social Monitoring

> Append-only log. Newest entry at top.

---

## 2026-06-13 — Zero-exp experience filter + LLM zeroExpFriendly + notifier badge

### ✅ 1. Description-based experience filter (`persona.filter.ts`)
- Added `EXP_RANGE`, `EXP_PLUS`, `ZERO_EXP_POSITIVE`, `PORTFOLIO_ALT` regex patterns
- New `isZeroExpFriendly(description)` function that scans job descriptions
- Rejects jobs requiring 2+ years experience unless portfolio alternative mentioned
- Rejects 1+ year unless portfolio/GitHub/side projects accepted
- Accepts explicit "no experience required", "0 years", entry level
- Wired into `matchesPersona()` — all jobs checked before passing

### ✅ 2. LLM ranker enhanced (`llm-ranker.service.ts`)
- Prompt now asks for `zeroExpFriendly` (boolean) and `experienceRequired` (string|null)
- `LlmRankResult` interface extended with both fields
- Stored in `payload_json` via `collector.service.ts`

### ✅ 3. Notifier badge (`format.ts`)
- New `zeroExpBadge()` helper parses payload for zero-exp info
- Shows `🎓 Portfolio/zero-exp OK` for friendly postings
- Shows `⚠️ {requirement}` for ones with experience gates
- Used in both job and social post formats

### Verification
- ✅ Typecheck clean: collector, notifier, wellfound
- ✅ 20/20 tests pass

---

## 2026-06-13 — All 6 features implemented

### ✅ 1. Stricter persona filter (`persona.filter.ts`)
- Added `SCIENTIST_EXCLUDE` regex rejecting Scientist/Researcher titles
- Rejects: Research Scientist, Applied Scientist, Data Scientist, AI Scientist, etc.
- Only AI/ML Engineer roles pass through

### ✅ 2. Fixed Wellfound scraper (`source-wellfound/src/wellfound.service.ts`)
- Added Cheerio DOM parsing as primary extraction method
- Parses job card elements (title, company, location) directly from rendered HTML
- `__NEXT_DATA__` kept as fallback with shape logging for debugging
- All `extractListings` now also checks `jobListings` and `results` arrays

### ✅ 3. LLM Relevance Ranker (`apps/collector/src/rankers/llm-ranker.service.ts`)
- Keyword baseline scoring (intern=100, entry=90, mid=70, default=60, senior=30)
- Only calls OpenRouter for uncertain jobs (score 40-80)
- Returns `{ score, reason, source: 'keyword'|'llm' }`
- Wired into `CollectorService.collect()` — stores `llmScore`/`llmReason` in `payload_json`
- Uses `qwen3-235b-a22b:free` model, 15s timeout, JSON mode

### ✅ 4. Social Discovery Script (`scripts/social-discovery.ts`)
- Searches Twitter/X, Reddit, LinkedIn, HN, Bluesky, Mastodon + general web
- Uses DuckDuckGo HTML search (free, no API key)
- LLM classifies posts as `ai-engineer-job`, `ml-engineer-job`, `vibe-coder-gig`, or null
- Extracts title, company, author, platform, description, contact info
- Upserts into `data/collector.json` with `site = "social-{platform}"`
- Polite rate limiting, 72h window via `since:3d` queries

### ✅ 5. Social Post Notifier Format (`apps/notifier/src/format.ts`)
- Detects `site.startsWith("social-")` → alternate format with platform emoji
- Shows: author, company, vibe-coder badge, contact info, description
- Uses LLM score from `payload_json` when available (falls back to keyword)
- Score label shown with source e.g. `(llm: Reason)` or `(keyword)`

### ✅ 6. LLM Source Discovery (`scripts/discover-sources.ts`)
- Passes existing ~1000 sources grouped by category to LLM
- LLM returns candidate new sources with name, URL, category, difficulty
- Outputs report to `data/discovered-sources.json`
- Reviewable — user decides which to add as new scraper plugins

### Verification
- ✅ All 10 collector tests pass
- ✅ Typecheck clean: wellfound plugin, collector, notifier
- ✅ `docs/log.md` updated
- ✅ `docs/index.md` updated

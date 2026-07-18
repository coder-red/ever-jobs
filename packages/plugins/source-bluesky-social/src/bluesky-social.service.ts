import { SourcePlugin } from '@ever-jobs/plugin';
import { Injectable, Logger } from '@nestjs/common';
import {
  IScraper,
  ScraperInputDto,
  JobResponseDto,
  JobPostDto,
  Site,
} from '@ever-jobs/models';
import { createHttpClient } from '@ever-jobs/common';

// Public Bluesky AppView — no auth / no API key required (free forever).
const SEARCH_URL = 'https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts';
const MAX_PER_QUERY = 100;

// Focused hiring phrases. Bluesky full-text search is a single string per
// call, so we fan out over several queries and dedupe by post URI. These aim
// at the "someone is looking to hire an AI/ML person" firehose.
const HIRING_QUERIES = [
  'hiring AI engineer',
  'hiring machine learning engineer',
  'need an AI engineer',
  'looking for ML engineer',
  'AI engineer wanted',
  'remote AI engineer hiring',
  'hiring ML engineer Nigeria',
  'AI engineer Lagos',
];

// A post must read like an offer to hire, not someone job-seeking.
const HIRING_SIGNAL =
  /\b(hiring|we're hiring|we are hiring|looking to hire|looking for|seeking|need(?:ed|ing)?|join (?:our|the)|apply|role|position|opening|vacancy|wanted|dm me|reach out)\b/i;
// Drop obvious job-SEEKERS so we don't notify on other candidates.
const SEEKER_SIGNAL =
  /\b(i am looking for (?:a )?(?:job|role|work)|open to work|#opentowork|available for hire|seeking (?:a )?(?:job|role|position)|looking for (?:a )?(?:job|opportunit))\b/i;

interface BskyAuthor {
  did: string;
  handle: string;
  displayName?: string;
}

interface BskyRecord {
  text?: string;
  createdAt?: string;
}

interface BskyPost {
  uri: string;
  cid: string;
  author: BskyAuthor;
  record: BskyRecord;
}

interface SearchResponse {
  posts?: BskyPost[];
}

@SourcePlugin({
  site: Site.BLUESKY_SOCIAL,
  name: 'BlueskySocial',
  category: 'niche',
  description:
    'Searches public Bluesky posts for AI/ML hiring mentions (free, no API key)',
})
@Injectable()
export class BlueskySocialService implements IScraper {
  private readonly logger = new Logger(BlueskySocialService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const jobs: JobPostDto[] = [];
    const seen = new Set<string>();

    for (const query of HIRING_QUERIES) {
      if (jobs.length >= resultsWanted) break;

      try {
        const url = `${SEARCH_URL}?q=${encodeURIComponent(
          query,
        )}&sort=latest&limit=${MAX_PER_QUERY}`;
        this.logger.log(`Bluesky search: "${query}"`);
        const res = await client.get(url);
        const data: SearchResponse = res.data ?? {};

        for (const post of data.posts ?? []) {
          if (jobs.length >= resultsWanted) break;
          if (!post?.uri || seen.has(post.uri)) continue;

          const text = (post.record?.text ?? '').trim();
          if (text.length < 10) continue;

          if (!HIRING_SIGNAL.test(text)) continue;
          if (SEEKER_SIGNAL.test(text)) continue;

          seen.add(post.uri);

          const handle = post.author?.handle ?? 'unknown';
          const rkey = post.uri.split('/').pop() ?? post.cid;
          const jobUrl = `https://bsky.app/profile/${handle}/post/${rkey}`;
          const createdAt = post.record?.createdAt;
          const datePosted = createdAt
            ? new Date(createdAt).toISOString().split('T')[0]
            : null;
          const isRemote = /\b(remote|work from home|wfh|anywhere)\b/i.test(text);

          jobs.push(
            new JobPostDto({
              id: `bluesky-social-${post.cid}`,
              // Post text becomes the title so the persona filter can match
              // AI/ML + location keywords against it.
              title: text.slice(0, 200),
              companyName: post.author?.displayName || handle,
              jobUrl,
              description: text.slice(0, 500),
              datePosted,
              isRemote,
              site: Site.BLUESKY_SOCIAL,
            }),
          );
        }
      } catch (err: any) {
        this.logger.warn(`Bluesky search error ("${query}"): ${err.message}`);
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }
}

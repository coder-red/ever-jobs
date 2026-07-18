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

const PUSHSHIFT_URL = 'https://api.pushshift.io/reddit/submission/search';
const MAX_RESULTS = 100;

interface PushshiftHit {
  id: string;
  title: string;
  url: string;
  author: string;
  selftext: string;
  created_utc: number;
  subreddit: string;
  num_comments: number;
  score: number;
}

interface PushshiftResponse {
  data: PushshiftHit[];
}

@SourcePlugin({
  site: Site.REDDIT_SOCIAL,
  name: 'RedditSocial',
  category: 'niche',
  description: 'Searches all Reddit posts for AI/ML hiring mentions via Pushshift',
})
@Injectable()
export class RedditSocialService implements IScraper {
  private readonly logger = new Logger(RedditSocialService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const searchTerm = input.searchTerm ?? 'AI OR "machine learning" OR LLM OR "deep learning"';
    const jobs: JobPostDto[] = [];

    const ago = Math.floor(Date.now() / 1000) - 86400 * 60;

    try {
      const q = encodeURIComponent(`(${searchTerm}) AND (hiring OR engineer OR role OR job OR opening OR position)`);
      const url = `${PUSHSHIFT_URL}?q=${q}&sort=desc&sort_type=created_utc&before=${ago}&size=${Math.min(resultsWanted * 2, MAX_RESULTS)}`;
      this.logger.log(`Fetching Reddit Pushshift`);
      const res = await client.get(url);
      const data: PushshiftResponse = res.data;

      for (const hit of data.data || []) {
        if (jobs.length >= resultsWanted) break;
        if (!hit.title || hit.title.length < 5) continue;

        const text = (hit.selftext || '').slice(0, 1000);
        const isHiring = /hiring|we're hiring|we are hiring|opening|position|job opportunity/i.test(hit.title + ' ' + text);
        if (!isHiring) continue;

        const description = text || hit.title;
        const datePosted = hit.created_utc ? new Date(hit.created_utc * 1000).toISOString().split('T')[0] : null;

        jobs.push(new JobPostDto({
          id: `reddit-social-${hit.id}`,
          title: hit.title,
          companyName: hit.author,
          jobUrl: hit.url || `https://reddit.com/r/${hit.subreddit}/comments/${hit.id}`,
          description: description ? description.slice(0, 500) : undefined,
          datePosted,
          isRemote: false,
          site: Site.REDDIT_SOCIAL,
        }));
      }
    } catch (err: any) {
      this.logger.warn(`Reddit Pushshift error: ${err.message}`);
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }
}

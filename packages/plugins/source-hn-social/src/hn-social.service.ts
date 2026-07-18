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

const ALGOLIA_URL = 'https://hn.algolia.com/api/v1';
const MAX_HITS = 100;

interface AlgoliaHit {
  objectID: string;
  title: string;
  url: string | null;
  author: string;
  points: number;
  created_at: string;
  story_text: string | null;
  comment_text: string | null;
  _tags: string[];
}

interface AlgoliaResponse {
  hits: AlgoliaHit[];
  nbHits: number;
}

@SourcePlugin({
  site: Site.HN_SOCIAL,
  name: 'HackerNewsSocial',
  category: 'niche',
  description: 'Searches all HN posts for AI/ML hiring mentions via Algolia',
})
@Injectable()
export class HnSocialService implements IScraper {
  private readonly logger = new Logger(HnSocialService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const searchTerm = input.searchTerm ?? 'AI OR machine learning OR LLM OR deep learning';
    const hiringQuery = `(${searchTerm}) AND (hiring OR "we are hiring" OR "we\'re hiring" OR opening OR position OR job OR engineer OR role)`;
    const jobs: JobPostDto[] = [];

    for (const tag of ['story', 'comment']) {
      if (jobs.length >= resultsWanted) break;
      try {
        const url = `${ALGOLIA_URL}/search?query=${encodeURIComponent(hiringQuery)}&tags=${tag}&hitsPerPage=${Math.min(resultsWanted * 2, MAX_HITS)}&numericFilters=created_at_i>${Math.floor(Date.now() / 1000) - 86400 * 60}`;
        this.logger.log(`Fetching HN Algolia ${tag}s`);
        const res = await client.get(url);
        const data: AlgoliaResponse = res.data;

        for (const hit of data.hits) {
          if (jobs.length >= resultsWanted) break;
          if (!hit.title || hit.title.length < 5) continue;

          const text = (hit.story_text || hit.comment_text || '').slice(0, 1000);
          const isHiring = /hiring|we're hiring|we are hiring|opening|position|job opportunity/i.test(hit.title + ' ' + text);

          const description = text || hit.title;
          const datePosted = hit.created_at ? hit.created_at.split('T')[0] : null;

          jobs.push(new JobPostDto({
            id: `hn-social-${hit.objectID}`,
            title: hit.title,
            companyName: hit.author,
            jobUrl: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
            description: description ? description.slice(0, 500) : undefined,
            datePosted,
            isRemote: false,
            site: Site.HN_SOCIAL,
          }));
        }
      } catch (err: any) {
        this.logger.warn(`HN Algolia ${tag} error: ${err.message}`);
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }
}

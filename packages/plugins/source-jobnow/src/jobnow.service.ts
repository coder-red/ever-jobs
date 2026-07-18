import { SourcePlugin } from '@ever-jobs/plugin';
import { Injectable, Logger } from '@nestjs/common';
import {
  IScraper,
  ScraperInputDto,
  JobResponseDto,
  JobPostDto,
  Site,
} from '@ever-jobs/models';
import {
  createHttpClient,
} from '@ever-jobs/common';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.jobnow.ng';

@SourcePlugin({
  site: Site.JOBNOW,
  name: 'Jobnow',
  category: 'regional',
  description: 'Nigerian job board — jobnow.ng',
})
@Injectable()
export class JobnowService implements IScraper {
  private readonly logger = new Logger(JobnowService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const jobs: JobPostDto[] = [];
    const query = input.searchTerm ?? 'AI';

    for (let page = 1; page <= 3; page++) {
      if (jobs.length >= resultsWanted) break;

      try {
        const q = encodeURIComponent(query);
        const url = page === 1
          ? `${BASE_URL}/?s=${q}`
          : `${BASE_URL}/page/${page}/?s=${q}`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('#loop_jobs_taxonomy .post, article.post, .job-listing').each((_i, el) => {
          if (pageJobs.length >= resultsWanted) return false;

          const titleEl = $('h2 a, h3 a, .entry-title a', el).first();
          const href = titleEl.attr('href') || '';
          if (!href) return;

          const title = titleEl.text().trim();
          if (!title || title.length < 3) return;

          const jobUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

          const companyName = $('.job-company, .company-name', el).first().text().trim() || null;

          const dateText = $('.job-posted-date, .post-date, time.entry-date', el).first().text().trim();
          const datePosted = dateText ? this.parseDate(dateText) : null;

          const description = $('.entry-content p, .post-excerpt', el).first().text().trim() || null;

          const jobText = (title + ' ' + (companyName || '') + ' ' + (description || '')).toLowerCase();
          const isRemote = /\bremote\b/i.test(jobText);

          pageJobs.push(new JobPostDto({
            id: `jobnow-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            description: description ? description.slice(0, 500) : undefined,
            datePosted,
            isRemote,
            site: Site.JOBNOW,
          }));
        });

        jobs.push(...pageJobs);

        const nextPage = $('a.next.page-numbers, a[rel="next"]').length > 0;
        if (!nextPage) break;
      } catch (err: any) {
        this.logger.warn(`Jobnow page ${page} error: ${err.message}`);
        break;
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private parseDate(dateStr: string): string | null {
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

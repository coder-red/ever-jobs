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

const BASE_URL = 'https://naijaremotejobs.com';
const MAX_PAGES = 3;

@SourcePlugin({
  site: Site.NAIJAREMOTEJOBS,
  name: 'Naijaremotejobs',
  category: 'regional',
  description: 'Nigerian remote job board — naijaremotejobs.com',
})
@Injectable()
export class NaijaremotejobsService implements IScraper {
  private readonly logger = new Logger(NaijaremotejobsService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const jobs: JobPostDto[] = [];
    const query = input.searchTerm ?? 'AI';

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (jobs.length >= resultsWanted) break;

      try {
        const q = encodeURIComponent(query);
        const pageParam = page > 1 ? `&page=${page}` : '';
        const url = `${BASE_URL}/jobs/?search_keywords=${q}&search_categories=ai${pageParam}`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('article.job_listing, li.job_listing, div.job_listing').each((_i, el) => {
          if (pageJobs.length >= resultsWanted) return false;

          const titleEl = $('h3 a, .position h3 a, a[href*="/jobs/"]', el).first();
          const href = titleEl.attr('href') || '';
          if (!href) return;

          const title = titleEl.text().trim();
          if (!title || title.length < 3) return;

          const jobUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

          const companyName = $('.company strong, .company-name, meta[itemprop="name"]', el).first().text().trim() ||
            $('a[href*="/companies/"]', el).first().text().trim() || null;

          const locationText = $('.location, .job-location, [itemprop="jobLocation"]', el).first().text().trim();
          const location = locationText || null;

          const dateText = $('.date-posted, time.job-date__posted, .job-date', el).first().text().trim();
          const datePosted = dateText ? this.parseDate(dateText) : null;

          const jobText = (title + ' ' + (companyName || '') + ' ' + (locationText || '')).toLowerCase();
          const isRemote = /\bremote\b/i.test(jobText) || (locationText || '').toLowerCase().includes('remote');

          pageJobs.push(new JobPostDto({
            id: `naijaremote-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: null,
            datePosted,
            isRemote,
            site: Site.NAIJAREMOTEJOBS,
          }));
        });

        jobs.push(...pageJobs);

        const nextPage = $('a.next.page-numbers, a[rel="next"]').length > 0;
        if (!nextPage) break;
      } catch (err: any) {
        this.logger.warn(`Naijaremotejobs page ${page} error: ${err.message}`);
        break;
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private parseDate(dateStr: string): string | null {
    try {
      const cleaned = dateStr.replace(/^Posted\s+/i, '').replace(/\s+\d{4}$/, '').trim();
      const d = new Date(`${cleaned} ${new Date().getFullYear()}`);
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

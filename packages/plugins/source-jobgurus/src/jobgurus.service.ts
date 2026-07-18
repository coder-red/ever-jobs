import { SourcePlugin } from '@ever-jobs/plugin';
import { Injectable, Logger } from '@nestjs/common';
import {
  IScraper,
  ScraperInputDto,
  JobResponseDto,
  JobPostDto,
  LocationDto,
  Site,
} from '@ever-jobs/models';
import {
  createHttpClient,
} from '@ever-jobs/common';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.jobgurus.com.ng';
const MAX_PAGES = 3;

@SourcePlugin({
  site: Site.JOBGURUS,
  name: 'Jobgurus',
  category: 'regional',
  description: 'Nigerian job board — jobgurus.com.ng',
})
@Injectable()
export class JobgurusService implements IScraper {
  private readonly logger = new Logger(JobgurusService.name);

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
        const url = page === 1
          ? `${BASE_URL}/jobs?search_keyword=${q}`
          : `${BASE_URL}/jobs/page/${page}?search_keyword=${q}`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('div.panel.panel-default.job-post-panel').each((_i, el) => {
          if (pageJobs.length >= resultsWanted) return false;

          const titleEl = $('h2 a', el).first();
          const href = titleEl.attr('href') || '';
          if (!href) return;

          const title = titleEl.text().trim();
          if (!title || title.length < 3) return;

          const jobUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

          const companyEl = $('p.job-info a[href*="/jobs/company/"]', el).first();
          const companyName = companyEl.text().trim() || null;

          const locationEl = $('p.job-info a[href*="/jobs/location/"]', el).first();
          const locationText = locationEl.text().trim() || null;

          const dateText = $('div.job-footer_text span', el).first().text().trim();
          const datePosted = dateText ? this.parseDate(dateText) : null;

          const description = $('div.job-brief', el).first().text().trim() || null;

          const jobText = (title + ' ' + (companyName || '') + ' ' + (description || '')).toLowerCase();
          const isRemote = /\bremote\b/i.test(jobText) || (locationText || '').toLowerCase().includes('remote');

          pageJobs.push(new JobPostDto({
            id: `jobgurus-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: locationText ? new LocationDto({ city: locationText }) : undefined,
            description: description ? description.slice(0, 500) : undefined,
            datePosted,
            isRemote,
            site: Site.JOBGURUS,
          }));
        });

        jobs.push(...pageJobs);

        const nextPage = $('a[rel="next"], a:contains("Next")').length > 0;
        if (!nextPage) break;
      } catch (err: any) {
        this.logger.warn(`Jobgurus page ${page} error: ${err.message}`);
        break;
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private parseDate(dateStr: string): string | null {
    try {
      const d = new Date(dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1'));
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

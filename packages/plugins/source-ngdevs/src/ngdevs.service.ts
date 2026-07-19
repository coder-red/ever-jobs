import { SourcePlugin } from '@ever-jobs/plugin';
import { Injectable, Logger } from '@nestjs/common';
import {
  IScraper,
  ScraperInputDto,
  JobResponseDto,
  JobPostDto,
  LocationDto,
  Site,
  DescriptionFormat,
} from '@ever-jobs/models';
import {
  createHttpClient,
  htmlToPlainText,
  extractEmails,
} from '@ever-jobs/common';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://devs.com.ng/jobs';
const MAX_PAGES = 5;

@SourcePlugin({
  site: Site.NGDEVS,
  name: 'Devs.com.ng',
  category: 'regional',
  description: 'Nigerian tech job board — devs.com.ng',
})
@Injectable()
export class NgDevsService implements IScraper {
  private readonly logger = new Logger(NgDevsService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const jobs: JobPostDto[] = [];

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (jobs.length >= resultsWanted) break;

      try {
        const url = `${BASE_URL}?page=${page}`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('a.vacancy-element').each((_i, el) => {
          if (pageJobs.length >= resultsWanted) return false;

          const href = $(el).attr('href') || '';
          const jobUrl = href.startsWith('http') ? href : `https://devs.com.ng${href}`;

          const titleRaw = $('.vacancy-element-header', el).text().trim();
          if (!titleRaw || titleRaw.length < 3) return;
          // Strip job-type suffix (e.g. "On-site", "Remote") from title
          const title = titleRaw.replace(/\s+(On-site|Remote|Hybrid)\s*$/i, '').trim();

          const companyName = $('.company-name', el).text().trim() || null;

          const location = $('.vacancy-text p:first', el).text().trim() || null;

          const dateText = $('.vacancy-text p:nth-child(2)', el).text().trim() || null;
          const datePosted = dateText ? this.parseDate(dateText) : null;

          const typeText = $('.job-type-display', el).text().trim().toLowerCase();
          const isRemote = typeText.includes('remote');

          const description = $('.clamp-text', el).text().trim() || null;

          if (input.searchTerm) {
            const term = input.searchTerm.toLowerCase();
            const allText = (title + ' ' + (companyName || '') + ' ' + (description || '')).toLowerCase();
            const terms = term.split(/\s+OR\s+/).map(t => t.trim().replace(/^"(.*)"$/, '$1'));
            const matches = terms.some(t => allText.includes(t.toLowerCase()));
            if (!matches) return;
          }

          pageJobs.push(new JobPostDto({
            id: `ngdevs-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: location ? new LocationDto({ city: location }) : undefined,
            description: description ? description.slice(0, 1000) : undefined,
            datePosted,
            isRemote,
            site: Site.NGDEVS,
          }));
        });

        jobs.push(...pageJobs);

        const hasNext = $('a[href*="/jobs/page/"]').length > 0;
        if (!hasNext) break;
      } catch (err: any) {
        this.logger.warn(`Page ${page} error: ${err.message}`);
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

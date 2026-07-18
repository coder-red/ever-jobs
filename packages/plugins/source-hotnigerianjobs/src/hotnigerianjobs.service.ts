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

const BASE_URL = 'https://www.hotnigerianjobs.com';
const MAX_PAGES = 3;

@SourcePlugin({
  site: Site.HOTNIGERIANJOBS,
  name: 'HotNigerianJobs',
  category: 'regional',
  description: 'Nigerian job board — hotnigerianjobs.com',
})
@Injectable()
export class HotNigerianJobsService implements IScraper {
  private readonly logger = new Logger(HotNigerianJobsService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const jobs: JobPostDto[] = [];

    for (let page = 0; page < MAX_PAGES; page++) {
      if (jobs.length >= resultsWanted) break;

      try {
        const url = `${BASE_URL}/alljobs/${page}/`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('span.jobheader').each((_i, el) => {
          if (pageJobs.length >= resultsWanted) return false;

          const link = $('h1 a', el).first();
          const href = link.attr('href') || '';
          if (!href) return;

          const titleFull = link.text().trim();
          if (!titleFull || titleFull.length < 3) return;

          const jobUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          const title = titleFull.replace(/\s+at\s+/, ' — ');
          const companyName = this.parseCompany(titleFull);

          const parentSection = $(el).nextUntil('span.jobheader, div.fet_show').first();
          const dateText = $(el).next('span.semibio').text().trim() || '';
          const datePosted = dateText ? this.parseDate(dateText) : null;

          const isRemote = /\bremote\b|telecommute/i.test(titleFull);
          const location = null;

          if (input.searchTerm) {
            const term = input.searchTerm.toLowerCase();
            const allText = (titleFull + ' ' + (companyName || '')).toLowerCase();
            const terms = term.split(/\s+OR\s+/).map(t => t.trim().replace(/^"(.*)"$/, '$1'));
            const matches = terms.some(t => allText.includes(t.toLowerCase()));
            if (!matches) return;
          }

          pageJobs.push(new JobPostDto({
            id: `hnj-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: location ? new LocationDto({ city: location }) : undefined,
            datePosted,
            isRemote,
            site: Site.HOTNIGERIANJOBS,
          }));
        });

        jobs.push(...pageJobs);

        const hasNext = $(`a[href*="/alljobs/${page + 1}/"]`).length > 0;
        if (!hasNext) break;
      } catch (err: any) {
        this.logger.warn(`HotNigerianJobs page ${page} error: ${err.message}`);
        break;
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private parseCompany(full: string): string | null {
    const idx = full.lastIndexOf(' at ');
    if (idx > 0) {
      return full.slice(idx + 4).trim();
    }
    return null;
  }

  private parseDate(dateStr: string): string | null {
    try {
      const match = dateStr.match(/Posted on (\w+ \d+[a-z]+ \w+, \d{4})/i);
      if (match) {
        const d = new Date(match[1]);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
      }
      return null;
    } catch {
      return null;
    }
  }
}

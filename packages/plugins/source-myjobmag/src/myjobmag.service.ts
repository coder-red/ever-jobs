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

const BASE_URL = 'https://www.myjobmag.com';
const MAX_PAGES = 3;

@SourcePlugin({
  site: Site.MYJOBMAG,
  name: 'MyJobMag',
  category: 'regional',
  description: 'Nigerian job board — myjobmag.com',
})
@Injectable()
export class MyJobMagService implements IScraper {
  private readonly logger = new Logger(MyJobMagService.name);

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
          ? `${BASE_URL}/search/jobs?q=${q}`
          : `${BASE_URL}/search/jobs?q=${q}&page=${page}`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('ul.job-list > li.job-list-li').each((_i, el) => {
          if (pageJobs.length >= resultsWanted) return false;

          const titleEl = $('h2 a', el).first();
          const href = titleEl.attr('href') || '';
          if (!href) return;

          const titleFull = titleEl.text().trim();
          if (!titleFull || titleFull.length < 3) return;

          const jobUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;
          const [title, companyExtracted] = this.parseTitleAndCompany(titleFull);
          const companyName = companyExtracted || $('a[href*="/jobs-at/"] img', el).attr('alt') || null;

          const dateText = $('#job-date', el).text().trim();
          const datePosted = dateText ? this.parseDate(dateText) : null;

          const locationText = $('#job-date span a', el).last().text().trim();
          const location = locationText || null;

          const description = $('li.job-desc', el).text().trim() || null;

          const salaryText = $('li.job_detail_tag span.job-salary', el).text().trim();
          const compensation = salaryText ? this.parseSalary(salaryText) : undefined;

          const jobText = (title + ' ' + (companyName || '') + ' ' + (description || '')).toLowerCase();
          const isRemote = /\bremote\b/i.test(jobText);

          if (input.searchTerm) {
            const term = input.searchTerm.toLowerCase();
            const terms = term.split(/\s+OR\s+/).map(t => t.trim().replace(/^"(.*)"$/, '$1'));
            const matches = terms.some(t => jobText.includes(t.toLowerCase()));
            if (!matches) return;
          }

          pageJobs.push(new JobPostDto({
            id: `myjobmag-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: location ? new LocationDto({ city: location }) : undefined,
            description: description ? description.slice(0, 1000) : undefined,
            datePosted,
            isRemote,
            site: Site.MYJOBMAG,
          }));
        });

        jobs.push(...pageJobs);

        const nextPage = $('a[rel="next"], a:contains("Next")').length > 0;
        if (!nextPage) break;
      } catch (err: any) {
        this.logger.warn(`MyJobMag page ${page} error: ${err.message}`);
        break;
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private parseTitleAndCompany(full: string): [string, string | null] {
    const idx = full.lastIndexOf(' at ');
    if (idx > 0) {
      return [full.slice(0, idx).trim(), full.slice(idx + 4).trim()];
    }
    return [full, null];
  }

  private parseDate(dateStr: string): string | null {
    try {
      const cleaned = dateStr.replace(/\s+\d{4}$/, '').trim();
      const d = new Date(`${cleaned} ${new Date().getFullYear()}`);
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  private parseSalary(salary: string): any {
    const match = salary.match(/[₦$€£]\s*([\d,]+)\s*-\s*[₦$€£]\s*([\d,]+)/);
    if (!match) return undefined;
    const minAmount = parseFloat(match[1].replace(/,/g, ''));
    const maxAmount = parseFloat(match[2].replace(/,/g, ''));
    if (isNaN(minAmount) && isNaN(maxAmount)) return undefined;
    return {
      interval: 'yearly' as any,
      minAmount: isNaN(minAmount) ? null : minAmount,
      maxAmount: isNaN(maxAmount) ? null : maxAmount,
      currency: 'NGN',
    };
  }
}

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

const BASE_URL = 'https://aicareers.ng';

@SourcePlugin({
  site: Site.AICAREERS,
  name: 'Aicareers',
  category: 'regional',
  description: 'AI-specific Nigerian job board — aicareers.ng',
})
@Injectable()
export class AicareersService implements IScraper {
  private readonly logger = new Logger(AicareersService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const resultsWanted = input.resultsWanted ?? 25;
    const client = createHttpClient({
      proxies: input.proxies,
      caCert: input.caCert,
      timeout: input.requestTimeout,
    });

    const jobs: JobPostDto[] = [];
    const query = input.searchTerm ?? 'AI';

    for (let page = 1; page <= 5; page++) {
      if (jobs.length >= resultsWanted) break;

      try {
        const q = encodeURIComponent(query);
        const url = page === 1
          ? `${BASE_URL}/jobs/?s=${q}`
          : `${BASE_URL}/jobs/page/${page}/?s=${q}`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('article.noo_job').each((_i, el) => {
          if (pageJobs.length >= resultsWanted) return false;

          const titleEl = $('h3.loop-item-title a', el).first();
          const href = titleEl.attr('href') || '';
          if (!href) return;

          const title = titleEl.text().trim();
          if (!title || title.length < 3) return;

          const jobUrl = href.startsWith('http') ? href : `${BASE_URL}${href}`;

          const companyName = $('span.job-company a', el).first().text().trim() || null;

          const locationEls = $('span.job-location a', el);
          const locationText = locationEls.map((_, loc) => $(loc).text().trim()).get().join(', ');
          const location = locationText || null;

          const dateText = $('span.job-date time.job-date__posted', el).text().trim();
          const datePosted = dateText ? this.parseDate(dateText) : null;

          const category = $('span.job-category a', el).first().text().trim() || null;

          const salaryText = $('span.job-_salary em', el).text().trim();
          const compensation = salaryText ? this.parseSalary(salaryText) : undefined;

          const description = category ? `Category: ${category}` : null;

          const jobText = (title + ' ' + (companyName || '') + ' ' + (description || '') + ' ' + (category || '')).toLowerCase();
          const isRemote = /\bremote\b/i.test(jobText) ||
            locationText.toLowerCase().includes('remote');

          pageJobs.push(new JobPostDto({
            id: `aicareers-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: location ? new LocationDto({ city: location }) : undefined,
            description: description ? description.slice(0, 500) : undefined,
            datePosted,
            isRemote,
            site: Site.AICAREERS,
            compensation,
          }));
        });

        jobs.push(...pageJobs);

        const nextPage = $('a.next.page-numbers').length > 0;
        if (!nextPage) break;
      } catch (err: any) {
        this.logger.warn(`Aicareers page ${page} error: ${err.message}`);
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

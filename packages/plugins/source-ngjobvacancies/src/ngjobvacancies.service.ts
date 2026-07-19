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

const BASE_URL = 'https://jobvacancies.ng/jobs';
const MAX_PAGES = 5;

@SourcePlugin({
  site: Site.NGJOBVACANCIES,
  name: 'JobVacanciesNG',
  category: 'regional',
  description: 'Verified Nigerian job board — jobvacancies.ng',
})
@Injectable()
export class NgJobVacanciesService implements IScraper {
  private readonly logger = new Logger(NgJobVacanciesService.name);

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
        const url = page === 1 ? BASE_URL : `${BASE_URL}?page=${page}`;
        this.logger.log(`Fetching ${url}`);
        const response = await client.get(url);
        const html = typeof response.data === 'string' ? response.data : String(response.data);
        const $ = cheerio.load(html);

        const pageJobs: JobPostDto[] = [];

        $('article.card').each((_i, card) => {
          if (pageJobs.length >= resultsWanted) return false;

          const titleLink = $('a[href*="/jobs/"]', card).first();
          const href = titleLink.attr('href') || '';
          if (!href.includes('--')) return;

          const jobUrl = href.startsWith('http') ? href : `https://jobvacancies.ng${href}`;
          const title = titleLink.text().trim();
          if (!title || title.length < 3) return;

          const companyLink = $('a[href*="/company/"]', card).first();
          const companyName = companyLink.text().trim() || null;

          const cardText = $(card).text();

          const isRemote = /\bRemote\b/i.test(cardText);

          const locationMatch = cardText.match(/(?:Location|Lagos|Abuja|Ibadan|Port Harcourt|Enugu|Kano|Kaduna|Ogun|Rivers|Delta|Oyo|Anambra)/i);
          const location = locationMatch ? locationMatch[0] : null;

          const agoMatch = cardText.match(/(Today|Yesterday|\d+\s+(?:days?|hours?)\s+ago)/i);
          const datePosted = agoMatch ? this.parseDate(agoMatch[0]) : null;

          const description = $('p.text-muted.line-clamp-3', card).first().text().trim() || null;

          if (input.searchTerm) {
            const term = input.searchTerm.toLowerCase();
            const allText = (title + ' ' + (companyName || '') + ' ' + (description || '')).toLowerCase();
            const terms = term.split(/\s+OR\s+/).map(t => t.trim().replace(/^"(.*)"$/, '$1'));
            const matches = terms.some(t => allText.includes(t.toLowerCase()));
            if (!matches) return;
          }

          pageJobs.push(new JobPostDto({
            id: `ngjobvac-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: location ? new LocationDto({ city: location }) : undefined,
            description: description ? description.slice(0, 1000) : undefined,
            datePosted,
            isRemote,
            site: Site.NGJOBVACANCIES,
          }));
        });

        jobs.push(...pageJobs);

        const hasNext = $('a[rel="next"], a:contains("Next")').length > 0;
        if (!hasNext) break;
      } catch (err: any) {
        this.logger.error(`JobVacanciesNG error page ${page}: ${err.message}`);
        break;
      }
    }

    return new JobResponseDto(jobs.slice(0, resultsWanted));
  }

  private parseDate(dateStr: string): string | null {
    try {
      if (/^(Today|Yesterday)$/i.test(dateStr)) {
        return new Date().toISOString().split('T')[0];
      }
      const agoMatch = dateStr.match(/^(\d+)\s+(days?|hours?)\s+ago$/i);
      if (agoMatch) {
        const num = parseInt(agoMatch[1], 10);
        const unit = agoMatch[2].toLowerCase();
        const ms = unit.startsWith('hour') ? num * 60 * 60 * 1000 : num * 24 * 60 * 60 * 1000;
        return new Date(Date.now() - ms).toISOString().split('T')[0];
      }
      const d = new Date(dateStr);
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
}

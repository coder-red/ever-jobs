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

        $('a[href*="/jobs/"]').each((_i, el) => {
          const card = $(el).closest('div').parent();
          const titleEl = $(el).find('h2, h3, strong').first();
          const title = titleEl.text().trim() || $(el).text().trim();
          if (!title || title.length < 3) return;

          const href = $(el).attr('href') || '';
          const jobUrl = href.startsWith('http') ? href : `https://devs.com.ng${href}`;

          const cardText = card.text() || $(el).parent().text() || '';

          const companyMatch = cardText.match(/@\s*([A-Za-z0-9&.\s-]+)/);
          const companyName = companyMatch ? companyMatch[1].trim() : null;

          const locationMatch = cardText.match(/(Lagos|Abuja|Ibadan|Port Harcourt|Enugu|Kano|Kaduna|Remote|On-site)/i);
          const location = locationMatch ? locationMatch[1] : null;

          const isRemote = /\bRemote\b/i.test(cardText);

          const dateMatch = cardText.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i);
          const datePosted = dateMatch ? this.parseDate(dateMatch[1]) : null;

          if (input.searchTerm) {
            const term = input.searchTerm.toLowerCase();
            const allText = (title + ' ' + cardText).toLowerCase();
            const terms = term.split(/\s+OR\s+/).map(t => t.trim().replace(/^"(.*)"$/, '$1'));
            const matches = terms.some(t => allText.includes(t.toLowerCase()));
            if (!matches) return;
          }

          pageJobs.push(new JobPostDto({
            id: `ngdevs-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
            title,
            companyName,
            jobUrl,
            location: new LocationDto({ city: location }),
            description: cardText.slice(0, 1000),
            datePosted,
            isRemote,
            site: Site.NGDEVS,
          }));
        });

        jobs.push(...pageJobs);

        const hasNext = $('a:contains("Next"), a:contains("→"), a:contains(">")').length > 0;
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

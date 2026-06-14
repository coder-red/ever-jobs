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

const BASE_URL = 'https://jobvacancies.ng';

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

    try {
      this.logger.log(`Fetching ${BASE_URL}`);
      const response = await client.get(BASE_URL);
      const html = typeof response.data === 'string' ? response.data : String(response.data);
      const $ = cheerio.load(html);

      const seen = new Set<string>();

      $('a[href*="/jobs/"], a[href*="/job/"], a[href*="/listing/"]').each((_i, el) => {
        if (jobs.length >= resultsWanted) return false;

        const href = $(el).attr('href') || '';
        const jobUrl = href.startsWith('http') ? href : `https://jobvacancies.ng${href}`;
        if (seen.has(jobUrl)) return;
        seen.add(jobUrl);

        const title = $(el).text().trim();
        if (!title || title.length < 3) return;

        const parentSection = $(el).closest('div, article, section');
        const sectionText = parentSection.text() || $(el).parent().text() || '';

        const companyMatch = sectionText.match(/(?:at|@)\s+([A-Za-z0-9&.\s-]+?)(?:\s*[,–—]|\s*\n|$)/i);
        const companyName = companyMatch ? companyMatch[1].trim() : null;

        const locationMatch = sectionText.match(/(Lagos|Abuja|Ibadan|Port Harcourt|Enugu|Kano|Kaduna|Ogun|Rivers|Delta|Oyo|Anambra|Remote|On-site)/i);
        const location = locationMatch ? locationMatch[1] : null;

        const isRemote = /\bRemote\b/i.test(sectionText);

        const dateMatch = sectionText.match(/(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{4})/i) ||
                          sectionText.match(/(?:Today|Yesterday|\d+\s+(?:days?|hours?)\s+ago)/i);
        const datePosted = dateMatch ? this.parseDate(dateMatch[0]) : null;

        if (input.searchTerm) {
          const term = input.searchTerm.toLowerCase();
          const allText = (title + ' ' + sectionText).toLowerCase();
          const terms = term.split(/\s+OR\s+/).map(t => t.trim().replace(/^"(.*)"$/, '$1'));
          const matches = terms.some(t => allText.includes(t.toLowerCase()));
          if (!matches) return;
        }

        jobs.push(new JobPostDto({
          id: `ngjobvac-${Buffer.from(jobUrl).toString('base64url').slice(0, 40)}`,
          title,
          companyName,
          jobUrl,
          location: new LocationDto({ city: location }),
          description: sectionText.slice(0, 1000),
          datePosted,
          isRemote,
          site: Site.NGJOBVACANCIES,
        }));
      });
    } catch (err: any) {
      this.logger.error(`JobVacanciesNG error: ${err.message}`);
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

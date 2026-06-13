import * as cheerio from 'cheerio';
import { SourcePlugin } from '@ever-jobs/plugin';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  IScraper,
  ScraperInputDto,
  JobResponseDto,
  JobPostDto,
  LocationDto,
  CompensationDto,
  CompensationInterval,
  Site,
  DescriptionFormat,
} from '@ever-jobs/models';
import {
  htmlToPlainText,
  markdownConverter,
  extractEmails,
  randomSleep,
  BrowserPool,
} from '@ever-jobs/common';
import { WELLFOUND_JOBS_URL, WELLFOUND_DELAY_MIN, WELLFOUND_DELAY_MAX } from './wellfound.constants';
import { WellfoundNextData, WellfoundListing } from './wellfound.types';

@SourcePlugin({
  site: Site.WELLFOUND,
  name: 'Wellfound',
  category: 'niche',
})
@Injectable()
export class WellfoundService implements IScraper, OnModuleDestroy {
  private readonly logger = new Logger(WellfoundService.name);

  async scrape(input: ScraperInputDto): Promise<JobResponseDto> {
    const proxy = input.proxies?.[0] ?? undefined;
    const resultsWanted = input.resultsWanted ?? 15;
    let page;

    try {
      page = await BrowserPool.getPage({ proxy });
      const timeoutMs = (input.requestTimeout ?? 30) * 1000;

      const url = new URL(WELLFOUND_JOBS_URL);
      if (input.searchTerm) url.searchParams.set('q', input.searchTerm);

      this.logger.log(`Wellfound: navigating to ${url.toString()}`);
      await page.goto(url.toString(), {
        waitUntil: 'domcontentloaded',
        timeout: timeoutMs,
      });

      await this.delay(6000);

      const html = await page.content();

      const { listings: domListings, debugInfo } = this.extractFromDom(html);

      if (domListings.length > 0) {
        this.logger.log(`Wellfound: extracted ${domListings.length} listings via DOM parsing`);
        return this.buildJobPosts(domListings, resultsWanted, input.descriptionFormat);
      }

      this.logger.warn(`Wellfound: DOM parsing found 0 listings — debug: ${debugInfo}`);

      const nextDataJson = await page.evaluate(
        `(() => { const s = document.getElementById('__NEXT_DATA__'); return s ? s.textContent : null; })()`,
      ) as string | null;

      if (nextDataJson) {
        let nextData: WellfoundNextData;
        try {
          nextData = JSON.parse(nextDataJson);
        } catch {
          this.logger.error('Wellfound: failed to parse __NEXT_DATA__ JSON');
          return new JobResponseDto([]);
        }

        const shape = this.sampleShape(nextData);
        this.logger.log(`Wellfound: __NEXT_DATA__ shape: ${shape}`);

        const listings = this.extractListings(nextData);

        if (listings.length > 0) {
          this.logger.log(`Wellfound: extracted ${listings.length} listings via __NEXT_DATA__`);
          return this.buildJobPostsFromListings(listings, resultsWanted, input.descriptionFormat);
        }
      } else {
        this.logger.warn('Wellfound: __NEXT_DATA__ not found on page');
      }

      this.logger.warn('Wellfound: zero listings found — returning empty');
      return new JobResponseDto([]);
    } catch (err: any) {
      this.logger.error(`Wellfound scrape failed: ${err.message}`);
      return new JobResponseDto([]);
    } finally {
      if (page) {
        const context = page.context();
        await page.close().catch(() => {});
        await context.close().catch(() => {});
      }
    }
  }

  private extractFromDom(html: string): { listings: WellfoundListing[]; debugInfo: string } {
    const $ = cheerio.load(html);
    const listings: WellfoundListing[] = [];
    const debug: string[] = [];

    const containerSelectors = [
      'div[class*="styles_jobCard"]',
      'div[class*="job-card"]',
      'div[class*="JobCard"]',
      'a[class*="job"]',
      'div[class*="listing"]',
      'div[class*="result"]',
    ];

    for (const sel of containerSelectors) {
      const elements = $(sel);
      if (elements.length > 0) {
        debug.push(`${sel}: ${elements.length}`);
      }
    }

    const links = $('a[href*="/jobs/"]');
    debug.push(`a[href*="/jobs/"]: ${links.length}`);

    const seenUrls = new Set<string>();

    links.each((_: number, el: any) => {
      if (listings.length >= 50) return false;

      const href = $(el).attr('href') || '';
      if (!href.includes('/jobs/')) return;
      if (seenUrls.has(href)) return;
      seenUrls.add(href);

      const card = $(el).closest('a').length ? $(el).closest('a') : $(el);
      const cardHtml = card.html() || '';

      const titleEl = card.find('h2, h3, h4, [class*="title"], [class*="Title"], [class*="role"], [class*="Role"]').first();
      const title = titleEl.text().trim() || $(el).text().trim();

      const companyEl = card.find('[class*="company"], [class*="Company"], [class*="org"], [class*="Org"], [class*="employer"]').first();
      const companyName = companyEl.text().trim() || '';

      const locationEl = card.find('[class*="location"], [class*="Location"], [class*="loc"], [class*="Loc"]').first();
      const location = locationEl.text().trim() || null;
      const locations = location ? [location] : [];

      const isRemote = /remote/i.test(cardHtml);

      if (title && title.length > 1 && title.length < 200) {
        listings.push({
          id: href,
          title,
          slug: href.split('/jobs/')[1] || href,
          company: companyName ? { name: companyName } : undefined,
          locations,
          remote: isRemote,
        });
      }
    });

    return {
      listings,
      debugInfo: debug.join('; ') || 'no matching selectors found',
    };
  }

  private buildJobPosts(
    listings: WellfoundListing[],
    resultsWanted: number,
    format?: DescriptionFormat,
  ): JobResponseDto {
    const jobPosts: JobPostDto[] = [];
    for (const listing of listings) {
      if (jobPosts.length >= resultsWanted) break;
      try {
        const post = this.mapSimpleListing(listing, format);
        if (post) jobPosts.push(post);
      } catch (err: any) {
        this.logger.debug(`Wellfound: failed to map listing: ${err.message}`);
      }
    }
    return new JobResponseDto(jobPosts);
  }

  private mapSimpleListing(
    listing: WellfoundListing,
    format?: DescriptionFormat,
  ): JobPostDto | null {
    if (!listing.title) return null;

    const id = `wellfound-${listing.id}`;
    const companyName = listing.company?.name ?? null;
    const jobSlug = listing.slug ?? String(listing.id);
    const jobUrl = jobSlug.startsWith('http')
      ? jobSlug
      : `https://wellfound.com/jobs/${jobSlug}`;

    const locationStr = listing.locations?.[0] ?? null;
    const location = locationStr ? new LocationDto({ city: locationStr }) : null;

    return new JobPostDto({
      id,
      title: listing.title,
      companyName,
      jobUrl,
      location,
      datePosted: listing.createdAt
        ? new Date(listing.createdAt).toISOString().split('T')[0]
        : null,
      isRemote: listing.remote ?? false,
      site: Site.WELLFOUND,
    });
  }

  private sampleShape(data: WellfoundNextData): string {
    try {
      const keys = Object.keys(data);
      const propsKeys = data.props ? Object.keys(data.props) : [];
      const pagePropsKeys = data.props?.pageProps ? Object.keys(data.props.pageProps) : [];
      const sampleVal = data.props?.pageProps
        ? Object.keys(data.props.pageProps).slice(0, 5).map((k) => {
            const v = (data.props!.pageProps! as any)[k];
            return `${k}:${Array.isArray(v) ? `Array(${v.length})` : typeof v}`;
          }).join(', ')
        : '';
      return `root:[${keys.slice(0, 5)}] props:[${propsKeys.slice(0, 5)}] pageProps:[${pagePropsKeys.slice(0, 10)}] samples:{${sampleVal}}`;
    } catch {
      return 'unable to inspect shape';
    }
  }

  private extractListings(data: WellfoundNextData): WellfoundListing[] {
    const pageProps = data.props?.pageProps;
    if (pageProps?.listings && Array.isArray(pageProps.listings)) {
      return pageProps.listings;
    }
    if (pageProps?.jobs && Array.isArray(pageProps.jobs)) {
      return pageProps.jobs;
    }
    if (pageProps?.jobListings && Array.isArray(pageProps.jobListings)) {
      return pageProps.jobListings;
    }
    if (pageProps?.results && Array.isArray(pageProps.results)) {
      return pageProps.results;
    }

    const found = this.findListingsDeep(data, 4);
    return found;
  }

  private buildJobPostsFromListings(
    listings: WellfoundListing[],
    resultsWanted: number,
    format?: DescriptionFormat,
  ): JobResponseDto {
    const jobPosts: JobPostDto[] = [];
    for (const listing of listings) {
      if (jobPosts.length >= resultsWanted) break;
      try {
        const post = this.mapListing(listing, format);
        if (post) jobPosts.push(post);
      } catch (err: any) {
        this.logger.debug(`Wellfound: failed to map listing: ${err.message}`);
      }
    }
    return new JobResponseDto(jobPosts);
  }

  private findListingsDeep(obj: unknown, maxDepth: number): WellfoundListing[] {
    if (maxDepth <= 0 || !obj || typeof obj !== 'object') return [];

    if (Array.isArray(obj)) {
      const sample = obj[0];
      if (
        sample &&
        typeof sample === 'object' &&
        'title' in sample &&
        ('company' in sample || 'companyName' in sample)
      ) {
        return obj as WellfoundListing[];
      }
      return [];
    }

    for (const value of Object.values(obj)) {
      const result = this.findListingsDeep(value, maxDepth - 1);
      if (result.length > 0) return result;
    }

    return [];
  }

  private mapListing(
    listing: WellfoundListing,
    format?: DescriptionFormat,
  ): JobPostDto | null {
    if (!listing.title) return null;

    const id = `wellfound-${listing.id}`;
    const companyName = listing.company?.name ?? null;
    const companySlug = listing.company?.slug ?? '';
    const jobSlug = listing.slug ?? String(listing.id);
    const jobUrl = `https://wellfound.com/jobs/${jobSlug}`;

    let description: string | null = null;
    if (listing.description) {
      if (format === DescriptionFormat.HTML) {
        description = listing.description;
      } else if (format === DescriptionFormat.MARKDOWN) {
        description = markdownConverter(listing.description) ?? listing.description;
      } else {
        description = htmlToPlainText(listing.description);
      }
    }

    const locationStr = listing.locations?.[0] ?? null;
    const location = locationStr ? new LocationDto({ city: locationStr }) : null;

    let compensation: CompensationDto | null = null;
    if (listing.compensation?.min != null || listing.compensation?.max != null) {
      compensation = new CompensationDto({
        interval: CompensationInterval.YEARLY,
        minAmount: listing.compensation.min ?? undefined,
        maxAmount: listing.compensation.max ?? undefined,
        currency: listing.compensation.currency ?? 'USD',
      });
    }

    const datePosted = listing.createdAt
      ? new Date(listing.createdAt).toISOString().split('T')[0]
      : null;

    return new JobPostDto({
      id,
      title: listing.title,
      companyName,
      companyLogo: listing.company?.logoUrl ?? null,
      jobUrl,
      location,
      description,
      compensation,
      datePosted,
      isRemote: listing.remote ?? false,
      emails: extractEmails(description),
      site: Site.WELLFOUND,
      skills: listing.skills?.length ? listing.skills : null,
    });
  }

  async onModuleDestroy(): Promise<void> {
    await BrowserPool.close();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

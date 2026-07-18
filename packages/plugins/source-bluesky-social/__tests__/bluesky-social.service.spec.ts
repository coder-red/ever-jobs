import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { JobResponseDto, ScraperInputDto, Site } from '@ever-jobs/models';

// Mock createHttpClient so the scraper hits controlled fixtures instead of
// the live Bluesky AppView.
const mockGet = jest.fn();
jest.mock('@ever-jobs/common', () => {
  const actual = jest.requireActual('@ever-jobs/common');
  return {
    ...actual,
    createHttpClient: jest.fn(() => ({ get: mockGet })),
  };
});

import { BlueskySocialModule, BlueskySocialService } from '../src';

function post(overrides: Record<string, unknown> = {}) {
  return {
    uri: 'at://did:plc:abc/app.bsky.feed.post/rkey1',
    cid: 'cid-1',
    author: { did: 'did:plc:abc', handle: 'acme.bsky.social', displayName: 'Acme AI' },
    record: { text: 'We are hiring a remote AI engineer! DM me.', createdAt: '2026-07-15T10:00:00Z' },
    ...overrides,
  };
}

describe('BlueskySocialService', () => {
  beforeEach(() => mockGet.mockReset());

  it('resolves through BlueskySocialModule via NestJS DI', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [BlueskySocialModule],
    }).compile();
    expect(moduleRef.get(BlueskySocialService)).toBeInstanceOf(BlueskySocialService);
    await moduleRef.close();
  });

  it('pins Site.BLUESKY_SOCIAL = "bluesky_social"', () => {
    expect(Site.BLUESKY_SOCIAL).toBe('bluesky_social');
  });

  it('maps a hiring post to a canonical JobPostDto', async () => {
    // First query returns the hit; the rest return empty.
    mockGet
      .mockResolvedValueOnce({ data: { posts: [post()] } })
      .mockResolvedValue({ data: { posts: [] } });

    const service = new BlueskySocialService();
    const result = await service.scrape({ resultsWanted: 25 } as ScraperInputDto);

    expect(result).toBeInstanceOf(JobResponseDto);
    expect(result.jobs).toHaveLength(1);
    const j = result.jobs[0];
    expect(j.id).toBe('bluesky-social-cid-1');
    expect(j.companyName).toBe('Acme AI');
    expect(j.jobUrl).toBe('https://bsky.app/profile/acme.bsky.social/post/rkey1');
    expect(j.isRemote).toBe(true);
    expect(j.datePosted).toBe('2026-07-15');
    expect(j.site).toBe(Site.BLUESKY_SOCIAL);
  });

  it('dedupes the same post returned across multiple queries', async () => {
    mockGet.mockResolvedValue({ data: { posts: [post()] } });
    const service = new BlueskySocialService();
    const result = await service.scrape({ resultsWanted: 25 } as ScraperInputDto);
    expect(result.jobs).toHaveLength(1);
  });

  it('rejects job-SEEKER posts (open to work)', async () => {
    mockGet.mockResolvedValue({
      data: {
        posts: [
          post({
            cid: 'cid-2',
            record: { text: 'I am looking for a job as an AI engineer #opentowork', createdAt: '2026-07-15T10:00:00Z' },
          }),
        ],
      },
    });
    const service = new BlueskySocialService();
    const result = await service.scrape({ resultsWanted: 25 } as ScraperInputDto);
    expect(result.jobs).toEqual([]);
  });

  it('rejects posts with no hiring signal', async () => {
    mockGet.mockResolvedValue({
      data: {
        posts: [
          post({ cid: 'cid-3', record: { text: 'AI engineering is a fascinating field to study.', createdAt: '2026-07-15T10:00:00Z' } }),
        ],
      },
    });
    const service = new BlueskySocialService();
    const result = await service.scrape({ resultsWanted: 25 } as ScraperInputDto);
    expect(result.jobs).toEqual([]);
  });

  it('returns empty JobResponseDto on HTTP error (never throws)', async () => {
    mockGet.mockRejectedValue(new Error('Request failed with status 500'));
    const service = new BlueskySocialService();
    await expect(
      service.scrape({ resultsWanted: 25 } as ScraperInputDto),
    ).resolves.toBeInstanceOf(JobResponseDto);
  });

  it('honours resultsWanted cap', async () => {
    mockGet.mockResolvedValue({
      data: {
        posts: [
          post({ uri: 'at://x/app.bsky.feed.post/r1', cid: 'c1' }),
          post({ uri: 'at://x/app.bsky.feed.post/r2', cid: 'c2' }),
          post({ uri: 'at://x/app.bsky.feed.post/r3', cid: 'c3' }),
        ],
      },
    });
    const service = new BlueskySocialService();
    const result = await service.scrape({ resultsWanted: 2 } as ScraperInputDto);
    expect(result.jobs).toHaveLength(2);
  });
});

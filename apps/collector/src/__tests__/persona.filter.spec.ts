import { JobPostDto } from '@ever-jobs/models';
import {
  isGradRole,
  isRemoteRole,
  isSeniorRole,
  matchesAiRole,
  matchesJuniorLevel,
  matchesPersona,
  normalizeJobUrl,
} from '../filters/persona.filter';

describe('persona.filter', () => {
  const baseJob = (overrides: Partial<JobPostDto> = {}): JobPostDto =>
    ({
      title: 'Junior AI Engineer',
      jobUrl: 'https://example.com/jobs/1?utm_source=abc',
      companyName: 'Acme',
      isRemote: true,
      ...overrides,
    }) as JobPostDto;

  it('matches junior remote AI roles', () => {
    expect(matchesPersona(baseJob())).toBe(true);
  });

  it('rejects senior titles', () => {
    expect(
      matchesPersona(
        baseJob({ title: 'Senior Machine Learning Engineer', isRemote: true }),
      ),
    ).toBe(false);
  });

  it('rejects non-AI titles', () => {
    expect(matchesPersona(baseJob({ title: 'Junior Frontend Engineer' }))).toBe(
      false,
    );
  });

  it('rejects on-site roles without remote signal', () => {
    expect(
      matchesPersona(
        baseJob({
          title: 'Junior AI Engineer',
          isRemote: false,
          location: { city: 'Austin', state: 'TX', country: 'US' } as JobPostDto['location'],
        }),
      ),
    ).toBe(false);
  });

  it('accepts remote via location text', () => {
    expect(
      isRemoteRole(
        baseJob({
          isRemote: false,
          location: { city: 'Remote', state: null, country: 'US' } as JobPostDto['location'],
        }),
      ),
    ).toBe(true);
  });

  it('normalizes tracking params from urls', () => {
    expect(
      normalizeJobUrl('https://Example.com/j/1?utm_source=x&ref=y'),
    ).toBe('https://example.com/j/1');
  });

  it('detects AI and junior patterns independently', () => {
    expect(matchesAiRole('Entry Level ML Engineer')).toBe(true);
    expect(matchesJuniorLevel('Entry Level ML Engineer')).toBe(true);
    expect(isSeniorRole('Staff AI Engineer')).toBe(true);
  });

  it('rejects new-grad / campus roles even when jobLevel says junior', () => {
    expect(
      matchesPersona(
        baseJob({ title: 'AI Engineer (New Graduate Program)' }),
      ),
    ).toBe(false);
    expect(isGradRole('Class of 2025 AI Engineer')).toBe(true);
    expect(isGradRole('University Recruiter - AI')).toBe(true);
  });

  it('requires junior signal in title (jobLevel alone is not enough)', () => {
    // AI in title, "Entry-level" only in jobLevel, no junior in title -> reject
    expect(
      matchesPersona(
        baseJob({
          title: 'AI Trainer',
          jobLevel: 'Entry-level',
        }),
      ),
    ).toBe(false);
  });

  it('accepts AI Trainer role if title has explicit junior signal', () => {
    expect(
      matchesPersona(
        baseJob({ title: 'Junior AI Trainer' }),
      ),
    ).toBe(true);
  });
});

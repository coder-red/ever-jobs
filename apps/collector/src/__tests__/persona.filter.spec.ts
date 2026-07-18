import { JobPostDto } from '@ever-jobs/models';
import {
  isGradRole,
  isHugeCompany,
  isNigeriaRole,
  isRemoteRole,
  isSeniorRole,
  isZeroExpFriendly,
  matchesAiMlRemoteRole,
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

  it('rejects AI Trainer / Scientist / Researcher roles', () => {
    expect(
      matchesPersona(
        baseJob({ title: 'Junior AI Trainer' }),
      ),
    ).toBe(false);
    expect(
      matchesPersona(
        baseJob({ title: 'AI Research Scientist' }),
      ),
    ).toBe(false);
    expect(
      matchesPersona(
        baseJob({ title: 'Applied Scientist' }),
      ),
    ).toBe(false);
    expect(
      matchesPersona(
        baseJob({ title: 'Data Scientist' }),
      ),
    ).toBe(false);
  });

  describe('matchesAiMlRemoteRole (active collector filter)', () => {
    const ngLoc = { city: 'Lagos', state: 'Lagos', country: 'Nigeria' } as JobPostDto['location'];
    const usLoc = { city: 'Austin', state: 'TX', country: 'US' } as JobPostDto['location'];

    it('rejects senior AI roles INTERNATIONALLY (user wants junior)', () => {
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Senior AI Engineer', isRemote: true, location: usLoc })),
      ).toBe(false);
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Staff Machine Learning Engineer', isRemote: true, location: usLoc })),
      ).toBe(false);
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Lead ML Engineer', isRemote: true, location: usLoc })),
      ).toBe(false);
    });

    it('accepts Nigerian AI/ML roles even when on-site', () => {
      expect(
        matchesAiMlRemoteRole(
          baseJob({ title: 'AI Engineer', isRemote: false, location: ngLoc }),
        ),
      ).toBe(true);
    });

    it('accepts SENIOR Nigerian AI/ML roles (seniority ignored for Nigeria)', () => {
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Senior AI Engineer', isRemote: false, location: ngLoc })),
      ).toBe(true);
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Lead Machine Learning Engineer', isRemote: false, location: ngLoc })),
      ).toBe(true);
    });

    it('accepts broad Nigerian AI/ML roles (data scientist, NLP, researcher)', () => {
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Data Scientist', isRemote: false, location: ngLoc })),
      ).toBe(true);
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Machine Learning Researcher', isRemote: false, location: ngLoc })),
      ).toBe(true);
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'NLP Specialist', isRemote: false, location: ngLoc })),
      ).toBe(true);
    });

    it('rejects non-AI Nigerian roles', () => {
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Frontend Developer', isRemote: false, location: ngLoc })),
      ).toBe(false);
    });

    it('accepts Nigerian AI/ML roles from a huge company', () => {
      expect(
        matchesAiMlRemoteRole(
          baseJob({ title: 'ML Engineer', companyName: 'Microsoft', isRemote: false, location: ngLoc }),
        ),
      ).toBe(true);
    });

    it('rejects international on-site AI/ML roles', () => {
      expect(
        matchesAiMlRemoteRole(
          baseJob({ title: 'AI Engineer', isRemote: false, location: usLoc }),
        ),
      ).toBe(false);
    });

    it('accepts international remote AI/ML roles at small companies', () => {
      expect(
        matchesAiMlRemoteRole(
          baseJob({ title: 'AI Engineer', companyName: 'Acme', isRemote: true, location: usLoc }),
        ),
      ).toBe(true);
    });

    it('rejects international remote roles at huge companies (slim odds)', () => {
      expect(
        matchesAiMlRemoteRole(
          baseJob({ title: 'AI Engineer', companyName: 'Google', isRemote: true, location: usLoc }),
        ),
      ).toBe(false);
    });

    it('rejects scientist roles INTERNATIONALLY (engineer only abroad)', () => {
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'AI Research Scientist', isRemote: true, location: usLoc })),
      ).toBe(false);
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'Data Scientist', isRemote: true, location: usLoc })),
      ).toBe(false);
    });

    it('rejects non-job posts (founder/trainer/participant) even in Nigeria', () => {
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'AI Trainer', location: ngLoc })),
      ).toBe(false);
      expect(
        matchesAiMlRemoteRole(baseJob({ title: 'AI Co-Founder', location: ngLoc })),
      ).toBe(false);
    });

    it('isNigeriaRole detects country field and city text', () => {
      expect(isNigeriaRole(baseJob({ location: ngLoc }))).toBe(true);
      expect(isNigeriaRole(baseJob({ title: 'ML Engineer - Abuja' }))).toBe(true);
      expect(isNigeriaRole(baseJob({ location: usLoc }))).toBe(false);
    });

    it('isHugeCompany flags big tech only', () => {
      expect(isHugeCompany(baseJob({ companyName: 'Amazon Web Services' }))).toBe(true);
      expect(isHugeCompany(baseJob({ companyName: 'Acme AI' }))).toBe(false);
      expect(isHugeCompany(baseJob({ companyName: null }))).toBe(false);
    });
  });

  describe('isZeroExpFriendly', () => {
    it('passes null/empty description', () => {
      expect(isZeroExpFriendly(null)).toBe(true);
      expect(isZeroExpFriendly(undefined)).toBe(true);
      expect(isZeroExpFriendly('')).toBe(true);
    });

    it('rejects 2+ years experience requirement', () => {
      expect(isZeroExpFriendly('Requires 2+ years of experience in ML')).toBe(false);
      expect(isZeroExpFriendly('Must have 3 years experience with Python')).toBe(false);
      expect(isZeroExpFriendly('5+ years professional experience required')).toBe(false);
    });

    it('rejects 1+ year without portfolio alternative', () => {
      expect(isZeroExpFriendly('1+ year of experience with AI frameworks')).toBe(false);
      expect(isZeroExpFriendly('At least 1 year experience in software engineering')).toBe(false);
    });

    it('passes 1+ year with portfolio alternative', () => {
      expect(
        isZeroExpFriendly('1+ year experience or strong GitHub portfolio'),
      ).toBe(true);
      expect(
        isZeroExpFriendly('Requires 2+ years experience or equivalent open source contributions'),
      ).toBe(true);
    });

    it('passes on zero-exp positive signals', () => {
      expect(isZeroExpFriendly('No experience required. Training provided.')).toBe(true);
      expect(isZeroExpFriendly('No prior experience needed. We train.')).toBe(true);
      expect(isZeroExpFriendly('0 years of experience required')).toBe(true);
    });

    it('rejects experience ranges >= 2', () => {
      expect(isZeroExpFriendly('2-4 years of experience in ML')).toBe(false);
      expect(isZeroExpFriendly('3-5 years Python experience')).toBe(false);
    });

    it('passes range 0-1 years', () => {
      expect(isZeroExpFriendly('0-1 years experience, training provided')).toBe(true);
    });

    it('rejects jobs with 2+ years via matchesPersona', () => {
      expect(
        matchesPersona(
          baseJob({
            title: 'Junior AI Engineer',
            description: 'Requires 2+ years of ML experience',
          }),
        ),
      ).toBe(false);
    });

    it('passes jobs with portfolio alternative via matchesPersona', () => {
      expect(
        matchesPersona(
          baseJob({
            title: 'AI Engineer',
            description: '1+ year experience or GitHub portfolio accepted',
          }),
        ),
      ).toBe(true);
    });

    it('passes jobs with no description at all', () => {
      expect(
        matchesPersona(
          baseJob({ title: 'Junior AI Engineer' }),
        ),
      ).toBe(true);
    });
  });
});

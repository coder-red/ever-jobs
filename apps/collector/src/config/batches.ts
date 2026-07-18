import { Site } from '@ever-jobs/models';

export interface SourceBatch {
  readonly name: string;
  readonly sites: Site[];
}

/** Paid-key sources — excluded from default batches. */
export const PAID_SOURCES: readonly Site[] = [
  Site.EXA,
  Site.ADZUNA,
  Site.REED,
  Site.JOOBLE,
  Site.FINDWORK,
  Site.JOBDATAAPI,
  Site.AUTHENTICJOBS,
  Site.UPWORK,
  Site.CAREERJET,
  Site.TALROO,
  Site.USAJOBS,
  Site.ARBEITSAGENTUR,
  Site.JOBTECHDEV,
  Site.FRANCETRAVAIL,
];

export const DEFAULT_SEARCH_TERM =
  'AI OR "machine learning" OR LLM OR "deep learning" OR MLE OR "data scientist"';

export const SOURCE_BATCHES: readonly SourceBatch[] = [
  {
    name: 'remote-boards',
    sites: [
      // Aggregators (broad remote)
      Site.REMOTEOK,
      Site.REMOTIVE,
      Site.WEWORKREMOTELY,
      Site.JOBICY,
      Site.HIMALAYAS,
      Site.ARBEITNOW,
      Site.NODESK,
      Site.REMOTEFIRSTJOBS,
      Site.REALWORKFROMANYWHERE,
      Site.JOBSPRESSO,
      Site.VIRTUALVOCATIONS,
      Site.WORKINGNOMADS,
      Site.FOURDAYWEEK,
      // Startup-focused (pre-seed/seed heavy)
      Site.WELLFOUND,
      Site.BUILTIN,
      Site.HACKERNEWS,
      Site.BERLINSTARTUPJOBS,
      Site.ECHOJOBS,
      Site.FUNCTIONALWORKS,
      Site.POWERTOFLY,
      Site.AUTHENTICJOBS,
      // Niche tech (often early-stage, lean teams)
      Site.CRYPTOJOBSLIST,
      Site.GETONBOARD,
      Site.HASJOB,
      Site.GERMANTECHJOBS,
      // Language-specific (AI/ML adjacent)
      Site.PYJOBS,
      Site.GOLANGJOBS,
    ],
  },
  {
    name: 'major-boards',
    sites: [
      Site.LINKEDIN,
      Site.INDEED,
      Site.GOOGLE,
      Site.ZIP_RECRUITER,
      Site.GLASSDOOR,
      Site.DICE,
      Site.BUILTIN,
      Site.HACKERNEWS,
      Site.ECHOJOBS,
      Site.STARTUPJOBS,
      Site.JOINRISE,
      Site.LANDINGJOBS,
    ],
  },
  {
    name: 'social-posts',
    sites: [
      Site.HN_SOCIAL,
      Site.REDDIT_SOCIAL,
      Site.BLUESKY_SOCIAL,
    ],
  },
  {
    name: 'ng-job-boards',
    sites: [
      Site.NGDEVS,
      Site.NGJOBVACANCIES,
      Site.MYJOBMAG,
      Site.HOTNIGERIANJOBS,
      Site.AICAREERS,
      Site.NAIJAREMOTEJOBS,
      Site.JOBNOW,
      Site.JOBGURUS,
    ],
  },
];

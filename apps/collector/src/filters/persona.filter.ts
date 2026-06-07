import { JobPostDto, LocationDto } from '@ever-jobs/models';

const AI_PATTERN =
  /\b(ai|ml|machine learning|llm|nlp|deep learning|data scientist|mle)\b/i;
const JUNIOR_PATTERN =
  /\b(junior|entry[- ]?level|associate|intern(ship)?|0-2 years?|0-1 years?|early career)\b/i;
const GRAD_EXCLUDE_PATTERN =
  /\b(new[- ]?grad(uate)?|grad(uate)? (program|role|engineer|position)|campus|rotation|university|class of \d{4})\b/i;
const SENIOR_PATTERN =
  /\b(senior|staff|principal|lead|manager|director|head of|architect|sr\.|5\+ years?|7\+ years?|10\+ years?)\b/i;
const REMOTE_POSITIVE =
  /\b(remote|work from home|wfh|anywhere|distributed|worldwide|telecommute)\b/i;
const REMOTE_NEGATIVE = /\b(on[- ]site|in[- ]office)\b/i;
const HYBRID_PATTERN = /\bhybrid\b/i;

export interface PersonaFilterOptions {
  readonly allowHybrid?: boolean;
}

function formatLocation(location?: LocationDto | null): string {
  if (!location) return '';
  return [location.city, location.state, location.country].filter(Boolean).join(', ');
}

function titleBlob(job: JobPostDto): string {
  return [job.title, job.jobLevel].filter(Boolean).join(' ');
}

export function matchesAiRole(title: string): boolean {
  return AI_PATTERN.test(title);
}

export function matchesJuniorLevel(title: string): boolean {
  return JUNIOR_PATTERN.test(title);
}

export function isSeniorRole(title: string): boolean {
  return SENIOR_PATTERN.test(title);
}

export function isGradRole(title: string): boolean {
  return GRAD_EXCLUDE_PATTERN.test(title);
}

export function isRemoteRole(
  job: JobPostDto,
  options: PersonaFilterOptions = {},
): boolean {
  if (job.isRemote === true) return true;

  const location = formatLocation(job.location);
  const blob = `${job.title ?? ''} ${location}`;

  if (REMOTE_NEGATIVE.test(blob) && !REMOTE_POSITIVE.test(blob)) {
    return false;
  }

  if (!options.allowHybrid && HYBRID_PATTERN.test(blob)) {
    return false;
  }

  return REMOTE_POSITIVE.test(blob);
}

/**
 * Returns true when a job matches the junior remote AI engineer persona.
 *
 * Rules:
 *   - AI/ML signal: title OR jobLevel
 *   - Junior signal: title only (jobLevel is too inconsistent to trust alone)
 *   - Senior signal: title OR jobLevel (rejects mid/senior)
 *   - Grad signal:   title OR jobLevel (rejects campus / new-grad pipelines)
 *   - Remote signal: isRemote flag, or remote text in title+location, no on-site
 */
export function matchesPersona(
  job: JobPostDto,
  options: PersonaFilterOptions = {},
): boolean {
  if (!job.jobUrl || !job.title) return false;

  const titleOnly = job.title;
  const blob = titleBlob(job);

  if (!matchesAiRole(titleOnly) && !matchesAiRole(blob)) return false;
  if (!matchesJuniorLevel(titleOnly)) return false;
  if (isSeniorRole(titleOnly) || isSeniorRole(blob)) return false;
  if (isGradRole(titleOnly) || isGradRole(blob)) return false;
  if (!isRemoteRole(job, options)) return false;

  return true;
}

export function normalizeJobUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (key.startsWith('utm_') || key === 'ref' || key === 'source') {
        url.searchParams.delete(key);
      }
    }
    url.hostname = url.hostname.toLowerCase();
    return url.toString();
  } catch {
    return raw.trim().toLowerCase();
  }
}

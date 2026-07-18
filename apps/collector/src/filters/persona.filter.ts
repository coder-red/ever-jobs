import { JobPostDto, LocationDto } from '@ever-jobs/models';

const AI_PATTERN =
  /\b(?:ai|machine learning|artificial intelligence)\s+(?:engineer|engineering|engr)\b|\b(?:ml|ai\/ml)\s+(?:engineer|engineering|engr)\b|\bmle\b/i;
// Broad AI/ML signal — ANY role in the field (engineer, scientist, researcher,
// data science, MLOps, NLP, CV, LLM, prompt). Used for Nigeria max-coverage.
const AI_BROAD =
  /\b(?:a\.?i\.?|artificial\s+intelligence|machine\s*learning|\bml\b|ai\/ml|ml\s*ops|mlops|deep\s*learning|neural\s*network|\bnlp\b|natural\s+language|computer\s*vision|\bcv\b|\bllm\b|generative\s*ai|gen\s*ai|data\s*scien(?:ce|tist)|prompt\s+engineer)\b/i;
const JUNIOR_PATTERN =
  /\b(junior|entry[- ]?level|associate|intern(ship)?|co-?op|trainee|apprentice|0-2 years?|0-1 years?|early career)\b/i;
const GRAD_EXCLUDE_PATTERN =
  /\b(new[- ]?grad(uate)?|grad(uate)? (program|role|engineer|position)|campus|rotation|university|class of \d{4})\b/i;
const SENIOR_PATTERN =
  /\b(senior|staff|principal|lead|manager|director|head of|architect|sr\.|5\+ years?|7\+ years?|10\+ years?)\b/i;
const SCIENTIST_EXCLUDE =
  /\b(scientist|research\s+scientist|applied\s+scientist|data\s+scientist|nlp\s+scientist|cv\s+scientist|machine\s+learning\s+scientist|ai\s+scientist|staff\s+scientist|principal\s+scientist|senior\s+scientist|researcher|research\s+engineer|research\s+scientist|applied\s+researcher)\b/i;
const EXP_RANGE = /\b(\d+)\s*[-–]+\s*\d+\s*(?:years?|yrs?|yr)\b/i;
const EXP_PLUS = /\b(\d+)\+?\s*(?:years?|yrs?|yr)\s+(?:of\s+)?(?:\S+\s+)?experience\b/i;
const ZERO_EXP_POSITIVE = /\b(?:0\s+years?|no\s+(?:prior\s+|professional\s+|work\s+)?experience|entry\s*level\s+.*no\s+exp|no\s+experience\s+required|no\s+prior\s+exp)\b/i;
const PORTFOLIO_ALT = /\b(portfolio|github|side\s+project|equivalent\s+(?:experience|work)|open\s*source)\b/i;
const REMOTE_POSITIVE =
  /\b(remote|work from home|wfh|anywhere|distributed|worldwide|telecommute)\b/i;
const REMOTE_NEGATIVE = /\b(on[- ]site|in[- ]office)\b/i;
const HYBRID_PATTERN = /\bhybrid\b/i;
// Nigeria: country name, demonym, or major cities. Used to accept local roles
// regardless of remote/company (user wants EVERY Nigerian AI/ML role).
const NIGERIA_PATTERN =
  /\b(nigeria|nigerian|lagos|abuja|ibadan|kano|port\s*harcourt|benin\s*city|kaduna|enugu|abeokuta|ilorin|onitsha|warri|uyo|owerri|jos|maiduguri|lekki|ikeja|yaba|victoria\s*island)\b/i;
// Huge/very-competitive employers — excluded for INTERNATIONAL roles only
// (slim odds). Nigerian roles are never filtered by company.
const HUGE_COMPANY =
  /\b(google|alphabet|meta|facebook|microsoft|amazon|aws|apple|netflix|openai|anthropic|nvidia|tesla|ibm|oracle|intel|salesforce|adobe|uber|airbnb|spotify|linkedin|bytedance|tiktok|tencent|alibaba|baidu|samsung|deepmind|snap(chat)?|paypal|stripe|databricks|palantir|cisco|qualcomm|sap|dell|huawei|sony|deloitte|accenture|pwc|kpmg|mckinsey|jpmorgan|goldman\s*sachs|morgan\s*stanley|jane\s*street|citadel|two\s*sigma)\b/i;

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
export function isZeroExpFriendly(description?: string | null): boolean {
  if (!description) return true;

  const desc = description;

  if (ZERO_EXP_POSITIVE.test(desc)) return true;

  const portfolioMentioned = PORTFOLIO_ALT.test(desc);

  const rangeMatch = desc.match(EXP_RANGE);
  if (rangeMatch) {
    const minYears = parseInt(rangeMatch[1], 10);
    if (portfolioMentioned) return true;
    return minYears < 1;
  }

  const plusMatch = desc.match(EXP_PLUS);
  if (plusMatch) {
    const years = parseInt(plusMatch[1], 10);
    if (portfolioMentioned) return true;
    return years < 1;
  }

  return true;
}

const NON_ENGINEER_AI = /\b(co-?founder|founder|trainer(?!\s+engineer)|participant)\b/i;

/**
 * True when a job is located in Nigeria — checks the structured country field
 * first, then falls back to country/state/city text and the title.
 */
export function isNigeriaRole(job: JobPostDto): boolean {
  const country = job.location?.country;
  if (country && NIGERIA_PATTERN.test(country)) return true;
  const blob = `${job.title ?? ''} ${formatLocation(job.location)}`;
  return NIGERIA_PATTERN.test(blob);
}

/**
 * True when the employer is a huge / very-competitive company (used to skip
 * long-shot INTERNATIONAL roles; never applied to Nigerian roles).
 */
export function isHugeCompany(job: JobPostDto): boolean {
  if (!job.companyName) return false;
  return HUGE_COMPANY.test(job.companyName);
}

/**
 * Location-aware AI/ML role filter:
 *   - Nigeria (max coverage): ANY AI/ML role — engineer, scientist, researcher,
 *     data science, etc. — at ANY seniority, any company, remote or on-site.
 *     Only obvious non-jobs (founder/participant) are dropped.
 *   - International (strict): AI/ML *Engineer* only, junior-level, remote, and
 *     not a huge/competitive company (long-shot odds).
 */
export function matchesAiMlRemoteRole(
  job: JobPostDto,
  options: PersonaFilterOptions = {},
): boolean {
  if (!job.jobUrl || !job.title) return false;
  const titleOnly = job.title;
  const blob = titleBlob(job);

  // Nigeria branch — cast the widest net. Any AI/ML role, any level, any company.
  if (isNigeriaRole(job)) {
    if (NON_ENGINEER_AI.test(titleOnly)) return false;
    return AI_BROAD.test(titleOnly) || AI_BROAD.test(blob);
  }

  // International branch — strict AI/ML Engineer persona.
  const isAiRole = matchesAiRole(titleOnly) || matchesAiRole(blob);
  if (!isAiRole) return false;

  // Reject scientist/researcher/co-founder/trainer/participant — not Engineer roles
  if (SCIENTIST_EXCLUDE.test(titleOnly) || SCIENTIST_EXCLUDE.test(blob)) return false;
  if (NON_ENGINEER_AI.test(titleOnly)) return false;

  // Reject senior/staff/lead/principal/etc — user wants junior-level roles
  if (isSeniorRole(titleOnly) || isSeniorRole(blob)) return false;

  // International: remote only, and skip huge companies (slim odds).
  if (!isRemoteRole(job, options)) return false;
  if (isHugeCompany(job)) return false;

  return true;
}

export function matchesPersona(
  job: JobPostDto,
  options: PersonaFilterOptions = {},
): boolean {
  if (!job.jobUrl || !job.title) return false;

  const titleOnly = job.title;
  const blob = titleBlob(job);

  // Reject scientist/researcher titles — only AI/ML Engineer roles
  if (SCIENTIST_EXCLUDE.test(titleOnly) || SCIENTIST_EXCLUDE.test(blob)) return false;

  const isAiRole = matchesAiRole(titleOnly) || matchesAiRole(blob);
  if (!isAiRole) return false;
  // AI/ML roles pass even without junior keyword (most real MLE titles don't say
  // "junior"). Non-AI roles still need a junior signal.
  if (!isAiRole && !matchesJuniorLevel(titleOnly) && !matchesJuniorLevel(blob)) return false;
  if (isSeniorRole(titleOnly) || isSeniorRole(blob)) return false;
  if (isGradRole(titleOnly) || isGradRole(blob)) return false;
  if (!isRemoteRole(job, options)) return false;
  if (!isZeroExpFriendly(job.description)) return false;

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

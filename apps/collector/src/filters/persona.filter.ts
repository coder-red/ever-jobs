import { JobPostDto, LocationDto, Site } from '@ever-jobs/models';

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
// India — excluded everywhere except Nigeria (too much low-signal volume for
// this search). Country field is checked separately for the "IN" code.
const INDIA_PATTERN =
  /\b(india|indian|bengaluru|bangalore|hyderabad|mumbai|new\s*delhi|delhi|\bpune\b|chennai|kolkata|gurgaon|gurugram|noida|ahmedabad|jaipur|coimbatore)\b/i;
// Social sources (post-based). Handled leniently: any location (not India),
// remote or on-site, as long as it's an AI/ML hiring post.
const SOCIAL_SITES: ReadonlySet<string> = new Set([
  Site.HN_SOCIAL,
  Site.REDDIT_SOCIAL,
  Site.BLUESKY_SOCIAL,
]);
// A post that reads like an offer to hire (guards against pure AI/ML chatter).
const HIRING_SIGNAL =
  /\b(hiring|we're hiring|we are hiring|looking to hire|looking for|seeking|need(?:ed|ing)?|join (?:our|the)|apply|role|position|opening|vacancy|now hiring|job opportunity|dm me|reach out)\b/i;
// Reputable staffing firms that genuinely place juniors — allowed through even
// though they are agencies (checked BEFORE the low-quality block below).
const RECRUITER_ALLOWLIST =
  /\b(insight\s*global|teksystems|robert\s*half|randstad|adecco|aerotek|motion\s*recruitment|michael\s*page|hays|kelly\s*services|robert\s*walters|manpowergroup)\b/i;
// Recruiter / aggregator / job-mill markers — low-signal reposts, usually not
// the real employer. Includes specific offenders observed in the store.
const LOW_QUALITY_COMPANY =
  /\b(staffing|recruit(?:er|ing|ment)?|headhunt|consultanc|jobs?\s+via|\bdice\b|lensa|jobot|cybercoders|ziprecruiter|chatgpt\s*jobs|hire\s*feed|job\s*board|placement\s+(?:agency|services)|resourcing|outsourc|tekvizor|ventures\s+unlimited|crossing\s+hurdles)\b/i;
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

/** True when a job is in India (excluded everywhere except Nigeria). */
export function isIndiaRole(job: JobPostDto): boolean {
  const country = job.location?.country;
  if (country && (/india/i.test(country) || country.trim().toUpperCase() === 'IN')) {
    return true;
  }
  const blob = `${job.title ?? ''} ${formatLocation(job.location)}`;
  return INDIA_PATTERN.test(blob);
}

/** True when the job came from a post-based social source. */
export function isSocialSource(job: JobPostDto): boolean {
  return !!job.site && SOCIAL_SITES.has(job.site);
}

/**
 * True for low-signal board listings that usually aren't the real employer:
 * staffing agencies, recruiter/job-mill brands, "via X" aggregator reposts, and
 * titles carrying a staffing req-number. Reputable agencies are allow-listed.
 * Extend LOW_QUALITY_COMPANY as new offenders show up in the store.
 */
export function isLowQualityListing(job: JobPostDto): boolean {
  const company = job.companyName ?? '';
  if (RECRUITER_ALLOWLIST.test(company)) return false;
  if (LOW_QUALITY_COMPANY.test(company)) return true;
  // Substring match (no word boundary) so camelCase brands like
  // "CodeGeniusRecruit" or "TalentStaffing" are still caught.
  if (/recruit|staffing|headhunt/i.test(company)) return true;
  if (/\bvia\b/i.test(company)) return true; // "Jobs via <X>" reposts
  if (/\b\d{5,}\b/.test(job.title ?? '')) return true; // staffing ATS req-number
  return false;
}

/**
 * Location-aware AI/ML role filter:
 *   - Nigeria (max coverage): ANY AI/ML role — engineer, scientist, researcher,
 *     data science, etc. — at ANY seniority, any company, remote or on-site.
 *     Only obvious non-jobs (founder/participant) are dropped.
 *   - India: excluded everywhere except Nigeria (too much low-signal volume).
 *   - Social posts (HN/Reddit/Bluesky): ANY location (not India), remote or
 *     on-site, as long as it reads like an AI/ML hiring post.
 *   - International boards (strict): AI/ML *Engineer* only, junior-level,
 *     remote, and not a huge/competitive company (long-shot odds).
 */
export function matchesAiMlRemoteRole(
  job: JobPostDto,
  options: PersonaFilterOptions = {},
): boolean {
  if (!job.jobUrl || !job.title) return false;
  const titleOnly = job.title;
  const blob = titleBlob(job);

  // Nigeria branch — cast the widest net. Any AI/ML role, any level, any company.
  // (Checked before the India exclusion — a Nigerian role is never in India.)
  if (isNigeriaRole(job)) {
    if (NON_ENGINEER_AI.test(titleOnly)) return false;
    return AI_BROAD.test(titleOnly) || AI_BROAD.test(blob);
  }

  // Exclude India everywhere else — too noisy for this search.
  if (isIndiaRole(job)) return false;

  // Social posts — accept any location, remote or on-site, if it's an AI/ML
  // hiring post. A titled role ("ML Engineer @ X") counts as hiring intent.
  if (isSocialSource(job)) {
    const isAi = AI_BROAD.test(titleOnly) || AI_BROAD.test(blob);
    if (!isAi) return false;
    const text = `${titleOnly} ${job.description ?? ''}`;
    return HIRING_SIGNAL.test(text) || matchesAiRole(titleOnly);
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

  // Drop staffing/recruiter/aggregator reposts — usually not the real employer.
  if (isLowQualityListing(job)) return false;

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

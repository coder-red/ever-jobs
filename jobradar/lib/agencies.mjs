/**
 * Agency radar — cold-outreach leads, not job matches.
 *
 * The signal is simple: an agency posting jobs is an agency with budget, live
 * clients and a recruiter reading their inbox. Whether the roles are AI/ML is
 * irrelevant to whether it's worth a DM — an outsourcing firm staffing backend
 * roles today places AI/ML roles next quarter. AI/ML activity is scored as a
 * bonus, never a requirement.
 *
 * Input is the same corpus the job scorer sees, so this costs no extra fetches.
 * The companies rejected as "staffing mills" for job matching are precisely the
 * ones surfaced here.
 */

const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Name-based agency markers. */
const AGENCY_NAME =
  /\b(staffing|recruit\w*|talent|headhunt\w*|manpower|resourcing|placement|outsourc\w*|\bbpo\b|consult\w+|advisory|executive\s+search|search\s+partners|hr\s+(?:solutions|services|consult\w*)|human\s+(?:resource|capital)\s*\w*|workforce|employment\s+agency|job\s+centre|career\s+(?:services|partners)|people\s+(?:solutions|partners))\b/i;

/**
 * Direct employers with agency-ish name endings. Checked BEFORE the agency
 * markers, because "Frangipani Concrete Business School" contains "school",
 * "Enugu International Hospital" reads as generic corporate, and a 127-posting
 * hospital is not a firm that places AI/ML engineers.
 *
 * Suffixes like "Limited", "Group", "International" and "Services" are useless
 * as agency evidence — most Nigerian company names carry one.
 */
const DIRECT_EMPLOYER =
  /\b(school|schools|college|university|polytechnic|academy|institute|hospital|clinics?|medical\s+cent|health\s+cent|diagnostics?|pharmac|bank\b|microfinance|insurance|church|ministr(?:y|ies)|mosque|hotel|resort|restaurant|eatery|supermarket|stores?|industries|manufactur\w*|cement|breweries|distiller|farms?|agric\w*|oil\s+and\s+gas|petroleum|refiner|airlines?|airport|logistics|haulage|construction|real\s+estate|properties|dangote|nestle|unilever|shoprite|transport|\bagri\b|agro\w*|foods?\b|beverages?|telecom\w*|energy|power\b|mining|steel|plastics?|textiles?)\b/i;

/**
 * Recruiting-on-behalf language, the strongest signal of all.
 *
 * "Talent Acquisition Partner" was in here and matched iHerb's benefits
 * boilerplate — "The Talent Acquisition Partner/local HR representative will go
 * over the benefits" — turning a supplements retailer into a top-10 lead. That
 * phrase is an INTERNAL recruiter's job title, so only "...firm" counts now.
 */
const ON_BEHALF =
  /\b(on behalf of (?:our|a) client|our client (?:is|are)|recruiting to fill|is recruiting|are recruiting|client is (?:seeking|looking)|we are (?:a|an) (?:staffing|recruitment|outsourcing|talent)\s*\w*|(?:leading|reputable|reputed) (?:recruitment|staffing|outsourcing|consulting)|talent (?:acquisition|sourcing) (?:firm|agency)|we (?:connect|match) (?:talent|candidates|engineers) with)\b/i;

/**
 * Mailboxes that exist for suppliers, legal or press — never a cold-outreach
 * contact. `staffingvendors@iherb.com` is for staffing VENDORS pitching iHerb,
 * the opposite of a lead.
 */
const NON_CONTACT_MAIL =
  /^(staffingvendors?|vendors?|procurement|suppliers?|accounts?payable|ap|billing|legal|privacy|press|media|abuse|postmaster|noreply|no-reply|donotreply|webmaster|security)@/i;

/**
 * Established Nigerian recruitment / outsourcing firms whose names carry no
 * generic marker ("Alan & Grant", "Fosad", "Stresert"). Without this list they
 * are only caught when a posting happens to use recruiting-on-behalf language.
 */
const NG_AGENCY =
  /\b(alan\s*&?\s*grant|ascentech|workforce\s+group|phillips\s+consult\w*|fosad|adexen|stresert|willers\s+solutions|george\s+houston|lorache|myrtle\s+management|tempkers|smart\s+partners|erecruiter|resource\s+intermediaries|integrated\s+corporate\s+services|sunrose|pruvia|elvaridah|ralds\s*&?\s*agate|hr\s*leverage|dragnet|jobberman\s+consult|kennedia|proten\b|bualtee|estrada|matrix\s+design|nicole\s+sinclair|talents?\s+and\s+skills|owens\s*(?:and|&)\s*xley|21\s*search|hamilton\s+lloyd|michael\s+stevens|human\s+capital\s+partners|kimberly\s+ryan|whyte\s*cleon|outsource\s+nigeria|eco\s*bank\s+talent)\b/i;

/** Firms that place engineers globally — highest value for a remote candidate. */
// `crossover` needs the lookahead: "Crossover Health" is a medical group, not
// Crossover.com the talent marketplace, and it was ranking as a top-10 lead.
const GLOBAL_TALENT =
  /\b(andela|toptal|turing|deel|remote\.?com|oyster|gun\.?io|arc\.dev|xteam|x-team|crossover(?!\s+health)|revelo|terminal|lemon\.io|proxify|upstack|scalable\s*path|soshace|teamed|howdy|tecla|virtualstaff|remotebase|talently|microverse|gebeya|decagon|semicolon|utiva|genesys\s*tech|tek\s*experts|teknowledge|alx|sand\s*tech)\b/i;

const NIGERIA =
  /\b(nigeria|nigerian|lagos|abuja|ibadan|kano|port\s*harcourt|benin\s*city|kaduna|enugu|abeokuta|ilorin|lekki|ikeja|yaba|victoria\s*island|ikoyi)\b/i;

const AI_SIGNAL =
  /\b(a\.?i\.?|artificial\s+intelligence|machine\s*learning|\bml\b|ai\/ml|mlops|deep\s*learning|\bnlp\b|computer\s*vision|\bllm\b|generative\s+ai|data\s+scien(?:ce|tist))\b/i;

const TECH_SIGNAL =
  /\b(engineer|developer|software|backend|frontend|full\s*stack|devops|cloud|python|java|javascript|node|react|data|analyst|qa\b|tester|architect|programmer|technical|\bit\b|cyber|security)\b/i;

/** Gig platforms and job boards are not outreach targets. */
const NOT_AN_AGENCY =
  /\b(mercor|scale\s*ai|surge\s*ai|outlier|remotasks|appen|clickworker|prolific|dataannotation|alignerr|toloka|cloudfactory|peroptyx|welocalize|indeed|ziprecruiter|linkedin|glassdoor|myjobmag|jobberman|hotnigerianjobs|remoteok|remotive|jobicy|arbeitnow|weworkremotely|workingnomads|himalayas|jobs?\s+via)\b/i;

const EMAIL = /\b[A-Za-z0-9._%+-]+@(?!(?:example|sentry|domain|email|yourcompany)\.)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
const GENERIC_MAIL = /@(gmail|yahoo|outlook|hotmail|live|icloud|aol)\./i;

/**
 * Group the corpus by employer.
 * @returns {Map<string, object>}
 */
function aggregate(jobs) {
  const byCompany = new Map();
  for (const job of jobs) {
    const name = clean(job.company);
    if (!name || name.length < 3) continue;
    // A source serving a placeholder ("name", "N/A") would otherwise collapse
    // hundreds of unrelated employers into one phantom 500-posting "agency".
    if (/^(name|company|companyname|n\/?a|null|undefined|unknown|none)$/i.test(name)) continue;
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) continue;

    let rec = byCompany.get(key);
    if (!rec) {
      rec = {
        name, key, postings: 0, aiPostings: 0, techPostings: 0,
        titles: [], locations: new Set(), sources: new Set(),
        latest: null, emails: new Set(), urls: new Set(), onBehalf: false,
      };
      byCompany.set(key, rec);
    }
    rec.postings++;
    const blob = `${job.title} ${job.description ?? ''}`;
    if (AI_SIGNAL.test(job.title)) rec.aiPostings++;
    if (TECH_SIGNAL.test(job.title)) rec.techPostings++;
    if (rec.titles.length < 6) rec.titles.push(clean(job.title));
    if (job.location) rec.locations.add(clean(job.location).slice(0, 40));
    rec.sources.add(job.source);
    if (job.url) rec.urls.add(job.url);
    if (ON_BEHALF.test(blob)) rec.onBehalf = true;
    const t = job.postedAt ? Date.parse(job.postedAt) : NaN;
    if (!Number.isNaN(t) && (rec.latest === null || t > rec.latest)) rec.latest = t;
    for (const m of (job.description ?? '').match(EMAIL) ?? []) {
      if (rec.emails.size < 3) rec.emails.add(m.toLowerCase());
    }
  }
  return byCompany;
}

function classify(rec) {
  if (NOT_AN_AGENCY.test(rec.name)) return null;

  const globalHit = GLOBAL_TALENT.test(rec.name);
  const ngHit = NG_AGENCY.test(rec.name);
  // A named talent firm wins outright; otherwise a direct employer is never a
  // lead, however agency-shaped its name looks.
  if (!globalHit && !ngHit && DIRECT_EMPLOYER.test(rec.name)) return null;

  const nameHit = AGENCY_NAME.test(rec.name);

  // Real evidence only: a known firm, a recruitment/outsourcing name, or
  // explicit recruiting-on-behalf language. Generic corporate suffixes
  // ("Limited", "Group", "International") are not evidence.
  const isAgency = globalHit || ngHit || nameHit || rec.onBehalf;
  if (!isAgency) return null;

  const reasons = [];
  let score = 0;

  if (globalHit) { score += 34; reasons.push('places engineers globally'); }
  else if (ngHit) { score += 26; reasons.push('established Nigerian recruiter'); }
  else if (nameHit) { score += 20; reasons.push('recruitment/outsourcing firm'); }
  else { score += 18; reasons.push('recruits on behalf of clients'); }

  if (rec.onBehalf && !reasons.some((r) => r.includes('behalf'))) {
    score += 8; reasons.push('recruits on behalf of clients');
  }

  // Hiring volume — the core signal. An agency posting a lot is an agency
  // actively placing people.
  if (rec.postings >= 20) { score += 26; reasons.push(`${rec.postings} live postings`); }
  else if (rec.postings >= 8) { score += 20; reasons.push(`${rec.postings} live postings`); }
  else if (rec.postings >= 3) { score += 13; reasons.push(`${rec.postings} live postings`); }
  else { score += 5; reasons.push(`${rec.postings} live posting${rec.postings > 1 ? 's' : ''}`); }

  // Recency — a firm that posted this week is reading its inbox this week.
  if (rec.latest !== null) {
    const age = (Date.now() - rec.latest) / 86_400_000;
    if (age <= 7) { score += 16; reasons.push('posted this week'); }
    else if (age <= 21) { score += 9; reasons.push('posted this month'); }
    else if (age > 90) { score -= 10; reasons.push('nothing recent'); }
  }

  // AI/ML activity is a bonus, never a gate — the brief is explicit about this.
  if (rec.aiPostings > 0) {
    score += Math.min(18, 8 + rec.aiPostings * 2);
    reasons.push(`${rec.aiPostings} AI/ML role${rec.aiPostings > 1 ? 's' : ''} already`);
  } else if (rec.techPostings > 0) {
    score += 8; reasons.push('hires technical roles');
  }

  // A cold DM about AI/ML work lands better with a firm that actually places
  // engineers. General-staffing recruiters (fleet managers, marketers) are
  // still leads, but they rank below the technical placers.
  const techShare = rec.postings ? rec.techPostings / rec.postings : 0;
  const placesEngineers = globalHit || techShare >= 0.4;
  if (placesEngineers) {
    score += 12;
    if (!globalHit) reasons.push('mostly technical roles');
  } else if (rec.techPostings === 0 && rec.postings >= 3) {
    score -= 8; reasons.push('no technical roles yet');
  }

  // A reachable address is what makes a lead actionable.
  const usable = [...rec.emails].filter((e) => !NON_CONTACT_MAIL.test(e));
  const realEmails = usable.filter((e) => !GENERIC_MAIL.test(e));
  const emails = realEmails.length ? realEmails : usable;
  if (emails.length) { score += 12; reasons.push('contact email on the posting'); }

  const inNigeria = NIGERIA.test(`${rec.name} ${[...rec.locations].join(' ')}`);
  if (inNigeria) { score += 6; reasons.push('Nigeria-based'); }

  return {
    ...rec,
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasons,
    emails,
    inNigeria,
    placesEngineers,
    locations: [...rec.locations].slice(0, 3),
    sources: [...rec.sources].slice(0, 3),
    sampleUrl: [...rec.urls][0] ?? null,
    linkedin: `https://www.linkedin.com/search/results/companies/?keywords=${encodeURIComponent(rec.name)}`,
  };
}

/**
 * @returns {Array} scored agency leads, best first
 */
export function findAgencies(jobs, { minScore = 45 } = {}) {
  const out = [];
  for (const rec of aggregate(jobs).values()) {
    const a = classify(rec);
    if (a && a.score >= minScore) out.push(a);
  }
  return out.sort((a, b) => b.score - a.score);
}

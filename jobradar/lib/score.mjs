/**
 * Scoring + filtering: "jobs you actually stand a chance at".
 *
 * Two tracks, deliberately different:
 *
 *   NIGERIA  — widest possible net. Any AI/ML role, any seniority, any company,
 *              remote or on-site. Only obvious non-jobs are dropped.
 *   INTL     — must be an AI/ML *engineering* role, entry-friendly, AND pass a
 *              geo-eligibility gate (can a Nigeria-based person actually be
 *              hired?). That gate is the thing the old pipeline never had.
 */

// ---------------------------------------------------------------- role signal

const AI_SIGNAL =
  /\b(a\.?i\.?|artificial\s+intelligence|machine\s*learning|\bml\b|ai\/ml|ml\s*ops|mlops|deep\s*learning|neural\s*net|\bnlp\b|natural\s+language|computer\s*vision|\bllm\b|large\s+language\s+model|generative\s+ai|gen\s*ai|\brag\b|retrieval[- ]augmented|pytorch|tensorflow|hugging\s*face|\bmle\b|data\s+scien(?:ce|tist)|prompt\s+engineer)\b/i;

/**
 * Deliberately narrow. "analyst"/"specialist"/"consultant" were in here and let
 * "Global Treasury Analyst" and "Ubuntu Sales Engineer" through — they only
 * count when the title ALSO carries an AI/ML signal, which the caller enforces.
 */
const ENGINEER_WORD =
  /\b(engineer|engineering|engr|developer|dev\b|programmer|mlops|ml\s*ops|scientist|researcher)\b/i;

/** Non-technical function words — an AI/ML title with one of these isn't the job. */
const NON_TECH_FUNCTION =
  /\b(sales|account\s+executive|business\s+development|marketing|treasury|finance|accounting|payroll|recruit\w*|customer\s+(?:success|support)|community\s+manager|copywriter|content\s+(?:writer|analyst|manager)|social\s+media|legal|counsel|procurement|operations\s+manager|office\s+manager)\b/i;

/**
 * Teaching AI is a different career from building it. Matched on both tracks:
 * "Artificial Intelligence Tutor", "AI Facilitator at <college>" and
 * "AI/ML Engineering Instructor" all reached Telegram before this existed —
 * the gig filter only caught the abbreviated "AI Tutor" form.
 * Delete this rule if you also want teaching roles.
 */
const EDUCATION_ROLE =
  /\b(tutor|instructor|facilitator|teacher|teaching|lecturer|professor|\breader\b|graduate\s+assistant|teaching\s+assistant|curriculum|course\s+(?:developer|creator)|trainer|coach|academy|school\s+of)\b/i;

// ------------------------------------------------------- hard rejects (both)

/**
 * Gig / data-labeling / "AI trainer" work. This is the single biggest source of
 * the noise that reached the old Telegram feed (Mercor CUDA "AI Trainer",
 * "Voice AI Research Participant"). It is piecework, not an engineering job.
 */
const GIG_TITLE =
  /\b(ai\s+(?:trainer|tutor|coach|teacher)|data\s+(?:annotat\w*|label\w*)|annotator|labell?er|rlhf\s+\w+|research\s+participant|study\s+participant|survey\s+taker|transcri(?:ber|ption|bist)|voice\s+(?:actor|talent|recording)|speech\s+data|content\s+(?:writer|reviewer|analyst)|prompt\s+writer|freelance\s+writer|subject\s+matter\s+expert|\bsme\b\s+contributor|quiz\s+writer|exam\s+writer|task\s+contributor|(?:search|ads?|social\s+media|internet|web\s+search)\s+(?:quality\s+)?(?:rater|evaluator|assessor|analyst)|media\s+(?:rater|evaluator)|map\s+analyst|personalized\s+internet)\b/i;

const GIG_COMPANY =
  /\b(mercor|scale\s*ai|surge\s*ai|surgehq|outlier\s*ai|outlier\b|remotasks|appen|telus\s+(?:international|digital)|lionbridge|clickworker|prolific|invisible\s+technologies|dataannotation|data\s*annotation\.tech|alignerr|micro1|toloka|sama\b|samasource|cloudfactory|handshake\s+ai|snorkel\s+gig|welo\s*cali|welo\s*data|centific|uolo|labelbox\s+workforce|peroptyx|welocalize|\brws\b|transperfect|oneforma|isahit|daproducts|teemwork|sigma\s+ai)\b/i;

/** Equity-only founder posts — not a job you can take from Nigeria. */
const FOUNDER =
  /\b(co-?founder|founding\s+(?:partner|member)|cto\s+co|equity[- ]only|unpaid|volunteer(?!\s+manager)|profit[- ]share|sweat\s+equity)\b/i;

/**
 * Staffing mills / repost farms. Seeded from the offenders actually found in
 * your old collector.json, then extended.
 */
const MILL_COMPANY =
  /\b(staffing|recruit(?:er|ing|ment)?|headhunt\w*|talent\s+(?:solutions|acquisition\s+firm)|consultanc\w+|jobs?\s+via\b|\bdice\b|lensa|jobot|cybercoders|ziprecruiter|chatgpt\s*jobs|hire\s*feed|hirefeed|job\s*board|placement\s+(?:agency|services)|resourcing|outsourc\w+|tekvizor|ventures\s+unlimited|crossing\s+hurdles|codegenius\w*|yo\s*hr|sundayy|get\.?it\s+recruit|diverse\s+lynx|mindlance|apidel|akkodis|collabera|infojini|artech|nlb\s+services|us\s+tech\s+solutions)\b/i;

/** Reputable agencies that genuinely place juniors — exempt from MILL_COMPANY. */
const AGENCY_ALLOW =
  /\b(insight\s*global|teksystems|robert\s*half|randstad|adecco|michael\s*page|hays\b|robert\s*walters|manpower\w*)\b/i;

/** Scam / pay-to-work markers. */
const SCAM =
  /\b(registration\s+fee|pay\s+(?:a\s+)?fee|training\s+fee|no\s+experience\s+earn|earn\s+\$?\d+\s*(?:daily|per\s+day)|work\s+from\s+home\s+typing|data\s+entry\s+from\s+home|crypto\s+recovery|forex\s+signal)\b/i;

// --------------------------------------------------------- seniority (intl)

const SENIOR_BLOCK =
  /\b(senior|snr\b|sr\.?\s|staff(?!ing)\b|principal|lead\s+(?:engineer|scientist|developer|data)|tech\s+lead|director|head\s+of|vp\s+of|vice\s+president|manager|architect|expert\b|distinguished|fellow\b|(?:5|6|7|8|9|10|11|12|15)\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?))\b/i;

/**
 * Mega-cap / elite employers. Excluded on the INTERNATIONAL track only: for an
 * entry-level candidate applying from Nigeria these are lottery tickets, not
 * leads. Nigerian roles are never filtered by company.
 */
const HUGE_COMPANY =
  /\b(google|alphabet|meta|facebook|microsoft|amazon|aws|apple|netflix|openai|anthropic|nvidia|tesla|ibm|oracle|intel|salesforce|adobe|uber|airbnb|spotify|linkedin|pinterest|bytedance|tiktok|tencent|alibaba|baidu|samsung|deepmind|snap(?:chat)?|paypal|stripe|databricks|palantir|cisco|qualcomm|\bsap\b|dell|huawei|sony|shopify|coinbase|reddit|twitter|\bx\.ai\b|deloitte|accenture|\bpwc\b|kpmg|mckinsey|jpmorgan|goldman\s*sachs|morgan\s*stanley|jane\s*street|citadel|two\s*sigma)\b/i;

const ENTRY_POSITIVE =
  /\b(junior|jr\.?\b|entry[- ]?level|intern(?:ship)?\b|graduate|new\s*grad|trainee|apprentice|associate|early\s+career|career\s+(?:switch|change)|bootcamp|0\s*[-–]\s*2\s*years?|1\s*[-–]\s*2\s*years?|0\s*[-–]\s*1\s*years?|no\s+(?:prior\s+)?experience\s+required|fresh\s+graduate|beginner)\b/i;

/** Low year-count requirement, e.g. "2+ years" — still reachable at entry. */
const LOW_YEARS = /\b([0-3])\s*\+?\s*(?:years?|yrs?)\b/i;

// -------------------------------------------------- geo eligibility (intl)

/**
 * Route A — open to the whole world. Deliberately excludes bare "from anywhere"
 * and "globally", which matched marketing boilerplate on Berlin on-site roles.
 */
const ELIG_WORLDWIDE =
  /\b(worldwide|world\s*wide|anywhere\s+in\s+the\s+world|work\s+from\s+anywhere|global\s+remote|remote\s*[-–,:]?\s*(?:global|worldwide|anywhere)|any\s+(?:country|location|time\s*zone|timezone)|fully\s+distributed|location[- ]independent|100%\s+remote\s+global|no\s+location\s+restriction)\b/i;

/** A location field naming one concrete place — can't also be "worldwide". */
const CITY_LOCATION = /^[A-Za-zÀ-ÿ .'-]{3,30}$/;

/** Board-level "anywhere"/"remote" placeholders that aren't a real restriction. */
const OPEN_PLACEHOLDER = /^\s*(anywhere|remote|global|worldwide|any|n\/?a|-|—)?\s*$/i;

/**
 * Remote-only boards. A listing here with NO stated location restriction is
 * weak evidence of openness, not a reason to reject — RemoteOK in particular
 * leaves `location` empty on most worldwide roles. Credited modestly so the
 * score floor, not the gate, makes the final call.
 */
const REMOTE_FIRST_SOURCES = new Set([
  'remoteok', 'weworkremotely', 'workingnomads', 'remotive', 'himalayas', 'jobicy',
]);

/** Route B — Africa / Nigeria / EMEA / GMT-overlap explicitly in scope. */
const ELIG_AFRICA =
  /\b(africa|african|nigeria|nigerian|lagos|abuja|sub[- ]saharan|west\s+africa|\bemea\b|europe,?\s+middle\s+east|\bcet\b|\bcest\b|\bgmt\b|\bwat\b|\butc\s*[+-]?\s*[0-3]\b|kenya|ghana|south\s+africa|nairobi)\b/i;

/** Route C — contractor / employer-of-record, realistic from Nigeria. */
const ELIG_CONTRACTOR =
  /\b(deel\b|remote\.com|oyster\s*hr|oysterhr|papaya\s*global|velocity\s*global|multiplier\b|employer\s+of\s+record|\beor\b|independent\s+contractor|contractor\s+(?:basis|agreement|role|position)|b2b\s+contract|contract\s+to\s+hire|freelance\s+(?:engineer|developer)|\b1099\b)\b/i;

/** Route D — visa sponsorship / relocation offered. */
const ELIG_VISA =
  /\b(visa\s+sponsor\w*|sponsor(?:ship)?\s+(?:is\s+)?(?:available|provided|offered|possible)|we\s+(?:can\s+)?sponsor|relocation\s+(?:package|assistance|support|bonus|provided|offered)|work\s+permit\s+(?:provided|sponsored)|blue\s*card|skilled\s+worker\s+visa|h-?1b\s+sponsor)\b/i;

/**
 * "No visa sponsorship" contains "visa sponsorship" — without this, a hard
 * refusal to sponsor was being read as an offer to sponsor.
 */
const VISA_NEGATED =
  /\b(?:no|not|non|without|cannot|can'?t|unable\s+to|do(?:es)?\s+not|won'?t|will\s+not|are\s+not|is\s+not|unfortunately)\b[^.;!?]{0,45}?\b(?:sponsor\w*|relocat\w*|visa)\b/i;

/**
 * Demanding an existing visa is the inverse of offering one. SWORD Health's
 * "does not offer relocation assistance. Candidates must possess a valid EU
 * visa" was scored as a visa/relocation ROUTE — the negation guard only
 * covered the word "sponsor", so "relocation assistance" sailed through.
 */
const VISA_REQUIRED_ALREADY =
  /\b(?:must|should|need\s+to)\s+(?:already\s+)?(?:possess|hold|have)\b[^.;!?]{0,40}?\b(?:valid\s+)?(?:eu|uk|us|schengen|work|residence)?\s*(?:visa|work\s+permit|working\s+rights|right\s+to\s+work|work\s+authorisation|work\s+authorization)\b|\b(?:valid|existing)\s+(?:eu|uk|us)\s+visa\s+required\b|\bmust\s+be\s+(?:legally\s+)?(?:eligible|authoriz\w+)\s+to\s+work\s+in\b/i;

/** Hard geo blocks — explicitly closed to non-residents. */
const GEO_BLOCK =
  /\b(?:us|u\.s\.a?\.?|usa|united\s+states|canada|canadian|uk|united\s+kingdom|australia|india|philippines|brazil|mexico|latam|apac|singapore)[\s-]*(?:based\s+)?only\b|\bonly\s+(?:in|from|within)\s+(?:the\s+)?(?:us|usa|united\s+states|canada|uk|eu|europe|india)\b|\bmust\s+(?:be\s+)?(?:legally\s+)?(?:located|reside|residing|live|living|based)\s+in\s+(?:the\s+)?(?:us|usa|united\s+states|canada|uk|eu\b|australia|india)\b|\b(?:must\s+be\s+)?authoriz\w+\s+to\s+work\s+in\s+the\s+(?:us|united\s+states|uk|eu)\b|\bwork\s+authorization\s+in\s+the\s+(?:us|united\s+states)\b|\bno\s+(?:visa\s+)?sponsorship\b|\bnot\s+(?:able\s+to\s+)?sponsor\b|\bus\s+citizen\w*\s+(?:or|required)|\bsecurity\s+clearance\b|\bgreen\s+card\b/i;

/** Country-ish tokens that, standing alone as a location, imply local hiring. */
const COUNTRY_LOCKED =
  /^(united\s+states|usa|u\.s\.a?\.?|canada|united\s+kingdom|uk|australia|india|germany|france|netherlands|spain|poland|brazil|mexico|singapore|japan|china)$/i;

const NIGERIA =
  /\b(nigeria|nigerian|lagos|abuja|ibadan|kano|port\s*harcourt|benin\s*city|kaduna|enugu|abeokuta|ilorin|onitsha|warri|uyo|owerri|jos\b|maiduguri|lekki|ikeja|yaba|victoria\s*island|ikoyi|surulere|ajah|gbagada)\b/i;

// ------------------------------------------------------------------ helpers

const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

export function isNigeriaJob(job) {
  return NIGERIA.test(`${job.title} ${job.location} ${job.company} ${job.source}`);
}

function ageDays(job) {
  if (!job.postedAt) return null;
  const t = Date.parse(job.postedAt);
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 86_400_000;
}

// ------------------------------------------------------------------ scoring

/**
 * @returns {{keep:boolean, score:number, reasons:string[], routes:string[], track:string, reject?:string}}
 */
export function evaluate(job, cfg) {
  const title = clean(job.title);
  const company = clean(job.company);
  const body = clean(job.description).slice(0, 6000);
  const loc = clean(job.location);
  const blob = `${title} ${company} ${loc} ${body}`;
  const titleCo = `${title} ${company}`;

  const track = isNigeriaJob(job) ? 'NG' : 'INTL';
  const reasons = [];
  const routes = [];
  const rej = (why) => ({ keep: false, score: 0, reasons: [], routes: [], track, reject: why });

  // ---- rejects that apply to BOTH tracks -----------------------------------
  if (GIG_TITLE.test(title)) return rej('gig/data-labeling work');
  if (GIG_COMPANY.test(company)) return rej(`gig platform (${company})`);
  if (FOUNDER.test(title)) return rej('founder/equity-only post');
  if (SCAM.test(blob)) return rej('scam markers');
  // The AI/ML signal must be in the TITLE. Allowing a description match let
  // "Ubuntu Sales Engineer" and "Global Treasury Analyst" through — every job
  // ad on earth mentions AI somewhere in the boilerplate now.
  if (!AI_SIGNAL.test(title)) return rej('no AI/ML signal in title');
  if (NON_TECH_FUNCTION.test(title)) return rej('non-technical function');
  if (EDUCATION_ROLE.test(title)) return rej('teaching/training role');

  let score = 0;

  // ---- NIGERIA: widest net -------------------------------------------------
  if (track === 'NG') {
    score = 55;
    reasons.push('Nigeria-based role');
    if (AI_SIGNAL.test(title) && ENGINEER_WORD.test(title)) { score += 20; reasons.push('AI/ML engineering title'); }
    else if (AI_SIGNAL.test(title)) { score += 12; reasons.push('AI/ML title'); }
    else { score += 4; reasons.push('AI/ML in description'); }
    if (ENTRY_POSITIVE.test(titleCo)) { score += 12; reasons.push('entry-level friendly'); }
    if (!SENIOR_BLOCK.test(title)) { score += 6; reasons.push('not senior-gated'); }
    if (/\bremote\b/i.test(blob)) { score += 5; reasons.push('remote'); }
    routes.push('nigeria-local');
  }

  // ---- INTERNATIONAL: strict ----------------------------------------------
  else {
    if (!AGENCY_ALLOW.test(company) && MILL_COMPANY.test(company)) {
      return rej(`staffing mill (${company})`);
    }
    if (/\b\d{5,}\b/.test(title)) return rej('staffing req-number in title');
    if (!ENGINEER_WORD.test(title)) return rej('not an engineering title');
    if (SENIOR_BLOCK.test(title)) return rej('senior/lead role');
    if (HUGE_COMPANY.test(company)) return rej(`mega-cap employer (${company})`);

    // Geo eligibility — the gate the old pipeline never had.
    const structured = (job.locationRestrictions ?? []).map(clean).filter(Boolean);
    if (structured.length) {
      const sBlob = structured.join(', ');
      const open = ELIG_WORLDWIDE.test(sBlob) || ELIG_AFRICA.test(sBlob);
      if (!open) return rej(`location-restricted to ${sBlob.slice(0, 60)}`);
      routes.push(ELIG_AFRICA.test(sBlob) ? 'africa-emea' : 'worldwide');
      score += 30;
      reasons.push(`open to ${sBlob.slice(0, 40)}`);
    }

    // A job pinned to one city is an on-site role. It may only qualify via the
    // visa/relocation route below — never via "worldwide" matched in boilerplate.
    // The LOCATION field decides eligibility, not the description. A body match
    // is only trusted when the location says nothing — otherwise "Hybrid - San
    // Francisco, New York City" claims `worldwide` off marketing boilerplate.
    const openLoc = OPEN_PLACEHOLDER.test(loc);
    const locWorldwide = ELIG_WORLDWIDE.test(loc) || /^\s*(anywhere|worldwide|global)\s*$/i.test(loc);
    const locAfrica = ELIG_AFRICA.test(loc);
    // A location naming a concrete place, with no region we accept: on-site or
    // country-locked, whatever the blurb claims.
    const pinnedToCity = !openLoc && !!loc && !locWorldwide && !locAfrica;

    if (locWorldwide) { routes.push('worldwide'); score += 30; reasons.push('hires worldwide'); }
    if (locAfrica) { routes.push('africa-emea'); score += 28; reasons.push('Africa/EMEA in scope'); }

    if (openLoc) {
      const remoteish = /\bfully\s+remote\b|\b100%\s+remote\b|\bremote\b/i.test(`${title} ${body}`);
      if (!routes.includes('worldwide') && remoteish && ELIG_WORLDWIDE.test(body)) {
        routes.push('worldwide'); score += 30; reasons.push('hires worldwide');
      }
      if (!routes.includes('africa-emea') && remoteish && ELIG_AFRICA.test(body)) {
        routes.push('africa-emea'); score += 28; reasons.push('Africa/EMEA in scope');
      }
    }
    if (!pinnedToCity && ELIG_CONTRACTOR.test(blob)) {
      routes.push('contractor-eor'); score += 18; reasons.push('contractor/EOR friendly');
    }
    // Weighted at parity with `worldwide`: relocation-with-sponsorship is an
    // explicitly chosen route, and such roles never earn the worldwide bonus
    // (they're pinned to a city), so a lower weight buried them below the floor.
    if (ELIG_VISA.test(blob) && !VISA_NEGATED.test(blob) && !VISA_REQUIRED_ALREADY.test(blob)) {
      routes.push('visa-relocation'); score += 30; reasons.push('visa/relocation offered');
    }

    // Remote-first board + no stated restriction: plausible but unconfirmed.
    // Credited low so it only survives when other signals are strong.
    if (!routes.length && REMOTE_FIRST_SOURCES.has(job.source) && openLoc) {
      routes.push('remote-unconfirmed'); score += 16; reasons.push('remote board, no stated geo limit');
    }

    if (!routes.length) return rej('no eligibility route from Nigeria');

    // A hard geo block kills it unless visa sponsorship is the whole point.
    if (GEO_BLOCK.test(blob) && !routes.includes('visa-relocation')) {
      const m = blob.match(GEO_BLOCK);
      return rej(`geo-blocked: "${clean(m?.[0]).slice(0, 40)}"`);
    }
    if (COUNTRY_LOCKED.test(loc) && !routes.includes('visa-relocation') && !routes.includes('worldwide')) {
      return rej(`location locked to ${loc}`);
    }

    // Level fit — user is entry / career-switcher.
    if (ENTRY_POSITIVE.test(title)) { score += 22; reasons.push('entry-level title'); }
    else if (ENTRY_POSITIVE.test(body)) { score += 10; reasons.push('entry-friendly description'); }
    const yrs = body.match(LOW_YEARS);
    if (yrs) { score += 8; reasons.push(`${yrs[1]}+ yrs required`); }
    if (/\b(portfolio|github|side\s+project|open\s*source|equivalent\s+experience)\b/i.test(body)) {
      score += 8; reasons.push('portfolio accepted');
    }
    if (AI_SIGNAL.test(title) && ENGINEER_WORD.test(title)) { score += 10; reasons.push('AI/ML engineering title'); }
  }

  // ---- freshness (both tracks) --------------------------------------------
  const age = ageDays(job);
  if (age !== null) {
    if (age <= 3) { score += 10; reasons.push('posted ≤3d ago'); }
    else if (age <= 7) { score += 6; reasons.push('posted ≤7d ago'); }
    else if (age <= 14) { score += 2; }
    else if (age > (cfg?.maxAgeDays ?? 30)) return rej(`stale (${Math.round(age)}d old)`);
  }

  if (job.salary) { score += 4; reasons.push('salary listed'); }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const floor = track === 'NG' ? (cfg?.minScoreNg ?? 50) : (cfg?.minScoreIntl ?? 45);

  return {
    keep: score >= floor,
    score,
    reasons,
    routes,
    track,
    reject: score >= floor ? undefined : `score ${score} < ${floor}`,
  };
}

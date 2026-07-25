#!/usr/bin/env node
/**
 * Regression tests for the scorer. Every case here is a real posting that the
 * old pipeline got wrong, or a bug found while building this one.
 *
 *   node test.mjs
 */
import { evaluate } from './lib/score.mjs';

const cfg = { minScoreIntl: 45, minScoreNg: 50, maxAgeDays: 30 };
const fresh = new Date(Date.now() - 2 * 86_400_000).toISOString();

const job = (o) => ({
  title: '', company: '', location: '', url: 'https://x.test/1',
  description: '', postedAt: fresh, salary: null, source: 'remoteok', ...o,
});

/** [name, job, shouldKeep] */
const CASES = [
  // ---- the exact noise that reached the old Telegram feed -----------------
  ['Mercor CUDA AI Trainer', job({
    title: 'CUDA Kernel Optimization Specialist - AI Trainer', company: 'Mercor',
    location: 'Worldwide', source: 'himalayas',
  }), false],
  ['Voice AI research participant', job({
    title: 'Voice AI Research Participant', company: 'Mercor', location: 'Worldwide',
  }), false],
  ['Technical co-founder post', job({
    title: 'Technical Co-Founder (CTO) - AI Staffing Platform', company: 'FutureSight',
    location: 'Worldwide',
  }), false],
  ['Freelance data annotator', job({
    title: 'AI Trainer - Freelance Data Annotator', company: 'Handshake', location: 'Worldwide',
  }), false],
  ['Search quality rater gig', job({
    title: 'AI Content Analyst (No Experience Required)', company: 'Peroptyx', location: 'Worldwide',
  }), false],

  // ---- staffing mills found in the old collector.json ---------------------
  ['ChatGPT Jobs repost', job({
    title: 'AI Engineer Machine learning and Model Development Remote 68968',
    company: 'ChatGPT Jobs', location: 'Worldwide',
  }), false],
  ['Hire Feed repost', job({
    title: 'Artificial Intelligence Engineer (Remote)', company: 'Hire Feed', location: 'Worldwide',
  }), false],
  ['CodeGeniusRecruit repost', job({
    title: 'ML Engineer | $85/hr Remote', company: 'CodeGeniusRecruit', location: 'Worldwide',
  }), false],
  ['Jobs via Dice repost', job({
    title: 'AI Engineer - Remote', company: 'Jobs via Dice', location: 'Worldwide',
  }), false],
  ['TekVizor repost', job({
    title: 'Artificial Intelligence Engineer - AI/ML Engineer (Remote)',
    company: 'TekVizor', location: 'United States',
  }), false],

  // ---- non-AI roles that leaked in via description matching ---------------
  ['Sales engineer with AI in blurb', job({
    title: 'Ubuntu Sales Engineer (Entry-Level)', company: 'Canonical Ltd.', location: 'Anywhere',
    description: 'We use AI and machine learning across the company. Entry level. Portfolio welcome.',
  }), false],
  ['Treasury analyst with AI in blurb', job({
    title: 'Global Treasury Analyst', company: 'Canonical Ltd.', location: 'Anywhere',
    description: 'machine learning artificial intelligence portfolio github',
  }), false],
  ['AI video editor', job({
    title: 'Mid/Senior AI Cinematic Video Editor', company: 'EverAI', location: 'Worldwide',
  }), false],

  // ---- seniority (user is entry-level) ------------------------------------
  ['Staff Data Scientist', job({
    title: 'Staff Data Scientist, Ads Delivery', company: 'Pinterest', location: 'USA',
    description: 'visa sponsorship available. portfolio. 2+ years',
  }), false],
  ['Senior ML Engineer', job({
    title: 'Senior Machine Learning Engineer', company: 'Acme', location: 'Worldwide',
  }), false],
  ['Principal AI Engineer', job({
    title: 'Principal Machine Learning Engineer', company: 'Acme', location: 'Worldwide',
  }), false],
  ['Lead Data Scientist', job({
    title: 'Lead Data Scientist', company: 'Acme', location: 'Worldwide',
  }), false],

  // ---- geo eligibility (the gate the old pipeline never had) --------------
  ['US-only remote role', job({
    title: 'Machine Learning Engineer', company: 'Acme', location: 'United States',
    locationRestrictions: ['United States'], source: 'himalayas',
  }), false],
  ['Must be authorized in the US', job({
    title: 'AI Engineer', company: 'Acme', location: 'Remote',
    description: 'Candidates must be authorized to work in the US. No visa sponsorship.',
  }), false],
  ['Brazil-restricted', job({
    title: 'Machine Learning Engineer', company: 'Acme', location: 'Brazil',
    locationRestrictions: ['Brazil'], source: 'remotive',
  }), false],
  ['Berlin on-site cannot claim worldwide', job({
    title: 'Machine Learning Engineer (m/w/d)', company: 'Acme GmbH', location: 'Stuttgart',
    description: 'Arbeite from anywhere im Team. Globally recognised company.', source: 'arbeitnow',
  }), false],
  // Location beats boilerplate: these claimed `worldwide` from body text.
  ['Hybrid city role cannot claim worldwide', job({
    title: 'Software Engineer, AI SDK', company: 'vercel',
    location: 'Hybrid - San Francisco, New York City', source: 'ats:vercel',
    description: 'We are a fully remote-friendly company hiring worldwide. Portfolio welcome.',
  }), false],
  ['Country-locked remote cannot claim worldwide', job({
    title: 'AI Engineer', company: 'acme', location: 'Remote, Canada', source: 'ats:acme',
    description: 'Work from anywhere in the world. EMEA collaboration.',
  }), false],
  ['Home based - Worldwide passes', job({
    title: 'MLOps Field Engineer', company: 'canonical',
    location: 'Home based - Worldwide', source: 'ats:canonical',
    description: 'Portfolio and github considered. 2+ years.',
  }), true],
  ['Home based - EMEA passes', job({
    title: 'Software Engineer - Edge AI', company: 'canonical',
    location: 'Home based - EMEA', source: 'ats:canonical',
    description: 'Portfolio considered.',
  }), true],

  ['Mega-cap employer', job({
    title: 'Machine Learning Engineer', company: 'Google', location: 'Worldwide',
  }), false],
  // "No visa sponsorship" contains "visa sponsorship" — must not read as an offer.
  ['Negated visa sponsorship', job({
    title: 'AI Engineer', company: 'Acme GmbH', location: 'Munich',
    description: 'We are unable to offer visa sponsorship for this role.', source: 'arbeitnow',
  }), false],
  // Found by verify.mjs: SWORD Health scored `visa-relocation` off "relocation
  // assistance" inside an explicit refusal. The guard only covered "sponsor".
  ['Negated relocation assistance', job({
    title: 'AI Research Scientist (Europe/UK - Remote)', company: 'SWORD Health',
    location: 'Europe', source: 'jobicy',
    description: 'Please note that this position does not offer relocation assistance. Candidates must possess a valid EU visa and be based in Portugal.',
  }), false],
  ['Must already hold a work visa', job({
    title: 'Machine Learning Engineer', company: 'Acme', location: 'Europe', source: 'jobicy',
    description: 'Relocation package available. Candidates must possess a valid EU visa.',
  }), false],
  ['Must have right to work', job({
    title: 'AI Engineer', company: 'Acme', location: 'Europe', source: 'jobicy',
    description: 'We offer relocation support. You must have the right to work in the UK already.',
  }), false],

  ['Negated: we do not sponsor', job({
    title: 'Machine Learning Engineer', company: 'Acme', location: 'Toronto',
    description: 'We do not sponsor work visas. Relocation not provided.', source: 'arbeitnow',
  }), false],

  // ---- SHOULD PASS: genuinely reachable international ---------------------
  ['Worldwide AI/ML engineer', job({
    title: 'Python and Kubernetes Software Engineer - Data, Workflows, AI/ML & Analytics',
    company: 'Canonical Ltd.', location: 'Anywhere', source: 'jobicy',
    description: 'We hire worldwide. Portfolio and github considered. 2+ years experience.',
  }), true],
  ['Junior ML engineer, worldwide', job({
    title: 'Junior Machine Learning Engineer', company: 'SmallCo', location: 'Worldwide',
    description: 'Entry level, no prior experience required, portfolio accepted.',
  }), true],
  ['Africa-scoped AI engineer', job({
    title: 'AI Engineer', company: 'SmallCo', location: 'EMEA, Africa',
    description: 'Remote across Africa and EMEA. 1-2 years experience.', source: 'remotive',
  }), true],
  ['Visa-sponsored ML role in Germany', job({
    title: 'Machine Learning Engineer (f/m/x)', company: 'Otherworldly', location: 'Berlin',
    description: 'Visa sponsorship available and relocation package provided. Junior welcome, portfolio.',
    source: 'arbeitnow',
  }), true],

  // ---- SHOULD PASS: Nigeria (widest net, any seniority/company) -----------
  ['Chowdeck ML engineer', job({
    title: 'Machine Learning Engineer', company: 'Chowdeck', location: 'Nigeria', source: 'myjobmag',
    postedAt: null,
  }), true],
  ['Junior AI engineer Lagos', job({
    title: 'Junior AI Engineer', company: 'Interdecima', location: 'Lagos, Nigeria',
    source: 'myjobmag', postedAt: null,
  }), true],
  ['Senior NG role still passes', job({
    title: 'Lead AI Engineer - Financial Inclusion', company: 'M-KOPA', location: 'Nigeria',
    source: 'myjobmag', postedAt: null,
  }), true],
  ['NG data scientist at bank', job({
    title: 'Data Scientist', company: 'Access Bank', location: 'Nigeria', source: 'myjobmag',
    postedAt: null,
  }), true],
  ['NG gig work still rejected', job({
    title: 'AI Trainer', company: 'Mercor Nigeria', location: 'Lagos, Nigeria', source: 'myjobmag',
    postedAt: null,
  }), false],
  ['NG non-AI role rejected', job({
    title: 'Accountant', company: 'Zenith Bank', location: 'Lagos, Nigeria', source: 'myjobmag',
    postedAt: null,
  }), false],

  // ---- teaching roles: reached Telegram before EDUCATION_ROLE existed -----
  ['AI Tutor (spelled out)', job({
    title: 'Artificial Intelligence Tutor', company: 'Cirvee', location: 'Lagos, Nigeria',
    source: 'myjobmag', postedAt: null,
  }), false],
  ['AI Facilitator at a college', job({
    title: 'Artificial Intelligence Facilitator', company: 'Divine Infinity College',
    location: 'Nigeria', source: 'myjobmag', postedAt: null,
  }), false],
  ['AI/ML Engineering Instructor', job({
    title: 'AI/ML Engineering Instructor', company: 'Lagos Cyber School',
    location: 'Nigeria', source: 'myjobmag', postedAt: null,
  }), false],
  ['University AI professor', job({
    title: 'Associate Professor/Reader (Artificial Intelligence)', company: 'Venite University',
    location: 'Nigeria', source: 'myjobmag', postedAt: null,
  }), false],
  ['Graduate assistant', job({
    title: 'Graduate Assistant (Artificial Intelligence)', company: 'Venite University',
    location: 'Nigeria', source: 'myjobmag', postedAt: null,
  }), false],
  ['Real ML engineer job still passes', job({
    title: 'Machine Learning Engineer', company: 'Korapay', location: 'Nigeria',
    source: 'myjobmag', postedAt: null,
  }), true],

  // ---- freshness ----------------------------------------------------------
  ['Stale posting', job({
    title: 'Machine Learning Engineer', company: 'SmallCo', location: 'Worldwide',
    postedAt: new Date(Date.now() - 90 * 86_400_000).toISOString(),
  }), false],
];

let pass = 0;
const failures = [];
for (const [name, j, want] of CASES) {
  const v = evaluate(j, cfg);
  if (v.keep === want) { pass++; continue; }
  failures.push(
    `  ✗ ${name}\n      want keep=${want} got keep=${v.keep} score=${v.score}` +
    ` reject="${v.reject ?? '-'}" routes=[${v.routes.join(',')}]`,
  );
}

console.log(`\n${pass}/${CASES.length} passed`);
if (failures.length) {
  console.log('\nFAILURES:');
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('all green\n');

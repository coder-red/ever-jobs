#!/usr/bin/env node
/**
 * Agency-radar regression tests. Every case is a company that appeared in a
 * real run and was classified wrongly, or a lead that must keep working.
 *
 *   node test-agencies.mjs
 */
import { findAgencies } from './lib/agencies.mjs';

const fresh = new Date(Date.now() - 3 * 86_400_000).toISOString();

/** Build n postings for one company. */
const post = (company, n, { title = 'Software Engineer', desc = '', loc = 'Lagos, Nigeria' } = {}) =>
  Array.from({ length: n }, (_, i) => ({
    title: `${title}${n > 1 ? ` ${i + 1}` : ''}`,
    company, location: loc, description: desc,
    url: `https://x.test/${company}/${i}`, postedAt: fresh, source: 'myjobmag',
  }));

const CASES = [
  // ---- must be found ------------------------------------------------------
  ['Global talent firm (Andela)', post('Andela', 4), true],
  ['Global talent firm (Toptal)', post('Toptal', 6), true],
  ['Lemon.io places globally', post('Lemon.io', 3), true],
  ['NG recruiter by name', post('Just Recruitment Agency', 5), true],
  ['NG outsourcing firm', post('Fort Knox Outsourcing', 3), true],
  ['NG consulting firm', post('LEAM Consulting Limited', 4), true],
  ['HR services firm', post('Alan & Grant', 6, { title: 'HR Consultant' }), true],
  ['Recruits-on-behalf language', post('Zenith Widgets', 4, {
    desc: 'Our client is a leading fintech recruiting to fill the position of Engineer.',
  }), true],
  // AI/ML activity is a bonus, never a requirement — the whole point.
  ['Agency with zero AI/ML roles still qualifies', post('Prestigious Consulting Group', 5, {
    title: 'Accountant',
  }), true],

  // ---- must NOT be found (all appeared as false positives) ----------------
  ['Hospital is not an agency', post('Enugu International Hospital', 127, { title: 'Nurse' }), false],
  ['School is not an agency', post('Ogedi International Schools', 26, { title: 'Teacher' }), false],
  ['Business school is not an agency', post('Frangipani Concrete Business School', 10), false],
  ['Conglomerate is not an agency', post('Dangote Industries Limited', 8), false],
  ['Agribusiness is not an agency', post('Olam Agri', 9), false],
  ['Clinic is not an agency', post('Abuja Clinics Limited', 5, { title: 'Doctor' }), false],
  ['Bank is not an agency', post('Access Bank', 12, { title: 'Teller' }), false],
  ['Generic suffix alone is not evidence', post('Zenith Systems Limited', 6), false],
  ['Gig platform is not an outreach lead', post('Mercor', 20, { title: 'AI Trainer' }), false],
  ['Job board is not an outreach lead', post('MyJobMag', 40), false],
  ['Annotation platform excluded', post('Appen', 15), false],
  // Found by verify.mjs: iHerb's benefits boilerplate names an internal
  // recruiter's job title, which read as recruiting-on-behalf evidence.
  ['Internal "Talent Acquisition Partner" is not agency evidence', post('iHerb', 9, {
    title: 'Principal Machine Learning Engineer', loc: 'USA',
    desc: 'The Talent Acquisition Partner/local HR representative will go over the benefits you are eligible for. Contact staffingvendors@iherb.com',
  }), false],
  ['Crossover Health is a medical group, not Crossover.com', post('Crossover Health', 3, {
    title: 'Nurse Practitioner', loc: 'USA', desc: 'careers@crossoverhealth.com',
  }), false],
  ['Crossover (the talent marketplace) still counts', post('Crossover', 5), true],
  ['A real talent acquisition FIRM still counts', post('Bridge Talent', 4, {
    desc: 'We are a talent acquisition firm placing engineers with our client partners.',
  }), true],
];

let pass = 0;
const failures = [];
for (const [name, jobs, want] of CASES) {
  const found = findAgencies(jobs, { minScore: 0 });
  const got = found.length > 0;
  if (got === want) { pass++; continue; }
  failures.push(`  ✗ ${name}\n      want found=${want} got=${got}` +
    (found[0] ? ` (${found[0].name}, score ${found[0].score}: ${found[0].reasons.join(', ')})` : ''));
}

// AI/ML presence must raise the score but never gate inclusion.
{
  const withAi = findAgencies(post('Acme Recruitment', 5, { title: 'Machine Learning Engineer' }), { minScore: 0 })[0];
  const without = findAgencies(post('Acme Recruitment', 5, { title: 'Warehouse Packer' }), { minScore: 0 })[0];
  if (withAi && without && withAi.score > without.score) pass++;
  else failures.push('  ✗ AI/ML postings should score higher but not gate inclusion');
}

const total = CASES.length + 1;
console.log(`\n${pass}/${total} passed`);
if (failures.length) {
  console.log('\nFAILURES:');
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('all green\n');

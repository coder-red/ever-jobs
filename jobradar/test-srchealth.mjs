#!/usr/bin/env node
/** Source-health alarm — the check the old pipeline lacked for five weeks. */
import { record, neverProduced } from './lib/srchealth.mjs';

let pass = 0; const fails = [];
const ck = (n, c, x = '') => { if (c) pass++; else fails.push(`  ✗ ${n}${x ? `\n      ${x}` : ''}`); };

// A source that works, then breaks, must alarm.
let st = {};
record(st, { myjobmag: 74 });
record(st, { myjobmag: 70 });
let r = record(st, { myjobmag: 0 });
ck('one zero is not yet an alarm', r.broken.length === 0, 'a single empty run is normal');
r = record(st, { myjobmag: 0 });
ck('two consecutive zeros alarm', r.broken.length === 1 && r.broken[0].name === 'myjobmag');
ck('alarm reports peak yield', r.broken[0].best === 74);

// It must not alarm again every run — that's noise.
r = record(st, { myjobmag: 0 });
ck('does not re-alarm while broken', r.broken.length === 0);

// Recovery is reported once.
r = record(st, { myjobmag: 65 });
ck('recovery reported', r.recovered.length === 1 && r.recovered[0].count === 65);
r = record(st, { myjobmag: 66 });
ck('recovery not repeated', r.recovered.length === 0);

// A source that has NEVER produced is not broken — just empty.
let st2 = {};
for (let i = 0; i < 5; i++) record(st2, { deadboard: 0 });
const r2 = record(st2, { deadboard: 0 });
ck('never-productive source never alarms', r2.broken.length === 0,
  'a source that was always empty is not a regression');
ck('never-productive is reported separately', neverProduced(st2).includes('deadboard'));

// hotnigerianjobs returns plenty of postings but zero JOB matches — the alarm
// tracks fetch yield, not match yield, so it must stay quiet.
let st3 = {};
record(st3, { hotnigerianjobs: 600 });
const r3 = record(st3, { hotnigerianjobs: 600 });
ck('high-fetch zero-match source stays quiet', r3.broken.length === 0);

// History is bounded.
let st4 = {};
for (let i = 0; i < 60; i++) record(st4, { x: 5 });
ck('history is capped', st4.x.history.length <= 30, `got ${st4.x.history.length}`);

const total = pass + fails.length;
console.log(`\n${pass}/${total} passed`);
if (fails.length) { console.log('\nFAILURES:'); console.log(fails.join('\n')); process.exit(1); }
console.log('all green\n');

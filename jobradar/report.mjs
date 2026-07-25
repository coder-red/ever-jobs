#!/usr/bin/env node
/**
 * Renders data/latest.json into a self-contained HTML page.
 *   node radar.mjs --dry   # refresh data/latest.json
 *   node report.mjs        # write data/report.html
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const d = JSON.parse(readFileSync(resolve(HERE, 'data', 'latest.json'), 'utf8'));

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ROUTE = {
  worldwide: ['Hires worldwide', 'open'],
  'africa-emea': ['Africa / EMEA in scope', 'open'],
  'visa-relocation': ['Visa or relocation offered', 'open'],
  'contractor-eor': ['Contractor / EOR', 'open'],
  'remote-unconfirmed': ['Geo unstated — verify first', 'warn'],
  'nigeria-local': ['Nigeria', 'ng'],
};

/** Titles from NG boards arrive as "Role at Employer" — split for display. */
function split(job) {
  if (job.company) return [job.title, job.company];
  const m = job.title.match(/^(.*?)\s+at\s+(.+)$/i);
  return m ? [m[1], m[2]] : [job.title, ''];
}

const days = (iso) => {
  if (!iso) return '';
  const n = Math.round((Date.now() - Date.parse(iso)) / 86_400_000);
  return Number.isNaN(n) ? '' : n <= 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`;
};

/** Freshness band — job ads saturate fast, so age gets its own visual weight. */
const ageBand = (iso) => {
  if (!iso) return 'unknown';
  const n = (Date.now() - Date.parse(iso)) / 86_400_000;
  return Number.isNaN(n) ? 'unknown' : n <= 3 ? 'hot' : n <= 10 ? 'warm' : 'cool';
};

const rows = d.jobs.map((j) => {
  const [role, employer] = split(j);
  const chips = j.routes.map((r) => {
    const [label, kind] = ROUTE[r] ?? [r, 'open'];
    return `<span class="chip chip--${kind}">${esc(label)}</span>`;
  }).join('');
  const band = j.score >= 80 ? 'high' : j.score >= 60 ? 'mid' : 'low';
  const age = days(j.postedAt);
  const meta = [employer, j.location, j.source].filter(Boolean)
    .map((x) => `<span>${esc(x)}</span>`).join('<i aria-hidden="true">·</i>')
    + (age ? `<i aria-hidden="true">·</i><span class="age age--${ageBand(j.postedAt)}">${esc(age)}</span>` : '');
  return `<li class="job" data-track="${j.track}">
  <a class="job__link" href="${esc(j.url)}" target="_blank" rel="noopener noreferrer">
    <span class="job__score score--${band}"><b>${j.score}</b><small>score</small></span>
    <span class="job__body">
      <span class="job__role">${esc(role)}</span>
      <span class="job__meta">${meta}</span>
      <span class="job__chips">${chips}</span>
    </span>
    <span class="job__flag" aria-hidden="true">${j.track === 'NG' ? 'NG' : 'INT'}</span>
  </a>
</li>`;
}).join('\n');

const ng = d.jobs.filter((j) => j.track === 'NG').length;
const intl = d.jobs.length - ng;

/** The funnel is a real sequence, so it's rendered as one. All figures live. */
const en = d.enrichment ?? {};
const FUNNEL = [
  ['Collected', d.rawCount, 'across 10 job boards'],
  ['Unique', d.uniqueCount, 'after removing reposts'],
  ['AI/ML titled', d.aiTitled ?? 0, 'signal in the title, not the blurb'],
  ['Passed the gate', (d.matched ?? 0) + (en.dead ?? 0) + (en.closed ?? 0) + (en.staleAfterDating ?? 0),
    'eligible, entry-level, not gig work'],
  ['Live &amp; current', d.matched, 'page verified, date checked'],
];

const NOTES = {
  'gig/data-labeling work': 'AI trainer, annotator, quality rater — piecework, not engineering',
  'senior/lead role': 'above an entry-level candidate',
  'not an engineering title': 'AI product manager, AI designer, AI video editor',
  'no eligibility route from Nigeria': 'no worldwide, Africa, contractor or visa route',
  'staffing mill': 'repost farms, not the real employer',
  'gig platform': 'Mercor, Outlier, Appen, Peroptyx and similar',
  'teaching/training role': 'tutor, instructor, lecturer — a different career',
  'non-technical function': 'sales, treasury, marketing with AI in the blurb',
  'mega-cap employer': 'Google, Meta, Pinterest — lottery tickets at entry level',
  'location-restricted to': 'the board states a country you cannot work from',
  'geo-blocked': 'US-only, no sponsorship, or clearance required',
  'score': 'below the quality floor',
  'stale': 'older than the freshness window',
};
const CUTS = Object.entries(d.rejectionTally ?? {}).slice(0, 8)
  .map(([k, n]) => [k.replace(/&/g, '&amp;').replace(/</g, '&lt;'), n, NOTES[k] ?? '']);
const cutMax = Math.max(1, ...CUTS.map((c) => c[1]));

/** Verification outcomes — only shown when an enrichment pass actually ran. */
const VERIFY = en.checked ? [
  ['Pages checked', en.checked],
  ['Dead links dropped', en.dead],
  ['Deadline passed', en.closed],
  ['Dates recovered', en.datesRecovered],
  ['Too old once dated', en.staleAfterDating],
] : null;

const html = `<title>Job radar — AI/ML roles reachable from Nigeria</title>
<style>
  :root {
    --ground:#EEF2F0; --raised:#FFFFFF; --ink:#101A17; --muted:#5F7169;
    --rule:#D4DCD8; --accent:#0B6E4F; --accent-soft:#DDEBE4;
    --warn:#9C5B12; --warn-soft:#F6E7D3; --ng:#134E8C; --ng-soft:#DEE8F4;
    --shadow:0 1px 2px rgba(16,26,23,.06), 0 8px 24px -16px rgba(16,26,23,.28);
  }
  @media (prefers-color-scheme:dark) {
    :root {
      --ground:#0C1311; --raised:#141D1A; --ink:#E6EDE9; --muted:#8FA39B;
      --rule:#243029; --accent:#4FBF8F; --accent-soft:#12291F;
      --warn:#D9974A; --warn-soft:#2B2013; --ng:#7FB2E8; --ng-soft:#12212F;
      --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.8);
    }
  }
  :root[data-theme="dark"] {
    --ground:#0C1311; --raised:#141D1A; --ink:#E6EDE9; --muted:#8FA39B;
    --rule:#243029; --accent:#4FBF8F; --accent-soft:#12291F;
    --warn:#D9974A; --warn-soft:#2B2013; --ng:#7FB2E8; --ng-soft:#12212F;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.8);
  }
  :root[data-theme="light"] {
    --ground:#EEF2F0; --raised:#FFFFFF; --ink:#101A17; --muted:#5F7169;
    --rule:#D4DCD8; --accent:#0B6E4F; --accent-soft:#DDEBE4;
    --warn:#9C5B12; --warn-soft:#F6E7D3; --ng:#134E8C; --ng-soft:#DEE8F4;
    --shadow:0 1px 2px rgba(16,26,23,.06), 0 8px 24px -16px rgba(16,26,23,.28);
  }

  body {
    background:var(--ground); color:var(--ink); margin:0;
    font-family:system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size:16px; line-height:1.55; -webkit-font-smoothing:antialiased;
  }
  .wrap { max-width:62rem; margin:0 auto; padding:2.5rem 1.25rem 5rem; }
  @media (max-width:34rem) { .wrap { padding:1.75rem 1rem 3rem; } }

  .lede { display:flex; flex-direction:column; gap:.65rem; margin-bottom:2.75rem; }
  .eyebrow {
    font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
    font-size:.7rem; letter-spacing:.16em; text-transform:uppercase; color:var(--accent);
  }
  h1 { font-size:clamp(1.7rem,4.5vw,2.5rem); line-height:1.1; margin:0;
       letter-spacing:-.022em; font-weight:680; text-wrap:balance; }
  .lede p { margin:0; color:var(--muted); max-width:56ch; }

  h2 { font-size:1.05rem; letter-spacing:-.01em; margin:0; font-weight:660; }
  .sec { margin-top:3rem; display:flex; flex-direction:column; gap:1rem; }
  .sec__head { display:flex; align-items:baseline; justify-content:space-between; gap:1rem;
               border-bottom:1px solid var(--rule); padding-bottom:.6rem; }
  .sec__note { font-size:.8rem; color:var(--muted); }
  .sec__prose { margin:0; font-size:.86rem; color:var(--muted); max-width:64ch; }

  /* funnel — a real sequence, so shown as one */
  .funnel { list-style:none; margin:0; padding:0; display:grid; gap:.5rem;
            grid-template-columns:repeat(auto-fit,minmax(9.5rem,1fr)); }
  .funnel li { background:var(--raised); border:1px solid var(--rule); border-radius:3px;
               padding:.85rem .95rem; display:flex; flex-direction:column; gap:.15rem; }
  .funnel b { font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
              font-size:1.5rem; font-weight:620; font-variant-numeric:tabular-nums;
              letter-spacing:-.02em; }
  .funnel .k { font-size:.72rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
  .funnel .d { font-size:.78rem; color:var(--muted); line-height:1.4; }
  .funnel li:last-child b { color:var(--accent); }

  /* what got cut */
  .cuts { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.7rem; }
  .cut { display:grid; grid-template-columns:auto 1fr; gap:.15rem .9rem; align-items:baseline; }
  .cut__n { font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
            font-variant-numeric:tabular-nums; font-size:.95rem; font-weight:620;
            min-width:2.2rem; text-align:right; }
  .cut__t { font-size:.92rem; font-weight:560; }
  .cut__bar { grid-column:2; height:3px; background:var(--rule); border-radius:2px; overflow:hidden; }
  .cut__bar i { display:block; height:100%; background:var(--accent); opacity:.55; }
  .cut__d { grid-column:2; font-size:.8rem; color:var(--muted); }

  /* filters */
  .filters { display:flex; gap:.4rem; flex-wrap:wrap; }
  .filters button {
    font:inherit; font-size:.83rem; cursor:pointer; padding:.4rem .8rem; border-radius:2rem;
    border:1px solid var(--rule); background:var(--raised); color:var(--muted);
    display:inline-flex; align-items:center; gap:.45rem;
  }
  .filters button span { font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
                         font-variant-numeric:tabular-nums; font-size:.76rem; opacity:.8; }
  .filters button[aria-pressed="true"] {
    background:var(--accent); border-color:var(--accent); color:#fff; font-weight:560;
  }
  :root[data-theme="dark"] .filters button[aria-pressed="true"],
  .filters button[aria-pressed="true"] { color:var(--ground); }
  .filters button:focus-visible, .job__link:focus-visible {
    outline:2px solid var(--accent); outline-offset:2px;
  }

  /* job list */
  .jobs { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.5rem; }
  .job[hidden] { display:none; }
  .job__link {
    display:grid; grid-template-columns:auto 1fr auto; gap:.25rem 1rem; align-items:start;
    text-decoration:none; color:inherit; background:var(--raised);
    border:1px solid var(--rule); border-radius:3px; padding:.9rem 1rem;
    transition:border-color .12s ease, box-shadow .12s ease, transform .12s ease;
  }
  .job__link:hover { border-color:var(--accent); box-shadow:var(--shadow); transform:translateY(-1px); }
  @media (prefers-reduced-motion:reduce) { .job__link { transition:none; } .job__link:hover { transform:none; } }

  .job__score { display:flex; flex-direction:column; align-items:center; min-width:2.9rem;
                padding-top:.1rem; border-left:3px solid var(--rule); padding-left:.7rem; }
  .job__score b { font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
                  font-size:1.15rem; font-weight:640; font-variant-numeric:tabular-nums;
                  letter-spacing:-.02em; line-height:1.15; }
  .job__score small { font-size:.6rem; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
  .score--high { border-left-color:var(--accent); }
  .score--mid  { border-left-color:var(--warn); }
  .score--low  { border-left-color:var(--rule); }

  .job__body { display:flex; flex-direction:column; gap:.3rem; min-width:0; }
  .job__role { font-weight:580; letter-spacing:-.008em; line-height:1.3; text-wrap:balance; }
  .job__meta { font-size:.8rem; color:var(--muted); display:flex; flex-wrap:wrap;
               align-items:center; gap:.4rem; }
  .job__meta i { opacity:.45; font-style:normal; }
  .age { font-weight:600; }
  .age--hot  { color:var(--accent); }
  .age--warm { color:var(--ink); opacity:.75; }
  .age--cool { color:var(--warn); }
  .job__chips { display:flex; flex-wrap:wrap; gap:.3rem; margin-top:.1rem; }
  .chip { font-size:.7rem; padding:.14rem .5rem; border-radius:2px; letter-spacing:.005em;
          font-weight:540; white-space:nowrap; }
  .chip--open { background:var(--accent-soft); color:var(--accent); }
  .chip--warn { background:var(--warn-soft);  color:var(--warn);  }
  .chip--ng   { background:var(--ng-soft);    color:var(--ng);    }
  .job__flag { font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
               font-size:.64rem; letter-spacing:.1em; color:var(--muted);
               border:1px solid var(--rule); border-radius:2px; padding:.1rem .35rem; }
  @media (max-width:34rem) {
    .job__link { grid-template-columns:auto 1fr; }
    .job__flag { display:none; }
  }

  /* agency leads — outreach targets, styled apart from vacancies */
  .leads { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:.5rem; }
  .lead { display:grid; grid-template-columns:auto 1fr auto; gap:.2rem 1rem; align-items:center;
          background:var(--raised); border:1px solid var(--rule); border-radius:3px;
          border-left:3px solid var(--ng); padding:.8rem 1rem; }
  .lead__score { font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
                 font-size:1.05rem; font-weight:640; font-variant-numeric:tabular-nums;
                 color:var(--ng); min-width:2rem; text-align:right; }
  .lead__body { display:flex; flex-direction:column; gap:.2rem; min-width:0; }
  .lead__name { font-weight:600; letter-spacing:-.008em; }
  .lead__meta { font-size:.8rem; color:var(--muted); display:flex; flex-wrap:wrap;
                align-items:center; gap:.35rem; }
  .lead__meta i { opacity:.45; font-style:normal; }
  .lead__why { font-size:.78rem; color:var(--muted); opacity:.85; }
  .tag { font-family:ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace; font-size:.6rem;
         letter-spacing:.08em; background:var(--ng-soft); color:var(--ng);
         padding:.1rem .3rem; border-radius:2px; vertical-align:.1em; }
  .lead__cta { font-size:.78rem; white-space:nowrap; text-decoration:none; font-weight:560;
               color:var(--ng); border:1px solid var(--ng); border-radius:2rem;
               padding:.3rem .7rem; }
  .lead__cta:hover { background:var(--ng); color:var(--raised); }
  .lead__cta:focus-visible { outline:2px solid var(--ng); outline-offset:2px; }
  @media (max-width:34rem) {
    .lead { grid-template-columns:auto 1fr; }
    .lead__cta { grid-column:2; justify-self:start; margin-top:.35rem; }
  }

  footer { margin-top:3.5rem; padding-top:1.25rem; border-top:1px solid var(--rule);
           font-size:.8rem; color:var(--muted); display:flex; flex-direction:column; gap:.4rem; }
  code { font-family:ui-monospace,"Cascadia Mono","SF Mono",Menlo,Consolas,monospace;
         font-size:.85em; background:var(--accent-soft); color:var(--accent);
         padding:.08rem .3rem; border-radius:2px; }
</style>

<div class="wrap">
  <header class="lede">
    <div class="eyebrow">Job radar · ${esc(new Date(d.generatedAt).toISOString().slice(0, 10))}</div>
    <h1>AI/ML roles you can actually be hired into</h1>
    <p>Entry-level, filtered for one thing the old pipeline never checked: whether
       someone based in Nigeria can legally be employed in the role.</p>
  </header>

  <section class="sec">
    <div class="sec__head">
      <h2>How ${d.rawCount.toLocaleString()} postings became ${d.matched}</h2>
      <span class="sec__note">10 boards, no login required</span>
    </div>
    <ol class="funnel">
      ${FUNNEL.map(([k, v, note]) => `<li><span class="k">${esc(k)}</span><b>${v.toLocaleString()}</b><span class="d">${note}</span></li>`).join('\n      ')}
    </ol>
  </section>

  ${VERIFY ? `<section class="sec">
    <div class="sec__head">
      <h2>Verified against the live pages</h2>
      <span class="sec__note">feeds lie; pages don't</span>
    </div>
    <ol class="funnel">
      ${VERIFY.map(([k, v]) => `<li><span class="k">${esc(k)}</span><b>${v}</b></li>`).join('\n      ')}
    </ol>
    <p class="sec__prose">Nigerian boards publish no date in their listings and Jobberman keeps
       serving expired roles in search. Every match is fetched and re-dated before it reaches you,
       so a two-month-old post can't outrank one from this morning.</p>
  </section>` : ''}

  <section class="sec">
    <div class="sec__head">
      <h2>What was thrown away</h2>
      <span class="sec__note">before verification</span>
    </div>
    <ul class="cuts">
      ${CUTS.map(([t, n, note]) => `<li class="cut">
        <span class="cut__n">${n}</span><span class="cut__t">${t}</span>
        <span class="cut__bar"><i style="width:${Math.round((n / cutMax) * 100)}%"></i></span>
        <span class="cut__d">${note}</span>
      </li>`).join('\n      ')}
    </ul>
  </section>

  <section class="sec">
    <div class="sec__head">
      <h2>${d.matched} reachable roles</h2>
      <span class="sec__note">ranked by fit</span>
    </div>
    <div class="filters">
      <button type="button" data-f="all" aria-pressed="true">All <span>${d.jobs.length}</span></button>
      <button type="button" data-f="NG" aria-pressed="false">Nigeria <span>${ng}</span></button>
      <button type="button" data-f="INTL" aria-pressed="false">International <span>${intl}</span></button>
    </div>
    <ul class="jobs" id="jobs">
${rows}
    </ul>
  </section>

  ${(d.agencies ?? []).length ? `<section class="sec">
    <div class="sec__head">
      <h2>Agencies worth a cold DM</h2>
      <span class="sec__note">hiring signal, AI/ML or not</span>
    </div>
    <p class="sec__prose">Recruitment and outsourcing firms currently posting jobs. What they're
       hiring for doesn't matter — a firm staffing backend roles today places AI/ML roles next
       quarter. AI/ML activity raises the ranking; it is never required.</p>
    <ul class="leads">
      ${d.agencies.slice(0, 12).map((a) => `<li class="lead">
        <span class="lead__score">${a.score}</span>
        <span class="lead__body">
          <span class="lead__name">${esc(a.name)}${a.inNigeria ? ' <span class="tag">NG</span>' : ''}</span>
          <span class="lead__meta">${a.postings} live posting${a.postings > 1 ? 's' : ''}<i aria-hidden="true">·</i>${
            a.aiPostings ? `<span class="chip chip--open">${a.aiPostings} AI/ML already</span>` : 'none in AI/ML yet'
          }${a.locations.length ? `<i aria-hidden="true">·</i>${esc(a.locations[0])}` : ''}</span>
          <span class="lead__why">${esc(a.reasons.slice(0, 3).join(', '))}</span>
        </span>
        <a class="lead__cta" href="${esc(a.emails.length ? `mailto:${a.emails[0]}` : a.linkedin)}"
           target="_blank" rel="noopener noreferrer">${a.emails.length ? esc(a.emails[0]) : 'Find on LinkedIn'}</a>
      </li>`).join('\n      ')}
    </ul>
  </section>` : ''}

  <footer>
    <div>Nigerian listings come from MyJobMag and Jobberman; international from RemoteOK,
         Remotive, Himalayas, Jobicy, Arbeitnow, WeWorkRemotely and Working Nomads.</div>
    <div>Refresh with <code>node radar.mjs --dry</code> then <code>node report.mjs</code>.
         Roles marked <em>geo unstated</em> come from remote-only boards that named no
         restriction — confirm eligibility before spending time on an application.</div>
  </footer>
</div>

<script>
  const list = document.getElementById('jobs');
  document.querySelectorAll('.filters button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const f = btn.dataset.f;
      document.querySelectorAll('.filters button').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === btn)));
      list.querySelectorAll('.job').forEach((li) => {
        li.hidden = f !== 'all' && li.dataset.track !== f;
      });
    });
  });
</script>
`;

const out = resolve(HERE, 'data', 'report.html');
writeFileSync(out, html, 'utf8');
console.log(`wrote ${out} (${d.matched} jobs)`);

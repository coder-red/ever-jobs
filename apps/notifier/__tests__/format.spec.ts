import { formatJob } from '../src/format';
import { CollatedJob } from '../src/types';

function job(overrides: Partial<CollatedJob> = {}): CollatedJob {
  return {
    id: 1,
    job_url: 'https://example.com/jobs/1',
    title: 'Junior AI Engineer',
    company_name: 'Acme',
    site: 'remoteok',
    is_remote: 1,
    location: 'Remote',
    date_posted: '2026-06-07',
    first_seen_at: '2026-06-07T00:00:00.000Z',
    last_seen_at: '2026-06-07T00:00:00.000Z',
    payload_json: '{}',
    ...overrides,
  };
}

describe('formatJob', () => {
  it('renders title, company, location, link, and source', () => {
    const out = formatJob(job());
    expect(out).toContain('<b>Junior AI Engineer</b>');
    expect(out).toContain('@ Acme');
    expect(out).toContain('Remote');
    expect(out).toContain('https://example.com/jobs/1');
    expect(out).toContain('via remoteok');
  });

  it('falls back to "Remote" when location is missing but is_remote=1', () => {
    const out = formatJob(job({ location: null }));
    expect(out).toContain('Remote');
  });

  it('falls back to "Location unspecified" when neither is set', () => {
    const out = formatJob(job({ location: null, is_remote: 0 }));
    expect(out).toContain('Location unspecified');
  });

  it('escapes HTML in title, company, and URL', () => {
    const out = formatJob(
      job({
        title: 'Engineer <script>alert(1)</script>',
        company_name: 'A & B',
        job_url: 'https://x.com/j?a=1&b=2',
      }),
    );
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('A &amp; B');
    expect(out).toContain('&amp;b=2');
  });

  it('omits company line when company_name is null', () => {
    const out = formatJob(job({ company_name: null }));
    expect(out).not.toContain('@');
  });
});

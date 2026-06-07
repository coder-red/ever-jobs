import { Command, CommandRunner, Option } from 'nest-commander';
import { CollectorService } from '../collector.service';

interface ListOptions {
  limit?: number;
  format?: string;
}

@Command({
  name: 'list',
  description: 'List collated jobs from the local store.',
})
export class ListCommand extends CommandRunner {
  constructor(private readonly collector: CollectorService) {
    super();
  }

  async run(_params: string[], options: ListOptions): Promise<void> {
    const limit = options.limit ?? 50;
    const jobs = this.collector.listJobs(limit);
    const format = options.format ?? 'table';

    if (format === 'json') {
      console.log(JSON.stringify(jobs, null, 2));
      return;
    }

    if (jobs.length === 0) {
      console.log('No collated jobs yet. Run: npm run collect');
      return;
    }

    for (const job of jobs) {
      const loc = job.location
        ? [job.location.city, job.location.state, job.location.country]
            .filter(Boolean)
            .join(', ')
        : 'Remote';
      console.log(`\n${job.title}`);
      console.log(`  ${job.companyName ?? 'Unknown'} · ${loc}`);
      console.log(`  ${job.site ?? '?'} · ${job.jobUrl}`);
    }
    console.log(`\n(${jobs.length} shown)`);
  }

  @Option({ flags: '-n, --limit <count>', description: 'Max rows (default 50)' })
  parseLimit(val: string): number {
    return parseInt(val, 10);
  }

  @Option({
    flags: '-f, --format <format>',
    description: 'Output format: table (default) or json',
  })
  parseFormat(val: string): string {
    return val;
  }
}

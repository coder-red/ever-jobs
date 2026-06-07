import { Command, CommandRunner, Option } from 'nest-commander';
import { CollectorService } from '../collector.service';

interface CollectOptions {
  batch?: string;
  dryRun?: boolean;
  json?: boolean;
}

@Command({
  name: 'collect',
  description:
    'Fetch jobs from Ever Jobs in batches, filter for junior remote AI roles, and store matches.',
})
export class CollectCommand extends CommandRunner {
  constructor(private readonly collector: CollectorService) {
    super();
  }

  async run(_params: string[], options: CollectOptions): Promise<void> {
    const summary = await this.collector.collect({
      batch: options.batch,
      dryRun: options.dryRun,
    });

    if (options.json) {
      console.log(JSON.stringify(summary, null, 2));
      return;
    }

    console.log('\n=== Collect summary ===');
    for (const batch of summary.batches) {
      const err = batch.error ? ` ERROR: ${batch.error}` : '';
      console.log(
        `  ${batch.name}: fetched=${batch.fetched} matched=${batch.matched} new=${batch.inserted} updated=${batch.updated}${err}`,
      );
    }
    console.log(
      `\nTotal matched=${summary.totalMatched} new=${summary.totalInserted} updated=${summary.totalUpdated}`,
    );
    console.log(`Store total=${summary.storeTotal}`);
  }

  @Option({
    flags: '--batch <name>',
    description:
      'Run a single batch: remote-boards, major-boards, ai-companies, ats-boards',
  })
  parseBatch(val: string): string {
    return val;
  }

  @Option({
    flags: '--dry-run',
    description: 'Fetch and filter without writing to the database',
  })
  parseDryRun(): boolean {
    return true;
  }

  @Option({ flags: '--json', description: 'Output summary as JSON' })
  parseJson(): boolean {
    return true;
  }
}

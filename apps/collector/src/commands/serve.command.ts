import { Command, CommandRunner, Option } from 'nest-commander';
import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { CollectorService } from '../collector.service';

interface ServeOptions {
  port?: number;
}

@Command({
  name: 'serve',
  description: 'Start a local dashboard to browse collated jobs.',
})
export class ServeCommand extends CommandRunner {
  constructor(private readonly collector: CollectorService) {
    super();
  }

  async run(_params: string[], options: ServeOptions): Promise<void> {
    const port = options.port ?? Number(process.env.COLLECTOR_DASHBOARD_PORT ?? 3456);
    const htmlPath = path.join(process.cwd(), 'apps/collector/public/dashboard.html');

    if (!fs.existsSync(htmlPath)) {
      throw new Error(`Dashboard HTML not found at ${htmlPath}`);
    }

    const dashboardHtml = fs.readFileSync(htmlPath, 'utf-8');

    const server = http.createServer((req, res) => {
      const url = req.url?.split('?')[0] ?? '/';

      if (url === '/api/data') {
        try {
          const data = this.collector.getDashboardData();
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Expires: '0',
          });
          res.end(JSON.stringify(data));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: message }));
        }
        return;
      }

      if (url === '/' || url === '/index.html') {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate',
        });
        res.end(dashboardHtml);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, () => {
        console.log(`Collector dashboard: http://localhost:${port}`);
        console.log(`Reading jobs from: ${this.collector.getStorePath()}`);
        console.log('Press Ctrl+C to stop.');
        resolve();
      });
    });
  }

  @Option({ flags: '-p, --port <port>', description: 'Port (default 3456)' })
  parsePort(val: string): number {
    return parseInt(val, 10);
  }
}

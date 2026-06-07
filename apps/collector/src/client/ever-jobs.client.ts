import axios, { AxiosInstance } from 'axios';
import { JobPostDto, ScraperInputDto } from '@ever-jobs/models';

export interface SearchResponse {
  count: number;
  jobs: JobPostDto[];
  raw_count?: number;
  deduped?: boolean;
}

export interface EverJobsClientOptions {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
}

export class EverJobsClient {
  private readonly http: AxiosInstance;

  constructor(options: EverJobsClientOptions) {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (options.apiKey) {
      headers['x-api-key'] = options.apiKey;
    }

    this.http = axios.create({
      baseURL: options.baseUrl.replace(/\/$/, ''),
      timeout: options.timeoutMs ?? 120_000,
      headers,
    });
  }

  async healthCheck(): Promise<boolean> {
    try {
      const res = await this.http.get('/health', { timeout: 10_000 });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async search(input: Partial<ScraperInputDto>): Promise<SearchResponse> {
    const res = await this.http.post<SearchResponse>(
      '/api/jobs/search?dedup=true',
      input,
    );
    return res.data;
  }
}

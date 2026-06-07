export interface CollatedJob {
  id: number;
  job_url: string;
  title: string;
  company_name: string | null;
  site: string | null;
  is_remote: number | null;
  location: string | null;
  date_posted: string | null;
  first_seen_at: string;
  last_seen_at: string;
  payload_json: string;
}

export interface CollectorStore {
  next_id: number;
  jobs: Record<string, CollatedJob>;
  runs: Array<Record<string, unknown>>;
}

export type NotifiedStore = Record<string, { notified_at: string }>;

export interface NotifierSummary {
  cycle: number;
  total: number;
  new: number;
  sent: number;
  failed: number;
  notifiedStoreSize: number;
  errors: Array<{ jobUrl: string; message: string }>;
}

export interface RunOnceOptions {
  dataPath: string;
  notifiedPath: string;
  token: string;
  chatId: string;
  dryRun: boolean;
  intervalMs: number;
  cycle: number;
  fetchImpl?: typeof fetch;
}

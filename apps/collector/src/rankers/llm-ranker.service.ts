import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const ENTRY_KEYWORDS = /\b(junior|jr\b|entry|entry.level|graduate|new.?grad|early.?career|intern|internship|trainee|apprentice)\b/i;
const MID_KEYWORDS = /\b(mid\b|mid.level|intermediate)\b/i;
const SENIOR_KEYWORDS = /\b(senior|sr\b|staff\b|principal|lead\b|architect|head\s+of|director|vp\b|vice.?president|manager|principal)\b/i;

export interface LlmRankResult {
  score: number;
  reason: string;
  source: 'keyword' | 'llm';
  zeroExpFriendly?: boolean;
  experienceRequired?: string | null;
}

@Injectable()
export class LlmRankerService {
  private readonly logger = new Logger(LlmRankerService.name);
  private readonly openRouterApiKey: string | null;

  constructor(private readonly config: ConfigService) {
    this.openRouterApiKey = this.config.get<string>('OPENROUTER_API_KEY') ?? null;
  }

  async rank(title: string, description?: string | null): Promise<LlmRankResult> {
    const text = title + ' ' + (description ?? '');

    const baseline = this.computeBaseline(text);

    if (baseline <= 40 || baseline >= 80) {
      return { score: baseline, reason: this.baselineReason(baseline), source: 'keyword' };
    }

    if (!this.openRouterApiKey) {
      return { score: baseline, reason: this.baselineReason(baseline), source: 'keyword' };
    }

    try {
      return await this.llmScore(title, description);
    } catch (err: any) {
      this.logger.warn(`LLM ranker failed, falling back to keyword score: ${err.message}`);
      return { score: baseline, reason: this.baselineReason(baseline), source: 'keyword' };
    }
  }

  private computeBaseline(text: string): number {
    if (/\bintern\b/i.test(text)) return 100;
    if (ENTRY_KEYWORDS.test(text)) return 90;
    if (MID_KEYWORDS.test(text)) return 70;
    if (SENIOR_KEYWORDS.test(text)) return 30;
    return 60;
  }

  private baselineReason(score: number): string {
    if (score >= 90) return 'Explicit entry-level keyword match';
    if (score >= 70) return 'Mid-level keyword match';
    if (score >= 50) return 'No seniority signal detected';
    return 'Senior-level keyword detected';
  }

  private async llmScore(title: string, description?: string | null): Promise<LlmRankResult> {
    const prompt = `You are a job relevance scorer. Rate this job from 0-100 for a Junior/Entry-level AI/ML Engineer job seeker.

Rules:
- 90-100: Perfect match — title is exactly "AI Engineer", "ML Engineer", or "AI/ML Engineer", entry-level, <2yr exp
- 70-89: Good match — title is similar (e.g., "AI/ML Engineer"), up to 5yr exp
- 40-69: Decent match — somewhat relevant, mixed signals, no senior keywords
- 10-39: Weak match — senior title, 5+yr exp, PhD required, "staff", "principal"
- 0: Not an AI/ML Engineer role at all (e.g., Data Scientist, Researcher, non-tech)

Also flag whether the posting is friendly to applicants with ZERO professional work experience:
- zeroExpFriendly: true if the posting accepts portfolio/GitHub/side projects in lieu of experience, or explicitly says "no experience required" or "entry level"
- experienceRequired: short description of what experience they ask for (e.g., "2+ years ML", "BS degree", "PhD preferred") or null if none mentioned

Return JSON only: { "score": number, "reason": "short explanation", "zeroExpFriendly": boolean, "experienceRequired": string | null }

Title: ${title}
Description: ${(description ?? '').slice(0, 3000)}`;

    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.openRouterApiKey}`,
        'HTTP-Referer': 'https://github.com/ever-jobs',
        'X-Title': 'Ever Jobs Ranker',
      },
      body: JSON.stringify({
        model: 'qwen3-235b-a22b:free',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => 'unknown');
      throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const content: string = data?.choices?.[0]?.message?.content ?? '';

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`LLM returned invalid JSON: ${content.slice(0, 200)}`);
    }

    const score = Math.max(0, Math.min(100, Math.round(parsed.score ?? 60)));
    const reason = parsed.reason ?? 'LLM-evaluated';
    const zeroExpFriendly = typeof parsed.zeroExpFriendly === 'boolean' ? parsed.zeroExpFriendly : undefined;
    const experienceRequired = typeof parsed.experienceRequired === 'string' ? parsed.experienceRequired : null;

    return { score, reason, source: 'llm', zeroExpFriendly, experienceRequired };
  }
}

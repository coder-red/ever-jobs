export class TelegramError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ERR_TELEGRAM_SEND';
  }
}

export interface SendOptions {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export async function sendMessage(opts: SendOptions): Promise<void> {
  const { token, chatId, text } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? 'https://api.telegram.org';
  const url = `${baseUrl}/bot${token}/sendMessage`;

  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new TelegramError(`Network error calling Telegram: ${message}`);
  }

  if (!res.ok) {
    throw new TelegramError(`Telegram HTTP ${res.status}: ${await res.text().catch(() => '<no body>')}`);
  }

  let body: { ok?: boolean; description?: string } = {};
  try {
    body = (await res.json()) as { ok?: boolean; description?: string };
  } catch {
    throw new TelegramError('Telegram returned non-JSON response');
  }

  if (body.ok !== true) {
    throw new TelegramError(`Telegram API error: ${body.description ?? 'ok=false'}`);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

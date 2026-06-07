import { sendMessage, sleep, TelegramError } from '../src/telegram';

function mockFetchOk(body: unknown = { ok: true, result: { message_id: 1 } }): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  });
}

function mockFetchHttp(status: number, text = 'err'): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: async () => text,
  });
}

function mockFetchApiError(description: string): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: false, description }),
  });
}

describe('telegram.sendMessage', () => {
  it('POSTs to the right URL with token and JSON body', async () => {
    const fetchImpl = mockFetchOk();
    await sendMessage({ token: 'ABC', chatId: '42', text: 'hello', fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botABC/sendMessage');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body);
    expect(body.chat_id).toBe('42');
    expect(body.text).toBe('hello');
    expect(body.parse_mode).toBe('HTML');
    expect(body.disable_web_page_preview).toBe(false);
  });

  it('throws TelegramError on non-2xx', async () => {
    const fetchImpl = mockFetchHttp(429, 'too many');
    await expect(
      sendMessage({ token: 't', chatId: 'c', text: 'x', fetchImpl }),
    ).rejects.toThrow(TelegramError);
  });

  it('throws TelegramError when API returns ok=false', async () => {
    const fetchImpl = mockFetchApiError('chat not found');
    await expect(
      sendMessage({ token: 't', chatId: 'c', text: 'x', fetchImpl }),
    ).rejects.toThrow(/chat not found/);
  });

  it('throws TelegramError on network failure', async () => {
    const fetchImpl = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      sendMessage({ token: 't', chatId: 'c', text: 'x', fetchImpl }),
    ).rejects.toThrow(/ECONNREFUSED/);
  });

  it('honors baseUrl override (for tests)', async () => {
    const fetchImpl = mockFetchOk();
    await sendMessage({
      token: 't',
      chatId: 'c',
      text: 'x',
      fetchImpl,
      baseUrl: 'http://localhost:9999',
    });
    expect(fetchImpl.mock.calls[0][0]).toBe('http://localhost:9999/bott/sendMessage');
  });
});

describe('sleep', () => {
  it('waits at least the requested ms', async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(45);
  });
});

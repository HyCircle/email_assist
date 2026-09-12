import { afterEach, describe, expect, it, vi } from 'vitest';

import { getChatCompletionsUrl, requestDraftFromLlm, testLlmConnection } from '../src/llm';
import type { AssistantSettings, DraftRequest } from '../src/types';

const settings: AssistantSettings = {
  baseUrl: 'http://pc-yh:8070/v1/',
  model: 'Qwen3.8-27B-Q4',
  temperature: 0.2,
  styleNotes: '',
  defaultLanguage: 'english',
  draftPresets: [],
  improvePresets: [],
  signOffOptions: [],
  signatureBlock: '',
};

const request: DraftRequest = {
  type: 'email-assist:draft',
  provider: 'outlook',
  composeKind: 'new',
  action: 'draft',
  instruction: 'Write a concise update.',
  draft: '',
  subject: '',
  contexts: [],
  includeSubject: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('llm client', () => {
  it('derives the OpenAI-compatible chat URL from a base URL', () => {
    expect(getChatCompletionsUrl('http://pc-yh:8070/v1/')).toBe('http://pc-yh:8070/v1/chat/completions');
  });

  it('sends a non-streaming request and parses the response text', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'Hello there.' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestDraftFromLlm(request, settings)).resolves.toBe('Hello there.');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://pc-yh:8070/v1/chat/completions',
      expect.objectContaining({ body: expect.stringContaining('"stream":false') }),
    );
  });

  it('reports an empty response instead of returning a blank draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }));
    await expect(requestDraftFromLlm(request, settings)).rejects.toThrow('usable text');
  });

  it('probes /models for a connection test', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(testLlmConnection('http://pc-yh:8070/v1/')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://pc-yh:8070/v1/models', expect.objectContaining({ method: 'GET' }));
  });

  it('aborts a request that exceeds the configured timeout', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    })));
    const promise = requestDraftFromLlm(request, settings);
    const rejection = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(45_000);
    await rejection;
  });
});

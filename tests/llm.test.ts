import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SYSTEM_PROMPT, MAX_DRAFT_CHARS } from '../src/constants';
import { getChatCompletionsUrl, requestDraftFromLlm, testLlmConnection } from '../src/llm';
import type { AssistantSettings, DraftRequest } from '../src/types';

const settings: AssistantSettings = {
  baseUrl: 'http://pc-yh:8070/v1/',
  model: 'Qwen3.8-27B-Q4-OCR',
  apiKey: 'sk-test',
  compatibilityMode: 'llama.cpp',
  temperature: 0.2,
  maxOutputTokens: 1200,
  reasoningEffort: 'medium',
  enableThinking: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  styleNotes: '',
  defaultLanguage: 'english',
  draftPresets: [],
  improvePresets: [],
  signOffOptions: [],
  signatureBlock: '',
};

const request: DraftRequest = {
  type: 'email-assist:draft',
  requestId: 'request-1',
  provider: 'outlook',
  composeKind: 'new',
  action: 'draft',
  instruction: 'Write a concise update.',
  draft: '',
  subject: '',
  contexts: [],
  attachments: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('llm client', () => {
  it('derives the OpenAI-compatible chat URL from a base URL', () => {
    expect(getChatCompletionsUrl('http://pc-yh:8070/v1/')).toBe('http://pc-yh:8070/v1/chat/completions');
  });

  it('sends a structured non-streaming request and parses the result object', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: '{"body":"Hello there.","subject":"A concise update"}' } }] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestDraftFromLlm(request, settings)).resolves.toEqual({ draft: 'Hello there.', suggestedSubject: 'A concise update' });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://pc-yh:8070/v1/chat/completions',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
        body: expect.stringContaining('"response_format"'),
      }),
    );
    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string) as {
      response_format: { json_schema: { schema: { properties: Record<string, unknown> } } };
    };
    expect(Object.keys(requestBody.response_format.json_schema.schema.properties)).toEqual(['subject', 'body']);
  });

  it('reports an empty response instead of returning a blank draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ choices: [] }) }));
    await expect(requestDraftFromLlm(request, settings)).rejects.toThrow('structured output');
  });

  it('rejects a draft that exceeds the length limit', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: JSON.stringify({ body: 'x'.repeat(MAX_DRAFT_CHARS + 1), subject: 'Long' }) } }] }),
    }));
    await expect(requestDraftFromLlm(request, settings)).rejects.toThrow('exceeded the limit');
  });

  it('probes /models for a connection test', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    await expect(testLlmConnection('http://pc-yh:8070/v1/', 'sk-test')).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith('http://pc-yh:8070/v1/models', expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer sk-test' } }));
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

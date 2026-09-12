import { buildDraftMessages, buildSubjectMessages } from './prompt';
import { REQUEST_TIMEOUT_MS } from './constants';
import type { AssistantSettings, DraftRequest, LlmMessage } from './types';

export function getEndpointOriginPattern(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

export function getChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!getEndpointOriginPattern(normalized)) {
    throw new Error('Base URL must be a valid http or https URL.');
  }

  return `${normalized}/chat/completions`;
}

function getModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  if (!getEndpointOriginPattern(normalized)) {
    throw new Error('Base URL must be a valid http or https URL.');
  }

  return `${normalized}/models`;
}

function extractText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

function cleanText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-zA-Z0-9_-]*\n?|\n```$/g, '')
    .trim();
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`LLM request failed with ${response.status}: ${responseText || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('LLM request timed out.');
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function requestText(messages: LlmMessage[], settings: AssistantSettings): Promise<string> {
  if (!settings.baseUrl) {
    throw new Error('Missing base URL configuration.');
  }

  if (!settings.model) {
    throw new Error('Missing model configuration.');
  }

  const payload = await requestJson(getChatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: settings.model,
      temperature: settings.temperature,
      stream: false,
      messages,
    }),
  });

  const text = cleanText(extractText(payload));
  if (!text) {
    throw new Error('LLM response did not include usable text.');
  }

  return text;
}

export async function testLlmConnection(baseUrl: string): Promise<void> {
  await requestJson(getModelsUrl(baseUrl), { method: 'GET' });
}

export async function requestDraftFromLlm(request: DraftRequest, settings: AssistantSettings): Promise<string> {
  return requestText(buildDraftMessages(request, settings), settings);
}

export async function requestSubjectFromLlm(
  request: DraftRequest,
  draftBody: string,
  settings: AssistantSettings,
): Promise<string> {
  const subject = await requestText(buildSubjectMessages(request, draftBody, settings), settings);
  const firstLine = subject
    .split(/\r?\n/)
    .map((line) => line.replace(/^subject:\s*/i, '').trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    throw new Error('LLM response did not include a usable subject.');
  }

  return firstLine;
}

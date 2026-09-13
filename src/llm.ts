import { buildDraftMessages } from './prompt';
import {
  MAX_ATTACHMENT_DATA_URL_CHARS,
  MAX_DRAFT_CHARS,
  MAX_SUBJECT_CHARS,
  REQUEST_TIMEOUT_MS,
} from './constants';
import type { AssistantSettings, DraftRequest, LlmMessage } from './types';

export interface DraftGeneration {
  draft: string;
  suggestedSubject?: string;
}

export const EMAIL_ASSISTANT_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: ['string', 'null'] },
    body: { type: 'string' },
  },
  required: ['subject', 'body'],
} as const;

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

function extractContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .filter((part): part is { text: string } => Boolean(part) && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string')
      .map((part) => part.text)
      .join('')
      .trim();
  }

  return '';
}

function cleanText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```(?:json|text)?\s*|\s*```$/gi, '')
    .trim();
}

async function requestJson(url: string, init: RequestInit, externalSignal?: AbortSignal): Promise<unknown> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortExternal = (): void => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', abortExternal, { once: true });
    }
  }

  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`LLM request failed with ${response.status}: ${responseText || response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(externalSignal?.aborted ? 'LLM request cancelled.' : 'LLM request timed out.');
    }

    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', abortExternal);
  }
}

function buildRequestBody(messages: LlmMessage[], settings: AssistantSettings): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: settings.model,
    temperature: settings.temperature,
    stream: false,
    messages,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'email_assistant_result',
        strict: true,
        schema: EMAIL_ASSISTANT_RESPONSE_SCHEMA,
      },
    },
  };

  if (settings.compatibilityMode === 'llama.cpp') {
    body.max_tokens = settings.maxOutputTokens;
    body.chat_template_kwargs = { enable_thinking: settings.enableThinking };
  } else {
    body.max_completion_tokens = settings.maxOutputTokens;
  }

  if (settings.reasoningEffort !== 'none') {
    body.reasoning_effort = settings.reasoningEffort;
  }

  return body;
}

function requestHeaders(settings: AssistantSettings): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {}),
  };
}

function parseResult(payload: unknown, request: DraftRequest): DraftGeneration {
  const raw = cleanText(extractContent(payload));
  if (!raw) {
    throw new Error('LLM response did not include usable structured output.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('LLM response was not valid JSON for the email result.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM response did not contain an email result object.');
  }

  const candidate = parsed as { body?: unknown; subject?: unknown };
  if (typeof candidate.body !== 'string') {
    throw new Error('LLM response did not contain a usable email body.');
  }
  if (candidate.subject !== null && typeof candidate.subject !== 'string') {
    throw new Error('LLM response did not contain a valid subject.');
  }

  const draft = cleanText(candidate.body);
  if (!draft) {
    throw new Error('LLM response did not contain a usable email body.');
  }
  if (draft.length > MAX_DRAFT_CHARS) {
    throw new Error('Model output exceeded the limit. Please retry.');
  }

  if (request.composeKind === 'reply') {
    return { draft };
  }

  if (candidate.subject === null) {
    throw new Error('LLM response did not contain a subject for the new email.');
  }

  const subject = cleanText(candidate.subject).replace(/^subject:\s*/i, '').replace(/\s+/g, ' ').trim();
  if (subject.length > MAX_SUBJECT_CHARS) {
    throw new Error('Model subject exceeded the limit. Please retry.');
  }

  return { draft, suggestedSubject: subject };
}

async function requestResult(
  request: DraftRequest,
  settings: AssistantSettings,
  signal?: AbortSignal,
): Promise<DraftGeneration> {
  if (!settings.baseUrl) {
    throw new Error('Missing base URL configuration.');
  }

  if (!settings.model) {
    throw new Error('Missing model configuration.');
  }

  for (const attachment of [...request.attachments, ...request.contexts.flatMap((context) => context.attachments ?? [])]) {
    if (attachment.dataUrl && attachment.dataUrl.length > MAX_ATTACHMENT_DATA_URL_CHARS) {
      throw new Error('An image attachment exceeded the size limit.');
    }
  }

  const payload = await requestJson(getChatCompletionsUrl(settings.baseUrl), {
    method: 'POST',
    headers: requestHeaders(settings),
    body: JSON.stringify(buildRequestBody(buildDraftMessages(request, settings), settings)),
  }, signal);

  return parseResult(payload, request);
}

export function requestDraftFromLlm(
  request: DraftRequest,
  settings: AssistantSettings,
  signal?: AbortSignal,
): Promise<DraftGeneration> {
  return requestResult(request, settings, signal);
}

export async function testLlmConnection(baseUrl: string, apiKey = ''): Promise<void> {
  await requestJson(getModelsUrl(baseUrl), {
    method: 'GET',
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
  });
}

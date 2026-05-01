import { buildChatMessages, buildSubjectMessages } from './prompt';
import type { AssistantSettings, GenerateDraftRequest, LlmMessage } from './types';

export function getEndpointOriginPattern(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    return `${url.protocol}//${url.host}/*`;
  } catch {
    return null;
  }
}

function extractDraftText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') {
    return '';
  }

  const choices = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices;
  const content = choices?.[0]?.message?.content;

  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }

        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }

        return '';
      })
      .join('\n')
      .trim();
  }

  return '';
}

function cleanDraftText(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^```[a-zA-Z0-9_-]*\n?|\n```$/g, '')
    .trim();
}

async function requestTextFromLlm(messages: LlmMessage[], settings: AssistantSettings): Promise<string> {
  if (!settings.endpoint) {
    throw new Error('Missing endpoint configuration.');
  }

  if (!settings.model) {
    throw new Error('Missing model configuration.');
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (settings.apiKey) {
    headers.Authorization = `Bearer ${settings.apiKey}`;
  }

  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      temperature: settings.temperature,
      stream: false,
      messages,
    }),
  });

  if (!response.ok) {
    const responseText = await response.text();
    throw new Error(`LLM request failed with ${response.status}: ${responseText || response.statusText}`);
  }

  const payload = (await response.json()) as unknown;
  return cleanDraftText(extractDraftText(payload));
}

export async function requestDraftFromLlm(
  request: GenerateDraftRequest,
  settings: AssistantSettings,
): Promise<string> {
  const draft = await requestTextFromLlm(buildChatMessages(request, settings), settings);

  if (!draft) {
    throw new Error('LLM response did not include a usable draft.');
  }

  return draft;
}

export async function requestSubjectFromLlm(
  request: GenerateDraftRequest,
  draftBody: string,
  settings: AssistantSettings,
): Promise<string | undefined> {
  const subject = await requestTextFromLlm(buildSubjectMessages(request, draftBody, settings), settings);
  return subject
    .split(/\r?\n/)
    .map((line) => line.replace(/^subject:\s*/i, '').trim())
    .find((line) => line.length > 0);
}
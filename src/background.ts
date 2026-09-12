import { getEndpointOriginPattern, requestDraftFromLlm, requestSubjectFromLlm, testLlmConnection } from './llm';
import { MAX_CONTEXT_ITEMS, MAX_DRAFT_CHARS, MAX_INSTRUCTION_CHARS } from './constants';
import { ensureSettingsInitialized, getSettings } from './storage';
import type {
  ComposeKind,
  ContextItem,
  DraftAction,
  DraftFailure,
  DraftRequest,
  DraftResponse,
  DraftSuccess,
  OpenSettingsRequest,
  OpenSettingsResponse,
  ProviderName,
  TestConnectionRequest,
  TestConnectionResponse,
} from './types';

function isProvider(value: unknown): value is ProviderName {
  return value === 'gmail' || value === 'outlook';
}

function isComposeKind(value: unknown): value is ComposeKind {
  return value === 'new' || value === 'reply';
}

function isDraftAction(value: unknown): value is DraftAction {
  return value === 'draft' || value === 'improve';
}

function isContextItem(value: unknown): value is ContextItem {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ContextItem>;
  return (
    typeof candidate.id === 'string' &&
    (candidate.kind === 'current-thread' || candidate.kind === 'pasted') &&
    isProvider(candidate.provider) &&
    typeof candidate.subject === 'string' &&
    Array.isArray(candidate.participants) &&
    candidate.participants.every((item) => typeof item === 'string') &&
    Array.isArray(candidate.messages) &&
    candidate.messages.every(
      (message) =>
        Boolean(message) &&
        typeof message === 'object' &&
        typeof message.sender === 'string' &&
        typeof message.date === 'string' &&
        typeof message.body === 'string',
    ) &&
    typeof candidate.label === 'string'
  );
}

export function isDraftRequest(message: unknown): message is DraftRequest {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<DraftRequest>;
  return (
    candidate.type === 'email-assist:draft' &&
    isProvider(candidate.provider) &&
    isComposeKind(candidate.composeKind) &&
    isDraftAction(candidate.action) &&
    typeof candidate.instruction === 'string' &&
    candidate.instruction.trim().length > 0 &&
    candidate.instruction.length <= MAX_INSTRUCTION_CHARS &&
    typeof candidate.draft === 'string' &&
    candidate.draft.length <= MAX_DRAFT_CHARS &&
    typeof candidate.subject === 'string' &&
    Array.isArray(candidate.contexts) &&
    candidate.contexts.length <= MAX_CONTEXT_ITEMS &&
    candidate.contexts.every(isContextItem) &&
    candidate.contexts.every((context) => context.provider === candidate.provider) &&
    typeof candidate.includeSubject === 'boolean'
  );
}

function isOpenSettingsRequest(message: unknown): message is OpenSettingsRequest {
  return Boolean(message) && typeof message === 'object' && (message as Partial<OpenSettingsRequest>).type === 'email-assist:open-settings';
}

export function isTestConnectionRequest(message: unknown): message is TestConnectionRequest {
  return (
    Boolean(message) &&
    typeof message === 'object' &&
    (message as Partial<TestConnectionRequest>).type === 'email-assist:test-connection' &&
    typeof (message as Partial<TestConnectionRequest>).baseUrl === 'string' &&
    Boolean((message as TestConnectionRequest).baseUrl.trim())
  );
}

export function isTrustedSender(sender: chrome.runtime.MessageSender): boolean {
  const sourceUrl = sender.url ?? sender.tab?.url ?? '';
  return (
    sourceUrl.startsWith('https://mail.google.com/') ||
    sourceUrl.startsWith('https://outlook.live.com/mail/') ||
    sourceUrl.startsWith('https://outlook.office.com/mail/') ||
    sourceUrl.startsWith('https://outlook.cloud.microsoft/mail/')
  );
}

export function isExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  const sourceUrl = sender.url ?? '';
  const extensionId = typeof chrome !== 'undefined' ? chrome.runtime?.id : '';
  return Boolean(extensionId) && sourceUrl.startsWith(`chrome-extension://${extensionId}/`);
}

async function hasEndpointPermission(baseUrl: string): Promise<boolean> {
  const originPattern = getEndpointOriginPattern(baseUrl);
  return Boolean(originPattern && (await chrome.permissions.contains({ origins: [originPattern] })));
}

async function handleDraft(message: DraftRequest, sender: chrome.runtime.MessageSender): Promise<DraftResponse> {
  if (!isTrustedSender(sender)) {
    return { ok: false, error: 'Blocked request from an unexpected page.' } satisfies DraftFailure;
  }

  const settings = await getSettings();

  if (!(await hasEndpointPermission(settings.baseUrl))) {
    return { ok: false, error: 'Endpoint access is not granted for the configured base URL.' } satisfies DraftFailure;
  }

  try {
    const draft = await requestDraftFromLlm(message, settings);
    let suggestedSubject: string | undefined;
    let subjectError: string | undefined;
    if (message.includeSubject && !message.subject.trim()) {
      try {
        suggestedSubject = await requestSubjectFromLlm(message, draft, settings);
      } catch (error) {
        subjectError = error instanceof Error ? error.message : 'Could not create a subject suggestion.';
      }
    }

    return { ok: true, draft, suggestedSubject, subjectError } satisfies DraftSuccess;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unexpected draft generation error.';
    return { ok: false, error: errorMessage } satisfies DraftFailure;
  }
}

async function handleTestConnection(
  message: TestConnectionRequest,
  sender: chrome.runtime.MessageSender,
): Promise<TestConnectionResponse> {
  if (!isExtensionPageSender(sender)) {
    return { ok: false, error: 'Blocked request from an unexpected page.' };
  }

  if (!(await hasEndpointPermission(message.baseUrl))) {
    return { ok: false, error: 'Endpoint access is not granted for this base URL.' };
  }

  try {
    await testLlmConnection(message.baseUrl);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Connection failed.' };
  }
}

if (typeof chrome !== 'undefined') {
  chrome.runtime.onInstalled.addListener(() => {
    void ensureSettingsInitialized();
  });

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isDraftRequest(message)) {
      void handleDraft(message, sender).then(sendResponse);
      return true;
    }

    if (isOpenSettingsRequest(message)) {
      void chrome.runtime
        .openOptionsPage()
        .then(() => sendResponse({ ok: true } satisfies OpenSettingsResponse))
        .catch((error: unknown) => {
          const errorMessage = error instanceof Error ? error.message : 'Could not open settings.';
          sendResponse({ ok: false, error: errorMessage } satisfies OpenSettingsResponse);
        });
      return true;
    }

    if (isTestConnectionRequest(message)) {
      void handleTestConnection(message, sender).then(sendResponse);
      return true;
    }

    return undefined;
  });
}

import { getEndpointOriginPattern, requestDraftFromLlm, testLlmConnection } from './llm';
import {
  MAX_ATTACHMENT_DATA_URL_CHARS,
  MAX_ATTACHMENT_ITEMS,
  MAX_ATTACHMENT_NAME_CHARS,
  MAX_CONTEXT_ITEM_CHARS,
  MAX_CONTEXT_ITEMS,
  MAX_CONTEXT_MESSAGES,
  MAX_DRAFT_CHARS,
  MAX_INSTRUCTION_CHARS,
  MAX_PARTICIPANTS,
  MAX_REQUEST_ID_CHARS,
  MAX_SUBJECT_CHARS,
} from './constants';
import { ensureSettingsInitialized, getSettings } from './storage';
import type {
  ComposeKind,
  CancelDraftRequest,
  ContextAttachment,
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

function isContextAttachment(value: unknown): value is ContextAttachment {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<ContextAttachment>;
  return (
    typeof candidate.name === 'string' && candidate.name.length <= MAX_ATTACHMENT_NAME_CHARS &&
    (candidate.kind === 'image' || candidate.kind === 'file') &&
    typeof candidate.mediaType === 'string' && candidate.mediaType.length <= 160 &&
    typeof candidate.size === 'string' && candidate.size.length <= 80 &&
    (candidate.dataUrl === undefined || (candidate.kind === 'image' && typeof candidate.dataUrl === 'string' && candidate.dataUrl.length <= MAX_ATTACHMENT_DATA_URL_CHARS && candidate.dataUrl.startsWith('data:image/'))) &&
    (candidate.sourceUrl === undefined || (typeof candidate.sourceUrl === 'string' && candidate.sourceUrl.length <= 2000)) &&
    (candidate.temporary === undefined || typeof candidate.temporary === 'boolean')
  );
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
    candidate.subject.length <= MAX_SUBJECT_CHARS &&
    Array.isArray(candidate.participants) &&
    candidate.participants.length <= MAX_PARTICIPANTS &&
    candidate.participants.every((item) => typeof item === 'string') &&
    Array.isArray(candidate.messages) &&
    candidate.messages.length <= MAX_CONTEXT_MESSAGES &&
    candidate.messages.every(
      (message) =>
        Boolean(message) &&
        typeof message === 'object' &&
        typeof message.sender === 'string' &&
        typeof message.date === 'string' &&
        typeof message.body === 'string',
    ) &&
    candidate.messages.every((message) => message.sender.length <= MAX_ATTACHMENT_NAME_CHARS && message.date.length <= 160 && message.body.length <= MAX_CONTEXT_ITEM_CHARS) &&
    typeof candidate.label === 'string' &&
    candidate.label.length <= MAX_ATTACHMENT_NAME_CHARS &&
    (candidate.attachments === undefined || (Array.isArray(candidate.attachments) && candidate.attachments.length <= MAX_ATTACHMENT_ITEMS && candidate.attachments.every(isContextAttachment)))
  );
}

export function isDraftRequest(message: unknown): message is DraftRequest {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<DraftRequest>;
  return (
    candidate.type === 'email-assist:draft' &&
    typeof candidate.requestId === 'string' &&
    candidate.requestId.trim().length > 0 &&
    candidate.requestId.length <= MAX_REQUEST_ID_CHARS &&
    isProvider(candidate.provider) &&
    isComposeKind(candidate.composeKind) &&
    isDraftAction(candidate.action) &&
    typeof candidate.instruction === 'string' &&
    candidate.instruction.trim().length > 0 &&
    candidate.instruction.length <= MAX_INSTRUCTION_CHARS &&
    typeof candidate.draft === 'string' &&
    candidate.draft.length <= MAX_DRAFT_CHARS &&
    typeof candidate.subject === 'string' &&
    candidate.subject.length <= MAX_SUBJECT_CHARS &&
    Array.isArray(candidate.contexts) &&
    candidate.contexts.length <= MAX_CONTEXT_ITEMS &&
    candidate.contexts.every(isContextItem) &&
    candidate.contexts.every((context) => context.provider === candidate.provider) &&
    Array.isArray(candidate.attachments) &&
    candidate.attachments.length <= MAX_ATTACHMENT_ITEMS &&
    candidate.attachments.every(isContextAttachment) &&
    (candidate.writer === undefined ||
      (typeof candidate.writer === 'string' && candidate.writer.length <= MAX_ATTACHMENT_NAME_CHARS))
  );
}

function isCancelDraftRequest(message: unknown): message is CancelDraftRequest {
  return Boolean(message) && typeof message === 'object' &&
    (message as Partial<CancelDraftRequest>).type === 'email-assist:cancel-draft' &&
    typeof (message as Partial<CancelDraftRequest>).requestId === 'string' &&
    Boolean((message as CancelDraftRequest).requestId.trim()) &&
    (message as CancelDraftRequest).requestId.length <= MAX_REQUEST_ID_CHARS;
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
    typeof (message as Partial<TestConnectionRequest>).apiKey === 'string' &&
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

const pendingDrafts = new Map<string, AbortController>();

function cancelDraftsForTab(tabId: number): void {
  const prefix = `${tabId}:`;
  for (const [key, controller] of pendingDrafts) {
    if (key.startsWith(prefix)) {
      controller.abort();
    }
  }
}

function draftKey(message: { requestId: string }, sender: chrome.runtime.MessageSender): string {
  return `${sender.tab?.id ?? sender.url ?? 'unknown'}:${message.requestId}`;
}

async function handleDraft(message: DraftRequest, sender: chrome.runtime.MessageSender): Promise<DraftResponse> {
  if (!isTrustedSender(sender)) {
    return { ok: false, error: 'Blocked request from an unexpected page.' } satisfies DraftFailure;
  }

  const key = draftKey(message, sender);
  const controller = new AbortController();
  pendingDrafts.set(key, controller);
  try {
    const settings = await getSettings();

    if (!(await hasEndpointPermission(settings.baseUrl))) {
      return { ok: false, error: 'Endpoint access is not granted for the configured base URL.' } satisfies DraftFailure;
    }

    const result = await requestDraftFromLlm(message, settings, controller.signal);
    return { ok: true, draft: result.draft, suggestedSubject: result.suggestedSubject } satisfies DraftSuccess;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unexpected draft generation error.';
    return { ok: false, error: errorMessage } satisfies DraftFailure;
  } finally {
    if (pendingDrafts.get(key) === controller) {
      pendingDrafts.delete(key);
    }
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
    await testLlmConnection(message.baseUrl, message.apiKey);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Connection failed.' };
  }
}

if (typeof chrome !== 'undefined') {
  chrome.runtime.onInstalled.addListener(() => {
    void ensureSettingsInitialized();
  });

  chrome.tabs.onRemoved.addListener(cancelDraftsForTab);

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (isDraftRequest(message)) {
      void handleDraft(message, sender).then(sendResponse);
      return true;
    }

    if (isCancelDraftRequest(message)) {
      if (!isTrustedSender(sender)) {
        sendResponse({ ok: false, error: 'Blocked request from an unexpected page.' });
        return false;
      }
      pendingDrafts.get(draftKey(message, sender))?.abort();
      sendResponse({ ok: true });
      return false;
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

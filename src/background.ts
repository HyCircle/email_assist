import { getEndpointOriginPattern, requestDraftFromLlm, requestSubjectFromLlm } from './llm';
import { ensureSettingsInitialized, getSettings } from './storage';
import type {
  GenerateDraftRequest,
  GenerateDraftResponse,
  OpenSettingsRequest,
  OpenSettingsResponse,
} from './types';

function isGenerateDraftRequest(message: unknown): message is GenerateDraftRequest {
  if (!message || typeof message !== 'object') {
    return false;
  }

  const candidate = message as Partial<GenerateDraftRequest>;
  return candidate.type === 'email-assist:generate' && typeof candidate.instruction === 'string';
}

function isOpenSettingsRequest(message: unknown): message is OpenSettingsRequest {
  if (!message || typeof message !== 'object') {
    return false;
  }

  return (message as Partial<OpenSettingsRequest>).type === 'email-assist:open-settings';
}

function isTrustedSender(sender: chrome.runtime.MessageSender): boolean {
  const sourceUrl = sender.url ?? '';
  return (
    sourceUrl.startsWith('https://mail.google.com/') ||
    sourceUrl.startsWith('https://outlook.live.com/mail/') ||
    sourceUrl.startsWith('https://outlook.office.com/mail/')
  );
}

async function hasEndpointPermission(endpoint: string): Promise<boolean> {
  const originPattern = getEndpointOriginPattern(endpoint);

  if (!originPattern) {
    return false;
  }

  return chrome.permissions.contains({ origins: [originPattern] });
}

async function handleGenerateDraft(
  message: GenerateDraftRequest,
  sender: chrome.runtime.MessageSender,
): Promise<GenerateDraftResponse> {
  if (!isTrustedSender(sender)) {
    return { ok: false, error: 'Blocked request from an unexpected page.' };
  }

  const settings = await getSettings();

  if (!settings.endpoint) {
    return { ok: false, error: 'No LLM endpoint configured. Open Settings and save an endpoint first.' };
  }

  if (!settings.model) {
    return { ok: false, error: 'No model configured. Open Settings and set a model name first.' };
  }

  const hasPermission = await hasEndpointPermission(settings.endpoint);

  if (!hasPermission) {
    return {
      ok: false,
      error: 'Endpoint access has not been granted. Open Settings and save the endpoint to grant permission.',
    };
  }

  try {
    const draft = await requestDraftFromLlm(message, settings);
    let subject: string | undefined;

    if (message.generateSubject) {
      try {
        subject = await requestSubjectFromLlm(message, draft, settings);
      } catch {
        subject = undefined;
      }
    }

    return { ok: true, draft, subject };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unexpected draft generation error.';
    return { ok: false, error: errorMessage };
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettingsInitialized();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (isGenerateDraftRequest(message)) {
    void handleGenerateDraft(message, sender).then(sendResponse);
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

  return undefined;
});
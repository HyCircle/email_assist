import { describe, expect, it, vi } from 'vitest';

import { isDraftRequest, isExtensionPageSender, isTestConnectionRequest, isTrustedSender } from '../src/background';
import type { DraftRequest } from '../src/types';

const validRequest: DraftRequest = {
  type: 'email-assist:draft',
  requestId: 'request-1',
  provider: 'gmail',
  composeKind: 'reply',
  action: 'improve',
  instruction: 'Make it shorter.',
  draft: 'Thanks.',
  subject: 'Update',
  attachments: [],
  contexts: [{
    id: 'thread-1',
    kind: 'current-thread',
    provider: 'gmail',
    subject: 'Update',
    participants: ['Alice'],
    messages: [{ sender: 'Alice', date: '', body: 'Please reply.' }],
    label: 'Current thread',
  }],
};

describe('background message boundary', () => {
  it('accepts the complete draft contract and rejects malformed actions', () => {
    expect(isDraftRequest(validRequest)).toBe(true);
    expect(isDraftRequest({ ...validRequest, action: 'generate' })).toBe(false);
    expect(isDraftRequest({ ...validRequest, contexts: [{ ...validRequest.contexts[0], messages: [{ sender: 'Alice', date: '', body: 4 }] }] })).toBe(false);
    expect(isDraftRequest({ ...validRequest, instruction: ' ' })).toBe(false);
    expect(isDraftRequest({ ...validRequest, instruction: 'x'.repeat(4001) })).toBe(false);
    expect(isDraftRequest({ ...validRequest, draft: 'x'.repeat(6001) })).toBe(false);
    expect(isDraftRequest({ ...validRequest, subject: 'x'.repeat(241) })).toBe(false);
    expect(isDraftRequest({ ...validRequest, contexts: [{ ...validRequest.contexts[0], messages: [{ sender: 'Alice', date: '', body: 'x'.repeat(7001) }] }] })).toBe(false);
    expect(isDraftRequest({ ...validRequest, contexts: [{ ...validRequest.contexts[0], provider: 'outlook' }] })).toBe(false);
    expect(isDraftRequest({ ...validRequest, contexts: Array.from({ length: 7 }, (_, index) => ({ ...validRequest.contexts[0], id: `thread-${index}` })) })).toBe(false);
    expect(isDraftRequest({ ...validRequest, writer: 'Yuncheng <me@example.com>' })).toBe(true);
    expect(isDraftRequest({ ...validRequest, writer: 'x'.repeat(241) })).toBe(false);
  });

  it('accepts only supported Gmail and Outlook page senders', () => {
    expect(isTrustedSender({ url: 'https://mail.google.com/mail/u/0/#inbox' } as chrome.runtime.MessageSender)).toBe(true);
    expect(isTrustedSender({ url: 'https://outlook.office.com/mail/' } as chrome.runtime.MessageSender)).toBe(true);
    expect(isTrustedSender({ url: 'https://example.com/mail' } as chrome.runtime.MessageSender)).toBe(false);
  });

  it('accepts connection tests from the extension page and rejects empty URLs', () => {
    expect(isTestConnectionRequest({ type: 'email-assist:test-connection', baseUrl: 'http://pc-yh:8070/v1', apiKey: '' })).toBe(true);
    expect(isTestConnectionRequest({ type: 'email-assist:test-connection', baseUrl: ' ' })).toBe(false);
    const chromeStub = { runtime: { id: 'extension-id' } };
    vi.stubGlobal('chrome', chromeStub);
    expect(isExtensionPageSender({ url: 'chrome-extension://extension-id/settings.html' } as chrome.runtime.MessageSender)).toBe(true);
    expect(isExtensionPageSender({ url: 'https://mail.google.com/' } as chrome.runtime.MessageSender)).toBe(false);
    vi.unstubAllGlobals();
  });
});

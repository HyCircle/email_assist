import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { attachAssistantPanel } from '../src/panel';
import type { ComposeKind, ContextItem } from '../src/types';

let cleanup: (() => void) | undefined;

function installDom(
  sendMessage: ReturnType<typeof vi.fn>,
  options?: {
    composeKind?: ComposeKind;
    getCurrentContext?: () => ContextItem | null;
    initialDraft?: string;
    initialSubject?: string;
  },
): {
  host: HTMLElement;
  insertDraft: ReturnType<typeof vi.fn>;
  insertSubject: ReturnType<typeof vi.fn>;
  panel: ReturnType<typeof attachAssistantPanel>;
  setNativeSubject: (value: string) => void;
} {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://outlook.live.com/mail/' });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('Option', dom.window.Option);
  vi.stubGlobal('crypto', { randomUUID: () => 'test-id' });
  dom.window.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0);
    return 1;
  };

  vi.stubGlobal('chrome', {
    runtime: { sendMessage },
    storage: {
      sync: { get: vi.fn().mockResolvedValue({}) },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  });

  const host = dom.window.document.createElement('div');
  const editor = dom.window.document.createElement('div');
  host.append(editor);
  dom.window.document.body.append(host);
  vi.spyOn(dom.window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 640,
    height: 120,
    top: 0,
    left: 0,
    right: 640,
    bottom: 120,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));

  let nativeSubject = options?.initialSubject ?? '';
  const insertDraft = vi.fn();
  const insertSubject = vi.fn();
  const panel = attachAssistantPanel({
    provider: 'outlook',
    editor,
    composeKind: options?.composeKind ?? 'new',
    getAssistantMount: () => ({ kind: 'flow', host, before: editor }),
    getCurrentContext: options?.getCurrentContext ?? (() => null),
    readDraft: () => options?.initialDraft ?? '',
    readSubject: () => nativeSubject,
    insertDraft,
    insertSubject,
  });
  cleanup = panel.cleanup;
  return {
    host,
    insertDraft,
    insertSubject,
    panel,
    setNativeSubject: (value: string) => {
      nativeSubject = value;
    },
  };
}

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('assistant panel', () => {
  it('moves submitted prompts into selectable history and sends only the new improve instruction', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, draft: 'First draft.' })
      .mockResolvedValueOnce({ ok: true, draft: 'Improved draft.' });
    const { host } = installDom(sendMessage);
    const trigger = host.querySelector<HTMLButtonElement>('.ea-trigger')!;
    trigger.click();

    const instruction = host.querySelector<HTMLTextAreaElement>('[aria-label="Writing instruction"]')!;
    const primary = host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!;
    instruction.value = 'Write a concise update.';
    primary.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(instruction.value).toBe('');
    expect(instruction.placeholder).toContain('improve');
    expect(host.querySelector('.ea-prompt-history')?.textContent).toContain('Write a concise update.');
    expect(host.querySelector('.ea-prompt-history-list li')?.textContent).toBe('Write a concise update.');

    const promptToggle = host.querySelector<HTMLButtonElement>('.ea-prompt-toggle')!;
    const draft = host.querySelector<HTMLTextAreaElement>('[aria-label="Draft email"]')!;
    promptToggle.click();
    expect(promptToggle.textContent).toBe('Prompt history');
    expect(instruction.hidden).toBe(true);
    expect(host.querySelector('.ea-prompt-history')?.hasAttribute('hidden')).toBe(false);
    expect(draft.value).toBe('First draft.');
    expect(host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')?.disabled).toBe(true);

    promptToggle.click();
    expect(promptToggle.textContent).toBe('Prompt');
    expect(instruction.hidden).toBe(false);

    instruction.value = 'Make it warmer.';
    host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage.mock.calls[0]?.[0].instruction).toBe('Write a concise update.');
    expect(sendMessage.mock.calls[1]?.[0].instruction).toBe('Make it warmer.');
    expect(sendMessage.mock.calls[1]?.[0].draft).toBe('First draft.');
    expect(host.querySelectorAll('.ea-prompt-history-list li')).toHaveLength(2);
  });

  it('previews generated draft history and restores an earlier version', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, draft: 'First draft.', suggestedSubject: 'First subject' })
      .mockResolvedValueOnce({ ok: true, draft: 'Second draft.', suggestedSubject: 'Second subject' });
    const { host } = installDom(sendMessage);
    host.querySelector<HTMLButtonElement>('.ea-trigger')!.click();

    const instruction = host.querySelector<HTMLTextAreaElement>('[aria-label="Writing instruction"]')!;
    const primary = host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!;
    instruction.value = 'Write the first version.';
    primary.click();
    await Promise.resolve();
    await Promise.resolve();
    instruction.value = 'Make it shorter.';
    primary.click();
    await Promise.resolve();
    await Promise.resolve();

    const draftToggle = host.querySelector<HTMLButtonElement>('.ea-draft-toggle')!;
    draftToggle.click();
    expect(host.querySelectorAll('.ea-draft-history-item')).toHaveLength(2);
    expect(host.querySelector('.ea-draft-history-item .ea-draft-history-header')?.textContent).toContain('V2 (Current)');
    expect(host.querySelector<HTMLTextAreaElement>('.ea-draft-history-item textarea')?.value).toBe('Second draft.');
    expect(host.querySelectorAll<HTMLTextAreaElement>('.ea-draft-history-item textarea')[1]?.value).toBe('First draft.');
    expect(host.querySelector('.ea-draft-history')?.textContent).not.toContain('Make it shorter.');
    expect(host.querySelector('.ea-subject-actions')?.hasAttribute('hidden')).toBe(true);

    host.querySelectorAll<HTMLButtonElement>('.ea-draft-history-item .ea-secondary-button')[1]!.click();
    expect(host.querySelector<HTMLTextAreaElement>('[aria-label="Draft email"]')?.value).toBe('First draft.');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Subject"]')?.value).toBe('First subject');
    expect(host.querySelector('.ea-draft-history')?.hasAttribute('hidden')).toBe(true);
    expect(host.querySelector('.ea-subject-actions')?.hasAttribute('hidden')).toBe(false);
  });

  it('cancels a running request when the panel is collapsed', async () => {
    const sendMessage = vi.fn((message: { type: string }) => {
      if (message.type === 'email-assist:draft') {
        return new Promise(() => undefined);
      }
      return Promise.resolve({ ok: true });
    });
    const { host } = installDom(sendMessage);
    const trigger = host.querySelector<HTMLButtonElement>('.ea-trigger')!;
    trigger.click();

    const instruction = host.querySelector<HTMLTextAreaElement>('[aria-label="Writing instruction"]')!;
    instruction.value = 'Draft it.';
    host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!.click();
    await Promise.resolve();

    trigger.click();
    expect(sendMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'email-assist:cancel-draft' }));
    expect(host.querySelector('.ea-panel')?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps the collapsed state to a single Assist button and exposes icon labels after drafting', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, draft: 'Draft text.' });
    const { host } = installDom(sendMessage);

    expect(host.querySelector<HTMLButtonElement>('.ea-trigger')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('.ea-icon-button[aria-label="Open Email Assistant settings"]')?.hidden).toBe(true);
    expect(host.querySelector('.ea-panel')?.hasAttribute('hidden')).toBe(true);

    host.querySelector<HTMLButtonElement>('.ea-trigger')!.click();
    const instruction = host.querySelector<HTMLTextAreaElement>('[aria-label="Writing instruction"]')!;
    instruction.value = 'Draft it.';
    host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector<HTMLButtonElement>('[aria-label="Copy draft"]')).not.toBeNull();
    expect(host.querySelector<HTMLButtonElement>('[aria-label="Start over"]')?.textContent).toBe('↺');
  });

  it('applies the generated subject through the provider binding', async () => {
    const sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      draft: 'Draft text.',
      suggestedSubject: 'Test email',
    });
    const { host, insertDraft, insertSubject } = installDom(sendMessage);
    host.querySelector<HTMLButtonElement>('.ea-trigger')!.click();

    const instruction = host.querySelector<HTMLTextAreaElement>('[aria-label="Writing instruction"]')!;
    instruction.value = 'Draft it.';
    host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.querySelector('.ea-subject-actions .ea-field > span')?.textContent).toBe('Subject:');
    host.querySelector<HTMLButtonElement>('.ea-review-actions .ea-primary-button')!.click();

    expect(insertDraft).toHaveBeenCalledWith(expect.any(HTMLElement), 'Draft text.');
    expect(insertSubject).toHaveBeenCalledWith(expect.any(HTMLElement), 'Test email');
  });

  it('shows the existing subject for a new compose and preserves it while improving', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, draft: 'Improved draft.' });
    const { host, insertSubject } = installDom(sendMessage, {
      initialDraft: 'Existing draft.\n\nBest regards,',
      initialSubject: 'Existing subject',
    });
    host.querySelector<HTMLButtonElement>('.ea-trigger')!.click();

    const subject = host.querySelector<HTMLInputElement>('[aria-label="Subject"]')!;
    expect(subject.value).toBe('Existing subject');
    expect(subject.closest('.ea-subject-actions')?.hasAttribute('hidden')).toBe(false);

    subject.value = 'Improved subject';
    subject.dispatchEvent(new window.Event('input', { bubbles: true }));
    const instruction = host.querySelector<HTMLTextAreaElement>('[aria-label="Writing instruction"]')!;
    instruction.value = 'Improve both.';
    host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage.mock.calls[0]?.[0].subject).toBe('Improved subject');
    expect(subject.value).toBe('Improved subject');

    host.querySelector<HTMLButtonElement>('.ea-review-actions .ea-primary-button')!.click();
    expect(insertSubject).toHaveBeenCalledWith(expect.any(HTMLElement), 'Improved subject');
  });

  it('reads the native subject once before the first draft, then Apply writes the panel subject', async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ ok: true, draft: 'Draft text.', suggestedSubject: 'Assist subject' })
      .mockResolvedValueOnce({ ok: true, draft: 'Improved text.', suggestedSubject: 'Assist subject' });
    const { host, insertSubject, setNativeSubject } = installDom(sendMessage, { initialSubject: 'Original' });
    host.querySelector<HTMLButtonElement>('.ea-trigger')!.click();

    setNativeSubject('Typed in compose');
    const instruction = host.querySelector<HTMLTextAreaElement>('[aria-label="Writing instruction"]')!;
    instruction.value = 'Draft it.';
    host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage.mock.calls[0]?.[0].subject).toBe('Typed in compose');
    expect(host.querySelector<HTMLInputElement>('[aria-label="Subject"]')?.value).toBe('Assist subject');

    setNativeSubject('Edited in compose after draft');
    instruction.value = 'Make it shorter.';
    host.querySelector<HTMLButtonElement>('.ea-prompt-column .ea-primary-button')!.click();
    await Promise.resolve();
    await Promise.resolve();

    expect(sendMessage.mock.calls[1]?.[0].subject).toBe('Assist subject');

    host.querySelector<HTMLButtonElement>('.ea-review-actions .ea-primary-button')!.click();
    expect(insertSubject).toHaveBeenCalledWith(expect.any(HTMLElement), 'Assist subject');
  });

  it('hides the subject editor for a reply compose', () => {
    const { host } = installDom(vi.fn(), {
      composeKind: 'reply',
      initialDraft: 'Existing reply.',
      initialSubject: 'Thread subject',
    });
    host.querySelector<HTMLButtonElement>('.ea-trigger')!.click();

    expect(host.querySelector('.ea-subject-actions .ea-field')?.hasAttribute('hidden')).toBe(true);
  });

  it('keeps panel DOM stable when the current thread has not changed', () => {
    const currentThread: ContextItem = {
      id: 'outlook:current',
      kind: 'current-thread',
      provider: 'outlook',
      subject: 'Homework',
      participants: ['Ada'],
      messages: [{ sender: 'Ada', date: '', body: 'Please reply.' }],
      label: 'Homework',
    };
    const { host, panel } = installDom(vi.fn(), {
      composeKind: 'reply',
      getCurrentContext: () => ({ ...currentThread, messages: [...currentThread.messages] }),
    });
    host.querySelector<HTMLButtonElement>('.ea-trigger')!.click();

    const chip = host.querySelector('.ea-context-chip');
    const status = host.querySelector('.ea-status')!;
    status.textContent = 'Copied to clipboard.';
    panel.refresh();

    expect(host.querySelector('.ea-context-chip')).toBe(chip);
    expect(status.textContent).toBe('Copied to clipboard.');
  });
});

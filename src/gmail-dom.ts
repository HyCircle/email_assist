import type { AssistantAnchorRect, EmailMessage, ThreadContext } from './types';

function isVisible(element: Element): element is HTMLElement {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

function normalizeText(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\u200b/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function replaceEditorText(editor: HTMLElement, text: string): void {
  editor.focus();
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  selection?.removeAllRanges();
  selection?.addRange(range);

  const inserted = document.execCommand('insertText', false, text);

  if (!inserted) {
    editor.replaceChildren();
    const fragment = document.createDocumentFragment();
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      if (line) {
        fragment.append(document.createTextNode(line));
      }

      if (index < lines.length - 1) {
        fragment.append(document.createElement('br'));
      }
    });

    editor.append(fragment);
  }

  editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
}

function createInputEvent(documentRef: Document, text: string): Event {
  const inputEventConstructor = documentRef.defaultView?.InputEvent;

  if (inputEventConstructor) {
    return new inputEventConstructor('input', { bubbles: true, data: text, inputType: 'insertText' });
  }

  return new Event('input', { bubbles: true });
}

function dispatchInputValue(input: HTMLInputElement, text: string): void {
  const documentRef = input.ownerDocument ?? document;
  input.dispatchEvent(createInputEvent(documentRef, text));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function toAnchorRect(left: number, top: number, width: number, height: number): AssistantAnchorRect {
  return { left, top, width, height };
}

function findVisibleButton(root: ParentNode, matcher: (element: HTMLElement) => boolean): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('button, div[role="button"]')).find(
    (element) => isVisible(element) && matcher(element),
  ) ?? null;
}

function toEmailMessage(root: HTMLElement): EmailMessage | null {
  const sender = normalizeText(root.querySelector<HTMLElement>('.gD, [email]')?.textContent ?? '');
  const dateElement = root.querySelector<HTMLElement>('span.g3');
  const date = normalizeText(dateElement?.getAttribute('title') ?? dateElement?.textContent ?? '');
  const body = normalizeText(root.querySelector<HTMLElement>('.a3s')?.textContent ?? root.textContent ?? '');

  if (!body) {
    return null;
  }

  return {
    sender: sender || 'Unknown sender',
    date,
    body,
  };
}

export function findGmailComposeEditors(root: ParentNode = document): HTMLElement[] {
  const editors = root.querySelectorAll<HTMLElement>(
    'div[aria-label="Message Body"][contenteditable="true"], div[g_editable="true"][role="textbox"]',
  );

  return Array.from(editors).filter(isVisible);
}

export function getGmailComposeMount(editor: HTMLElement): HTMLElement {
  return editor.closest<HTMLElement>('div[role="dialog"], form, .M9, .aoI') ?? editor.parentElement ?? editor;
}

function getGmailSubjectInput(editor: HTMLElement): HTMLInputElement | null {
  const mount = getGmailComposeMount(editor);
  return mount.querySelector<HTMLInputElement>('input[name="subjectbox"], input[aria-label="Subject"]');
}

export function getGmailAssistantAnchor(
  editor: HTMLElement,
  triggerWidth: number,
  triggerHeight: number,
): AssistantAnchorRect | null {
  const mount = getGmailComposeMount(editor);
  const discardButton = findVisibleButton(
    mount,
    (element) => /^Discard draft/i.test(element.getAttribute('aria-label') ?? ''),
  );

  if (!discardButton) {
    return null;
  }

  const moreOptionsButton = findVisibleButton(
    mount,
    (element) => (element.getAttribute('aria-label') ?? '').trim() === 'More options',
  );

  const discardRect = discardButton.getBoundingClientRect();
  const moreOptionsRect = moreOptionsButton?.getBoundingClientRect();
  const gap = 8;
  const left = Math.max(
    moreOptionsRect ? moreOptionsRect.right + gap : Number.NEGATIVE_INFINITY,
    discardRect.left - triggerWidth - gap,
  );
  const top = discardRect.top + Math.max(0, (discardRect.height - triggerHeight) / 2);

  return toAnchorRect(left, top, triggerWidth, triggerHeight);
}

export function readPlainTextFromGmailEditor(editor: HTMLElement): string {
  return normalizeText(editor.innerText || editor.textContent || '');
}

export function readGmailSubject(editor: HTMLElement): string {
  return normalizeText(getGmailSubjectInput(editor)?.value ?? '');
}

export function insertPlainTextIntoGmail(editor: HTMLElement, text: string): void {
  replaceEditorText(editor, text);
}

export function insertGmailSubject(editor: HTMLElement, text: string): void {
  const subjectInput = getGmailSubjectInput(editor);
  if (!subjectInput) {
    return;
  }

  subjectInput.focus();
  subjectInput.value = text;
  dispatchInputValue(subjectInput, text);
}

export function extractGmailThreadContext(root: Document | HTMLElement = document): ThreadContext {
  const doc = root.ownerDocument ?? (root as Document);
  const messageRoots = Array.from(root.querySelectorAll<HTMLElement>('div.adn.ads, div[data-message-id]')).filter(isVisible);
  const messages: EmailMessage[] = [];
  const seenBodies = new Set<string>();

  for (const messageRoot of messageRoots) {
    const message = toEmailMessage(messageRoot);
    if (!message) {
      continue;
    }

    const bodyKey = message.body.slice(0, 240);
    if (seenBodies.has(bodyKey)) {
      continue;
    }

    seenBodies.add(bodyKey);
    messages.push(message);
  }

  const visibleHeadingSubject = normalizeText(
    doc.querySelector<HTMLElement>('main h2, h2.hP, h2[data-thread-perm-id]')?.textContent ?? '',
  );
  const subject = visibleHeadingSubject || (messages.length > 0 ? normalizeText(doc.title.replace(/\s+-\s+.*$/, '')) : '');

  const participants = Array.from(
    new Set(messages.map((message) => message.sender).filter((sender) => sender.length > 0)),
  );

  return {
    provider: 'gmail',
    subject,
    participants,
    messages: messages.slice(-8),
    sourceUrl: doc.location.href,
  };
}
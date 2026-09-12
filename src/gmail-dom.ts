import type { AssistantMount, ComposeKind, ContextItem, EmailMessage } from './types';

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

function createInputEvent(text: string): Event {
  return new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' });
}

function getGmailComposeRoot(editor: HTMLElement): HTMLElement {
  return editor.closest<HTMLElement>('[role="dialog"]') ?? editor.closest('table') ?? editor.parentElement ?? editor;
}

function findGmailSubjectInput(editor: HTMLElement): HTMLInputElement | null {
  return getGmailComposeRoot(editor).querySelector<HTMLInputElement>('input[name="subjectbox"], input[aria-label="Subject"]');
}

function createDraftBlock(documentRef: Document, text: string): HTMLDivElement {
  const block = documentRef.createElement('div');
  block.dataset.emailAssistDraft = 'true';
  const lines = text.split('\n');

  for (const [index, line] of lines.entries()) {
    if (line) {
      block.append(documentRef.createTextNode(line));
    }
    if (index < lines.length - 1) {
      block.append(documentRef.createElement('br'));
    }
  }

  return block;
}

function isPreservedReplyNode(node: ChildNode): boolean {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  return (
    node.dataset.emailAssistDraft !== 'true' &&
    (node.classList.contains('gmail_quote') ||
      node.classList.contains('gmail_signature') ||
      node.getAttribute('data-smartmail') === 'gmail_signature' ||
      node.tagName === 'BLOCKQUOTE')
  );
}

function toEmailMessage(root: HTMLElement): EmailMessage | null {
  const senderNode = root.querySelector<HTMLElement>('[email]');
  const sender = normalizeText(senderNode?.getAttribute('email') || senderNode?.textContent || '');
  const bodyNode = root.querySelector<HTMLElement>('.a3s');
  const body = normalizeText(bodyNode?.innerText || bodyNode?.textContent || '');
  if (!body) {
    return null;
  }

  return {
    sender: sender || 'Unknown sender',
    date: '',
    body,
  };
}

export function findGmailComposeEditors(root: ParentNode = document): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('div[aria-label="Message Body"][contenteditable="true"]'),
  ).filter(isVisible);
}

export function getGmailComposeKind(editor: HTMLElement): ComposeKind {
  return findGmailSubjectInput(editor) ? 'new' : 'reply';
}

export function getGmailComposeMountForAssistant(editor: HTMLElement): AssistantMount {
  const bodyCell = editor.closest('td');
  if (
    bodyCell instanceof HTMLElement &&
    !bodyCell.querySelector('[aria-label="Describe your message"], [aria-label^="Help me write"]')
  ) {
    return {
      kind: 'flow',
      host: bodyCell,
      before: bodyCell.firstElementChild instanceof HTMLElement ? bodyCell.firstElementChild : null,
    };
  }

  return { kind: 'popover', anchor: editor };
}

export function readPlainTextFromGmailEditor(editor: HTMLElement): string {
  const clone = editor.cloneNode(true) as HTMLElement;
  clone
    .querySelectorAll('.gmail_quote, .gmail_signature, [data-smartmail="gmail_signature"], blockquote')
    .forEach((node) => node.remove());
  const text = normalizeText(clone.innerText || clone.textContent || '');
  return /^Press \/ to write using your Gmail & Drive$/i.test(text) ? '' : text;
}

export function readGmailSubject(editor: HTMLElement): string {
  return normalizeText(findGmailSubjectInput(editor)?.value ?? '');
}

export function insertPlainTextIntoGmail(editor: HTMLElement, text: string): void {
  const documentRef = editor.ownerDocument;
  const preserved = Array.from(editor.childNodes).filter(isPreservedReplyNode);
  for (const child of Array.from(editor.childNodes)) {
    if (child instanceof HTMLElement && child.dataset.emailAssistDraft === 'true') {
      child.remove();
      continue;
    }

    if (!preserved.includes(child)) {
      child.remove();
    }
  }

  editor.insertBefore(createDraftBlock(documentRef, text), preserved[0] ?? null);
  editor.dispatchEvent(createInputEvent(text));
  editor.focus();
}

export function insertGmailSubject(editor: HTMLElement, text: string): void {
  const subjectInput = findGmailSubjectInput(editor);
  if (!subjectInput) {
    return;
  }

  subjectInput.focus();
  subjectInput.value = text;
  subjectInput.dispatchEvent(createInputEvent(text));
  subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
}

export function extractGmailCurrentContext(root: Document | HTMLElement = document): ContextItem | null {
  const doc = root.ownerDocument ?? (root as Document);
  const messageRoots = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).filter(isVisible);
  const messages: EmailMessage[] = [];
  const seenBodies = new Set<string>();

  for (const messageRoot of messageRoots) {
    const message = toEmailMessage(messageRoot);
    if (!message || seenBodies.has(message.body)) {
      continue;
    }

    seenBodies.add(message.body);
    messages.push(message);
  }

  if (messages.length === 0) {
    return null;
  }

  const subject = normalizeText(
    doc.querySelector<HTMLElement>('h2[data-thread-perm-id], main h2')?.textContent ?? '',
  );
  const participants = Array.from(new Set(messages.map((message) => message.sender).filter(Boolean)));

  return {
    id: 'gmail:current',
    kind: 'current-thread',
    provider: 'gmail',
    subject,
    participants,
    messages,
    label: subject || 'Current Gmail thread',
  };
}

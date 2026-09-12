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
    .replace(/\u200b|\u200c/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function createInputEvent(text: string): Event {
  return new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' });
}

function findOutlookComposeRoot(editor: HTMLElement): HTMLElement {
  return editor.closest<HTMLElement>('[data-app-section="MailReadCompose"]') ?? editor.parentElement ?? editor;
}

function findSubjectInput(editor: HTMLElement): HTMLInputElement | null {
  return findOutlookComposeRoot(editor).querySelector<HTMLInputElement>(
    'input[aria-label="Subject"], input[placeholder="Add a subject"]',
  );
}

function findDirectChildContaining(parent: HTMLElement, descendant: HTMLElement): HTMLElement | null {
  let current: HTMLElement = descendant;
  while (current.parentElement && current.parentElement !== parent) {
    current = current.parentElement;
  }

  return current.parentElement === parent ? current : null;
}

function extractHeaderValue(text: string, label: string): string {
  const pattern = new RegExp(`${label}:[ \\t]*([^\\r\\n]*?)(?=\\r?\\n|\\s+(?:From|Sent|To|Cc|Bcc|Subject):|$)`, 'i');
  return normalizeText(text.match(pattern)?.[1] ?? '');
}

function extractEmailAddresses(text: string): string[] {
  return Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []));
}

function removeHeaderBlock(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  let sawHeader = false;
  const bodyLines: string[] = [];

  for (const line of lines) {
    if (/^(From|Sent|To|Cc|Bcc|Subject):/i.test(line)) {
      sawHeader = true;
      continue;
    }

    if (sawHeader && !line) {
      continue;
    }

    if (sawHeader) {
      bodyLines.push(line);
    }
  }

  return bodyLines.length > 0 ? normalizeText(bodyLines.join('\n')) : normalizeText(text);
}

function readElementText(element: Element): string {
  return normalizeText((element as HTMLElement).innerText || element.textContent || '');
}

function readHeaderValue(root: HTMLElement, label: string): string {
  const ariaHeader = Array.from(root.querySelectorAll<HTMLElement>('[aria-label]'))
    .map((element) => element.getAttribute('aria-label') ?? '')
    .find((value) => new RegExp(`^${label}:`, 'i').test(value));

  return ariaHeader ? extractHeaderValue(ariaHeader, label) : '';
}

function findReadingPane(root: Document | HTMLElement): HTMLElement | null {
  if (root instanceof HTMLElement && root.matches('#ReadingPaneContainerId, main[aria-label="Reading Pane"]')) {
    return root;
  }

  return root.querySelector<HTMLElement>('#ReadingPaneContainerId, main[aria-label="Reading Pane"]');
}

function makeContext(subject: string, participants: string[], messages: EmailMessage[]): ContextItem {
  return {
    id: 'outlook:current',
    kind: 'current-thread',
    provider: 'outlook',
    subject,
    participants: Array.from(new Set(participants.filter(Boolean))),
    messages,
    label: subject || 'Current Outlook thread',
  };
}

function isQuotedReplyNode(node: ChildNode): boolean {
  if (!(node instanceof HTMLElement) || node.dataset.emailAssistDraft === 'true') {
    return false;
  }

  const text = normalizeText(node.innerText || node.textContent || '');
  return (
    node.id === 'divRplyFwdMsg' ||
    /^(from|sent|to|cc|bcc|subject):/i.test(text) ||
    /original message/i.test(text)
  );
}

function extractQuotedContext(editor: HTMLElement): ContextItem | null {
  const children = Array.from(editor.childNodes);
  const boundaryIndex = children.findIndex(isQuotedReplyNode);
  if (boundaryIndex < 0) {
    return null;
  }

  const quotedText = normalizeText(
    children
      .slice(boundaryIndex)
      .map((node) => normalizeText((node as HTMLElement).innerText || node.textContent || ''))
      .filter(Boolean)
      .join('\n\n'),
  );
  if (!quotedText) {
    return null;
  }

  const subject = extractHeaderValue(quotedText, 'Subject');
  const participants = ['From', 'To', 'Cc'].flatMap((label) => extractEmailAddresses(extractHeaderValue(quotedText, label)));
  const body = removeHeaderBlock(quotedText);
  if (!body) {
    return null;
  }

  return makeContext(subject, participants, [{
    sender: extractHeaderValue(quotedText, 'From') || extractEmailAddresses(quotedText)[0] || 'Outlook message',
    date: extractHeaderValue(quotedText, 'Sent'),
    body,
  }]);
}

function extractReadingPaneContext(root: Document | HTMLElement): ContextItem | null {
  const readingPane = findReadingPane(root);
  if (!readingPane) {
    return null;
  }

  const bodyNodes = Array.from(
    readingPane.querySelectorAll<HTMLElement>('[role="document"][aria-label*="Message body"]'),
  ).filter((node) => isVisible(node) && !node.isContentEditable);

  if (bodyNodes.length === 0) {
    return null;
  }

  const subjectNode = readingPane.querySelector<HTMLElement>('[id$="_SUBJECT"]:not(input)');
  const subject = subjectNode ? readElementText(subjectNode) : '';
  const messages: EmailMessage[] = [];
  const participants: string[] = [];

  for (const bodyNode of bodyNodes) {
    const messageRoot = bodyNode.closest<HTMLElement>('[aria-label="Email message"]') ?? bodyNode;
    const body = readElementText(bodyNode);
    if (!body) {
      continue;
    }

    const sender = readHeaderValue(messageRoot, 'From');
    const sent = readHeaderValue(messageRoot, 'Sent');
    const sentNode = messageRoot.querySelector<HTMLElement>('[data-testid="SentReceivedSavedTime"]');
    for (const label of ['From', 'To', 'Cc'] as const) {
      const headerValue = readHeaderValue(messageRoot, label);
      participants.push(...extractEmailAddresses(headerValue));
    }
    messages.push({
      sender: sender || 'Outlook message',
      date: sent || (sentNode ? readElementText(sentNode) : ''),
      body,
    });
  }

  if (messages.length === 0) {
    return null;
  }

  return makeContext(subject, participants, messages);
}

function createDraftBlock(documentRef: Document, text: string): HTMLDivElement {
  const block = documentRef.createElement('div');
  block.dataset.emailAssistDraft = 'true';

  for (const line of text.split('\n')) {
    const lineNode = documentRef.createElement('div');
    lineNode.className = 'elementToProof';
    if (line) {
      lineNode.textContent = line;
    } else {
      lineNode.append(documentRef.createElement('br'));
    }
    block.append(lineNode);
  }

  return block;
}

export function findOutlookComposeEditors(root: ParentNode = document): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('div[aria-label="Message body"][contenteditable="true"]'),
  ).filter(isVisible);
}

export function getOutlookComposeKind(editor: HTMLElement): ComposeKind {
  return Array.from(editor.childNodes).some(isQuotedReplyNode) ? 'reply' : 'new';
}

export function getOutlookComposeMountForAssistant(editor: HTMLElement): AssistantMount {
  const compose = findOutlookComposeRoot(editor);
  const docking = compose.querySelector<HTMLElement>('[id^="docking_InitVisiblePart_"]') ?? compose;
  const surface = findDirectChildContaining(docking, editor) ?? docking;
  const send = surface.querySelector<HTMLElement>('button[aria-label="Send"], [role="button"][aria-label="Send"]');
  if (!send) {
    return { kind: 'popover', anchor: editor };
  }

  const actionRow = findDirectChildContaining(surface, send);
  if (!actionRow || actionRow === surface) {
    return { kind: 'popover', anchor: editor };
  }

  return {
    kind: 'flow',
    host: surface,
    before: actionRow.nextElementSibling instanceof HTMLElement ? actionRow.nextElementSibling : null,
  };
}

export function readPlainTextFromOutlookEditor(editor: HTMLElement): string {
  const clone = editor.cloneNode(true) as HTMLElement;
  const boundary = Array.from(clone.childNodes).find((child) => isQuotedReplyNode(child)) ?? null;
  if (!boundary) {
    return normalizeText(clone.innerText || clone.textContent || '');
  }

  let remove = false;
  for (const child of Array.from(clone.childNodes)) {
    if (child === boundary) {
      remove = true;
    }
    if (remove) {
      child.remove();
    }
  }

  return normalizeText(clone.innerText || clone.textContent || '');
}

export function readOutlookSubject(editor: HTMLElement): string {
  return normalizeText(findSubjectInput(editor)?.value ?? '');
}

export function insertPlainTextIntoOutlook(editor: HTMLElement, text: string): void {
  const documentRef = editor.ownerDocument;
  const children = Array.from(editor.childNodes);
  const boundary = children.find((child) => isQuotedReplyNode(child)) ?? null;

  for (const child of children) {
    if (child === boundary) {
      break;
    }
    child.remove();
  }

  editor.insertBefore(createDraftBlock(documentRef, text), boundary);
  editor.dispatchEvent(createInputEvent(text));
  editor.focus();
}

export function insertOutlookSubject(editor: HTMLElement, text: string): void {
  const subjectInput = findSubjectInput(editor);
  if (!subjectInput) {
    return;
  }

  subjectInput.focus();
  subjectInput.value = text;
  subjectInput.dispatchEvent(createInputEvent(text));
  subjectInput.dispatchEvent(new Event('change', { bubbles: true }));
}

export function extractOutlookCurrentContext(
  root: Document | HTMLElement = document,
  editor?: HTMLElement,
): ContextItem | null {
  const composeEditor = editor ?? findOutlookComposeEditors(root)[0];
  return (composeEditor && extractQuotedContext(composeEditor)) || extractReadingPaneContext(root);
}

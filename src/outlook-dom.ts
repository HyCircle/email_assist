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

const STRUCTURAL_LINE_TAGS = new Set(['DIV', 'LI', 'P', 'PRE', 'TR']);

function readStructuredText(node: Node): string {
  if (node.nodeType === 3) {
    return node.nodeValue ?? '';
  }

  if (node instanceof HTMLElement && node.tagName === 'BR') {
    return '\n';
  }

  const children = Array.from(node.childNodes);
  const hasStructuralChild = children.some(
    (child) => child instanceof HTMLElement && STRUCTURAL_LINE_TAGS.has(child.tagName),
  );
  const content = children
    .filter((child) => !(hasStructuralChild && child.nodeType === 3 && !child.nodeValue?.trim()))
    .map(readStructuredText)
    .join('');
  return node instanceof HTMLElement && STRUCTURAL_LINE_TAGS.has(node.tagName)
    ? `${content}\n`
    : content;
}

function createInputEvent(text: string): Event {
  return new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' });
}

function findOutlookComposeRoot(editor: HTMLElement): HTMLElement {
  return editor.closest<HTMLElement>('[data-app-section="MailReadCompose"]') ?? editor.parentElement ?? editor;
}

function findSubjectInput(editor: HTMLElement): HTMLInputElement | null {
  return Array.from(
    findOutlookComposeRoot(editor).querySelectorAll<HTMLInputElement>(
      'input[aria-label="Subject"], input[placeholder="Add a subject"]',
    ),
  ).find((input) => !input.closest('[data-email-assist="true"]')) ?? null;
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

function readNodeText(node: Node): string {
  return normalizeText((node as HTMLElement).innerText || node.textContent || '');
}

function readHeaderValue(root: HTMLElement, label: string): string {
  const ariaHeader = Array.from(root.querySelectorAll<HTMLElement>('[aria-label]'))
    .map((element) => element.getAttribute('aria-label') ?? '')
    .find((value) => new RegExp(`^${label}:`, 'i').test(value));

  return ariaHeader ? extractHeaderValue(ariaHeader, label) : extractHeaderValue(readElementText(root), label);
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

function isQuotedReplyElement(node: Element): node is HTMLElement {
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

function isStrongQuotedReplyMarker(node: HTMLElement): boolean {
  const text = normalizeText(node.innerText || node.textContent || '');
  return node.id === 'divRplyFwdMsg' || /original message|wrote:/i.test(text);
}

function findQuotedReplyElement(editor: HTMLElement): HTMLElement | null {
  const inlineBlockquote = editor.querySelector<HTMLElement>('blockquote');
  if (inlineBlockquote) {
    return inlineBlockquote;
  }

  const nestedExplicit = editor.querySelector<HTMLElement>('#divRplyFwdMsg');
  if (nestedExplicit) {
    return nestedExplicit;
  }

  const directChildren = Array.from(editor.children);
  const direct = directChildren.find(
    (element, index) => isQuotedReplyElement(element) &&
      (isStrongQuotedReplyMarker(element) || index > 0),
  );
  if (direct) {
    return direct as HTMLElement;
  }

  const composeRoot = findOutlookComposeRoot(editor);
  const externalBlockquote = Array.from(composeRoot.querySelectorAll<HTMLElement>('blockquote'))
    .find((element) => !editor.contains(element));
  if (externalBlockquote) {
    return externalBlockquote;
  }

  const explicit = composeRoot.querySelector<HTMLElement>('#divRplyFwdMsg');
  if (explicit && !editor.contains(explicit)) {
    return explicit;
  }

  return null;
}

function collectQuoteFromMarker(marker: HTMLElement): string {
  const parent = marker.parentElement;
  if (!parent) {
    return readNodeText(marker);
  }

  const siblings = Array.from(parent.childNodes);
  return normalizeText(
    siblings
      .slice(siblings.indexOf(marker))
      .map((node) => readNodeText(node))
      .filter(Boolean)
      .join('\n\n'),
  );
}

function extractInlineSender(text: string): string {
  const match = text.match(/([^<>\n]+?)\s*<([^<>\n]+)>\s+wrote:/i);
  if (!match) {
    return '';
  }

  const displayName = normalizeText(match[1]).replace(/^On\s+.*?,\s+/i, '');
  return `${displayName} <${normalizeText(match[2])}>`;
}

function extractInlineSent(text: string): string {
  return normalizeText(text.match(/(?:^|\n)On\s+(.+?)\s+wrote:/i)?.[1] ?? '');
}

function replySubject(editor: HTMLElement): string {
  return normalizeText(findSubjectInput(editor)?.value ?? '').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '');
}

function extractQuotedContext(editor: HTMLElement): ContextItem | null {
  const boundary = findQuotedReplyElement(editor);
  if (!boundary) {
    return null;
  }

  const quotedText = collectQuoteFromMarker(boundary);
  if (!quotedText) {
    return null;
  }

  const subject = extractHeaderValue(quotedText, 'Subject') || replySubject(editor);
  const participants = ['From', 'To', 'Cc'].flatMap((label) => extractEmailAddresses(extractHeaderValue(quotedText, label)));
  const body = removeHeaderBlock(quotedText);
  if (!body) {
    return null;
  }

  return makeContext(subject, participants, [{
    sender: extractHeaderValue(quotedText, 'From') || extractInlineSender(quotedText) || extractEmailAddresses(quotedText)[0] || 'Outlook message',
    date: extractHeaderValue(quotedText, 'Sent') || extractInlineSent(quotedText),
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

  const conversation = readingPane.querySelector<HTMLElement>('#ConversationReadingPaneContainer') ?? readingPane;
  const subjectNode = conversation.querySelector<HTMLElement>('[id^="CONV_"][id$="_SUBJECT"], [id$="_SUBJECT"]:not(input)');
  const subject = subjectNode ? readElementText(subjectNode) : '';
  const messages: EmailMessage[] = [];
  const participants: string[] = [];

  for (const bodyNode of bodyNodes) {
    const messageRoot = bodyNode.closest<HTMLElement>('[aria-label="Email message"]') ?? bodyNode;
    const body = readElementText(bodyNode);
    if (!body) {
      continue;
    }

    const sender = readHeaderValue(messageRoot, 'From') || extractInlineSender(body);
    const sent = readHeaderValue(messageRoot, 'Sent') || extractInlineSent(body);
    const sentNode = messageRoot.querySelector<HTMLElement>('[data-testid="SentReceivedSavedTime"]');
    for (const label of ['From', 'To', 'Cc'] as const) {
      const headerValue = readHeaderValue(messageRoot, label) || (label === 'From' ? sender : '');
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
  return findQuotedReplyElement(editor) || !findSubjectInput(editor) ? 'reply' : 'new';
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
  const sourceHasInlineBlockquote = editor.querySelector('blockquote') !== null;
  const boundary = sourceHasInlineBlockquote
    ? clone.querySelector<HTMLElement>('blockquote')
    : findQuotedReplyElement(clone);

  if (sourceHasInlineBlockquote && boundary?.parentElement) {
    const siblings = Array.from(boundary.parentElement.childNodes);
    const boundaryIndex = siblings.indexOf(boundary);
    for (const node of siblings.slice(0, boundaryIndex)) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const text = readNodeText(node);
      const headerCount = (text.match(/(?:From|Sent|To|Cc|Bcc|Subject):/gi) ?? []).length;
      if (node.id === 'divRplyFwdMsg' || headerCount >= 2) {
        node.remove();
      }
    }
  }

  if (!boundary) {
    return normalizeText(readStructuredText(clone));
  }

  const parent = boundary.parentElement;
  const boundaryIndex = parent ? Array.from(parent.childNodes).indexOf(boundary) : -1;
  if (parent && boundaryIndex >= 0) {
    for (const child of Array.from(parent.childNodes).slice(boundaryIndex)) {
      child.remove();
    }
  }

  return normalizeText(readStructuredText(clone));
}

export function readOutlookSubject(editor: HTMLElement): string {
  return normalizeText(findSubjectInput(editor)?.value ?? '');
}

export function insertPlainTextIntoOutlook(editor: HTMLElement, text: string): void {
  const documentRef = editor.ownerDocument;
  const boundary = findQuotedReplyElement(editor);
  const inlineBoundary = boundary && editor.contains(boundary) ? boundary : null;

  if (!inlineBoundary) {
    editor.replaceChildren(createDraftBlock(documentRef, text));
  } else {
    editor.querySelectorAll<HTMLElement>('[data-email-assist-draft="true"]').forEach((draft) => draft.remove());
    const boundaryParent = inlineBoundary.parentElement;
    if (!boundaryParent) {
      editor.replaceChildren(createDraftBlock(documentRef, text));
    } else {
      const boundaryIndex = Array.from(boundaryParent.childNodes).indexOf(inlineBoundary);
      let topLevelBoundary: Node = inlineBoundary;
      while (topLevelBoundary.parentNode && topLevelBoundary.parentNode !== editor) {
        topLevelBoundary = topLevelBoundary.parentNode;
      }

      if (boundaryParent === editor) {
        for (const child of Array.from(editor.childNodes).slice(0, boundaryIndex)) {
          child.remove();
        }
      } else {
        for (const child of Array.from(editor.childNodes)) {
          if (child !== topLevelBoundary) {
            child.remove();
          }
        }
      }

      if (boundaryParent !== editor) {
        const nestedBoundaryIndex = Array.from(boundaryParent.childNodes).indexOf(inlineBoundary);
        for (const child of Array.from(boundaryParent.childNodes).slice(0, nestedBoundaryIndex)) {
          child.remove();
        }
      }
      boundaryParent.insertBefore(createDraftBlock(documentRef, text), inlineBoundary);
    }
  }

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
  const readingContext = extractReadingPaneContext(root);
  const quotedContext = composeEditor ? extractQuotedContext(composeEditor) : null;
  return readingContext || quotedContext;
}

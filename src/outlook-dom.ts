import { MAX_CONTEXT_MESSAGES } from './constants';
import type { AssistantMount, ComposeKind, ContextAttachment, ContextItem, EmailMessage } from './types';

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
  // Prefer the docking surface. Inline reply falsely marks the Reading Pane <main>
  // as MailReadCompose, so never treat <main> as the compose root.
  return editor.closest<HTMLElement>('[id^="docking_InitVisiblePart_"]')
    ?? editor.closest<HTMLElement>('[data-app-section="MailReadCompose"]:not(main)')
    ?? editor.parentElement
    ?? editor;
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

function readNodeText(node: Node): string {
  return normalizeText((node as HTMLElement).innerText || node.textContent || '');
}

function mediaTypeForName(name: string, fallback = 'application/octet-stream'): string {
  const extension = name.toLowerCase().split('.').pop();
  const types: Record<string, string> = {
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
  };
  return types[extension ?? ''] ?? fallback;
}

function isImageMediaType(mediaType: string): boolean {
  return mediaType.startsWith('image/');
}

function pushUniqueAttachment(attachments: ContextAttachment[], attachment: ContextAttachment): void {
  const key = `${attachment.kind}:${attachment.name}`;
  if (!attachments.some((item) => `${item.kind}:${item.name}` === key)) {
    attachments.push(attachment);
  }
}

function fileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function attachmentFromFile(file: File): ContextAttachment {
  const mediaType = file.type || mediaTypeForName(file.name);
  const kind = isImageMediaType(mediaType) ? 'image' : 'file';
  return {
    name: file.name,
    kind,
    mediaType,
    size: fileSize(file.size),
    ...(kind === 'image' ? { sourceUrl: URL.createObjectURL(file), temporary: true } : {}),
  };
}

function extractOutlookAttachments(root: HTMLElement): ContextAttachment[] {
  const attachments: ContextAttachment[] = [];
  const fileNodes = root.querySelectorAll<HTMLElement>('[aria-label="file attachments"] [role="option"]');
  for (const node of fileNodes) {
    const rawName = normalizeText(node.getAttribute('aria-label') || node.textContent || '');
    const size = rawName.match(/\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)\b/i)?.[0] || 'unknown';
    const name = normalizeText(rawName.replace(size, '').replace(/more actions?/gi, '')) || 'Outlook attachment';
    const mediaType = mediaTypeForName(name);
    const kind = isImageMediaType(mediaType) ? 'image' : 'file';
    const href = node.querySelector<HTMLAnchorElement>('a[href]')?.href;
    const imageSource = kind === 'image'
      ? node.querySelector<HTMLImageElement>('img[src]')?.currentSrc || node.querySelector<HTMLImageElement>('img[src]')?.src
      : undefined;
    const sourceUrl = kind === 'image' ? href || imageSource : undefined;
    pushUniqueAttachment(attachments, {
      name,
      kind,
      mediaType,
      size,
      ...(sourceUrl ? { sourceUrl } : {}),
    });
  }

  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="file"]')) {
    for (const file of Array.from(input.files ?? [])) {
      pushUniqueAttachment(attachments, attachmentFromFile(file));
    }
  }

  return attachments;
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

function isReplyHeaderId(id: string): boolean {
  return /RplyFwdMsg$/i.test(id);
}

function isReplyHeaderElement(node: Element | null | undefined): node is HTMLElement {
  return Boolean(node && node instanceof HTMLElement && isReplyHeaderId(node.id));
}

function findReplyHeaderElement(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>('[id$="RplyFwdMsg"]');
}

function isQuotedReplyElement(node: Element): node is HTMLElement {
  if (!(node instanceof HTMLElement) || node.dataset.emailAssistDraft === 'true') {
    return false;
  }

  if (isReplyHeaderId(node.id)) {
    return true;
  }

  const text = normalizeText(node.innerText || node.textContent || '');
  return /^(from|sent|to|cc|bcc|subject):/i.test(text) || /original message/i.test(text);
}

function isStrongQuotedReplyMarker(node: HTMLElement): boolean {
  if (isReplyHeaderId(node.id)) {
    return true;
  }

  const text = normalizeText(node.innerText || node.textContent || '');
  return /original message|wrote:/i.test(text);
}

function findQuotedReplyElement(editor: HTMLElement): HTMLElement | null {
  const nestedExplicit = findReplyHeaderElement(editor);
  if (nestedExplicit) {
    return nestedExplicit;
  }

  const inlineBlockquote = Array.from(editor.querySelectorAll<HTMLElement>('blockquote'))
    .find(isStrongQuotedReplyMarker);
  if (inlineBlockquote) {
    return inlineBlockquote;
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
  const externalHeader = findReplyHeaderElement(composeRoot);
  if (externalHeader && !editor.contains(externalHeader)) {
    return externalHeader;
  }

  const externalBlockquote = Array.from(composeRoot.querySelectorAll<HTMLElement>('blockquote'))
    .find((element) => !editor.contains(element) && isStrongQuotedReplyMarker(element));
  if (externalBlockquote) {
    return externalBlockquote;
  }

  return null;
}

function parseOnWroteLeadIn(text: string): { date: string; sender: string; body: string } | null {
  const match = text.match(/^On\s+([\s\S]+?)\s+wrote:\s*/i);
  if (!match) {
    return null;
  }

  const inner = normalizeText(match[1]);
  const withEmail = inner.match(/^(.+)<([^>]+)>\s*$/);
  if (!withEmail) {
    return null;
  }

  const beforeEmail = normalizeText(withEmail[1]);
  const email = normalizeText(withEmail[2]);
  const apple = beforeEmail.match(/^(.*,\s*at\s+[^,]+),\s*(.+)$/i);
  const date = apple ? normalizeText(apple[1]) : normalizeText(beforeEmail.slice(0, beforeEmail.lastIndexOf(',')));
  const name = apple
    ? normalizeText(apple[2])
    : normalizeText(beforeEmail.slice(beforeEmail.lastIndexOf(',') + 1));
  if (!date || !name) {
    return null;
  }

  return {
    date,
    sender: `${name} <${email}>`,
    body: normalizeText(text.slice(match[0].length)),
  };
}

function isAttachmentNamesOnly(body: string): boolean {
  return /^(?:<[^<>\n]+>\s*)+$/.test(body.trim());
}

function stripTrailingAttachmentNames(body: string): string {
  const lines = body.split('\n').map((line) => line.trimEnd());
  while (lines.length > 0) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (isAttachmentNamesOnly(last)) {
      lines.pop();
      continue;
    }
    break;
  }
  return normalizeText(lines.join('\n'));
}

function replySubject(editor: HTMLElement): string {
  return normalizeText(findSubjectInput(editor)?.value ?? '').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '');
}

function nodesToText(nodes: Node[]): string {
  return normalizeText(nodes.map((node) => readStructuredText(node)).join(''));
}

function messageFromSegmentText(text: string): EmailMessage | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  const onWrote = parseOnWroteLeadIn(normalized);
  let sender = extractHeaderValue(normalized, 'From');
  let date = extractHeaderValue(normalized, 'Sent');
  let body = normalized;

  if (onWrote) {
    sender = sender || onWrote.sender;
    date = date || onWrote.date;
    body = onWrote.body;
  } else if (/^(From|Sent|To|Cc|Bcc|Subject):/im.test(normalized)) {
    body = removeHeaderBlock(normalized);
  }

  body = stripTrailingAttachmentNames(body);
  if (!body || isAttachmentNamesOnly(body)) {
    return null;
  }

  return {
    sender: sender || extractEmailAddresses(normalized)[0] || 'Outlook message',
    date,
    body,
  };
}

function isHrBeforeReplyHeader(node: Node, nextElement: HTMLElement | null): boolean {
  return node instanceof HTMLElement && node.tagName === 'HR' && isReplyHeaderElement(nextElement);
}

function nextElementFrom(nodes: Node[], startIndex: number): HTMLElement | null {
  for (let index = startIndex; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (node instanceof HTMLElement) {
      return node;
    }
  }
  return null;
}

function peelQuoteNodes(nodes: Node[]): EmailMessage[] {
  const messages: EmailMessage[] = [];
  let current: Node[] = [];

  const flush = (): void => {
    const message = messageFromSegmentText(nodesToText(current));
    if (message) {
      messages.push(message);
    }
    current = [];
  };

  for (let index = 0; index < nodes.length; index += 1) {
    const child = nodes[index];
    if (child instanceof HTMLElement && child.tagName === 'BLOCKQUOTE') {
      flush();
      messages.push(...peelQuoteNodes(Array.from(child.childNodes)));
      continue;
    }

    const nextElement = nextElementFrom(nodes, index + 1);
    if (isHrBeforeReplyHeader(child, nextElement)) {
      flush();
      continue;
    }

    if (child instanceof HTMLElement && isReplyHeaderElement(child) && current.length > 0) {
      flush();
    }

    current.push(child);
  }

  flush();
  return messages;
}

function peelQuoteChainFromMarker(marker: HTMLElement): EmailMessage[] {
  if (marker.tagName === 'BLOCKQUOTE') {
    return peelQuoteNodes(Array.from(marker.childNodes));
  }

  const parent = marker.parentElement;
  if (!parent) {
    const alone = messageFromSegmentText(readNodeText(marker));
    return alone ? [alone] : [];
  }

  const siblings = Array.from(parent.childNodes);
  const startIndex = siblings.indexOf(marker);
  if (startIndex < 0) {
    return [];
  }

  return peelQuoteNodes(siblings.slice(startIndex));
}

function keepLatestMessages(messages: EmailMessage[]): EmailMessage[] {
  return messages.length > MAX_CONTEXT_MESSAGES
    ? messages.slice(messages.length - MAX_CONTEXT_MESSAGES)
    : messages;
}

function extractQuotedContext(editor: HTMLElement): ContextItem | null {
  const boundary = findQuotedReplyElement(editor);
  if (!boundary) {
    return null;
  }

  const peeled = peelQuoteChainFromMarker(boundary);
  if (peeled.length === 0) {
    return null;
  }

  const messages = keepLatestMessages(peeled.reverse());
  const headerText = isReplyHeaderElement(boundary)
    ? readNodeText(boundary)
    : nodesToText([boundary]);
  const subject = extractHeaderValue(headerText, 'Subject')
    || replySubject(editor);
  const participants = [
    ...messages.flatMap((message) => extractEmailAddresses(message.sender)),
    ...['From', 'To', 'Cc'].flatMap((label) => extractEmailAddresses(extractHeaderValue(headerText, label))),
  ];

  const attachments = extractOutlookAttachments(findOutlookComposeRoot(editor));
  const context = makeContext(subject, participants, messages);
  return attachments.length > 0 ? { ...context, attachments } : context;
}

const OUTLOOK_CARD_TIME = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{1,2}\/\d{1,2}\/\d{4}|\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}\s*[AP]M/i;

function findReadingPane(root: Document | HTMLElement): HTMLElement | null {
  if (root instanceof HTMLElement && root.matches('#ReadingPaneContainerId, main[aria-label="Reading Pane"]')) {
    return root;
  }

  return root.querySelector<HTMLElement>('#ReadingPaneContainerId, main[aria-label="Reading Pane"]');
}

function findConversationRoot(readingPane: HTMLElement): HTMLElement {
  return readingPane.querySelector<HTMLElement>('#ConversationReadingPaneContainer') ?? readingPane;
}

function findMessageRegion(conversation: HTMLElement): HTMLElement | null {
  return Array.from(conversation.querySelectorAll<HTMLElement>('[aria-label]'))
    .find((element) => /\d+\s+messages?/i.test(element.getAttribute('aria-label') || '')) ?? null;
}

function isDraftCardText(text: string): boolean {
  return /\[Draft\]|hasn.?t been sent/i.test(text);
}

function hasNonEditableMessageBody(card: HTMLElement): boolean {
  return Array.from(card.querySelectorAll<HTMLElement>('[role="document"][aria-label*="Message body"]'))
    .some((node) => !node.isContentEditable && elementText(node).length > 0);
}

function hasCardFromButton(card: HTMLElement): boolean {
  return Boolean(card.querySelector('button[aria-label^="From:"], [role="button"][aria-label^="From:"]'));
}

function isCardChromeLine(line: string, dateText = ''): boolean {
  return !line
    || line === dateText
    || OUTLOOK_CARD_TIME.test(line)
    || /^(?:To|Cc|Bcc):/i.test(line)
    || line === 'You'
    || line === '[Draft]'
    || /^[A-Z]{1,3}$/.test(line)
    || /^[\uE000-\uF8FF]+$/.test(line);
}

function meaningfulCardText(card: HTMLElement, dateText: string): string {
  return elementText(card)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => !isCardChromeLine(line, dateText))
    .join('\n');
}

function readCardSender(card: HTMLElement, lines: string[]): string {
  const fromButton = card.querySelector<HTMLElement>(
    'button[aria-label^="From:"], [role="button"][aria-label^="From:"]',
  );
  const fromAria = fromButton?.getAttribute('aria-label') || '';
  if (fromAria) {
    return normalizeText(fromAria.replace(/^From:\s*/i, ''));
  }

  const you = lines.find((line) => line === 'You' || /^You\b/.test(line));
  if (you) {
    return 'You';
  }

  return lines.find((line) => line && !isCardChromeLine(line)) || '';
}

function readCardBody(card: HTMLElement, lines: string[], sender: string, date: string): string {
  const bodyNode = Array.from(
    card.querySelectorAll<HTMLElement>('[role="document"][aria-label*="Message body"]'),
  ).find((node) => !node.isContentEditable);
  if (bodyNode) {
    return stripTrailingAttachmentNames(elementText(bodyNode));
  }

  return stripTrailingAttachmentNames(normalizeText(
    lines
      .filter((line) => {
        if (isCardChromeLine(line, date) || line === sender) {
          return false;
        }
        if (sender && (sender.includes(line) || line.includes(sender))) {
          return false;
        }
        return true;
      })
      .join('\n'),
  ));
}

function elementText(element: Element): string {
  return normalizeText((element as HTMLElement).innerText || element.textContent || '');
}

function countCardTimes(text: string): number {
  return (text.match(new RegExp(OUTLOOK_CARD_TIME.source, 'gi')) || []).length;
}

function findCardRoot(timeNode: HTMLElement, conversation: HTMLElement): HTMLElement {
  const dateText = elementText(timeNode);
  let withDoc: HTMLElement | null = null;
  let withBodyAndFrom: HTMLElement | null = null;
  let withBody: HTMLElement | null = null;
  let fallback: HTMLElement = timeNode;
  let current: HTMLElement | null = timeNode;

  for (let depth = 0; depth < 10 && current && conversation.contains(current); depth += 1) {
    const text = elementText(current);
    const timeHits = countCardTimes(text);
    if (timeHits > 1) {
      break;
    }
    if (timeHits === 1 && text.length > dateText.length + 10 && text.length < 8000) {
      fallback = current;
      if (!withDoc && hasNonEditableMessageBody(current)) {
        withDoc = current;
      }
      if (meaningfulCardText(current, dateText).length > 20) {
        withBody ??= current;
        if (!withBodyAndFrom && hasCardFromButton(current)) {
          withBodyAndFrom = current;
        }
      }
    }
    current = current.parentElement;
  }

  // Prefer full message body document; else smallest card that has both body and From;
  // else smallest body-only card (collapsed snippets).
  return withDoc ?? withBodyAndFrom ?? withBody ?? fallback;
}

function extractReadingPaneContext(root: Document | HTMLElement): ContextItem | null {
  const readingPane = findReadingPane(root);
  if (!readingPane) {
    return null;
  }

  const conversation = findConversationRoot(readingPane);
  const region = findMessageRegion(conversation) ?? conversation;
  const timeNodes = Array.from(
    region.querySelectorAll<HTMLElement>('h3, [role="heading"]'),
  ).filter((node) => {
    const text = elementText(node);
    return OUTLOOK_CARD_TIME.test(text) && !/^Saved:/i.test(text);
  });

  const messages: EmailMessage[] = [];
  const seen = new Set<string>();

  for (const timeNode of timeNodes) {
    const card = findCardRoot(timeNode, conversation);
    if (card.closest('[contenteditable="true"]')) {
      continue;
    }

    const text = elementText(card);
    if (!text || isDraftCardText(text)) {
      continue;
    }

    const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
    const date = elementText(timeNode);
    const sender = readCardSender(card, lines);
    const body = readCardBody(card, lines, sender, date);
    if (!body || isAttachmentNamesOnly(body)) {
      continue;
    }

    const key = `${sender}|${date}|${body.slice(0, 80)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    messages.push({
      sender: sender || 'Outlook message',
      date,
      body,
    });
  }

  if (messages.length === 0) {
    return null;
  }

  const kept = keepLatestMessages(messages);
  const subjectNode = conversation.querySelector<HTMLElement>('[id^="CONV_"][id$="_SUBJECT"], [id$="_SUBJECT"]:not(input)');
  const subject = subjectNode ? elementText(subjectNode) : '';
  const participants = kept.flatMap((message) => extractEmailAddresses(message.sender));
  const attachments = extractOutlookAttachments(readingPane);
  const context = makeContext(subject, participants, kept);
  return attachments.length > 0 ? { ...context, attachments } : context;
}

function isInlineReadingPaneReply(editor: HTMLElement): boolean {
  return Boolean(
    editor.closest('#ConversationReadingPaneContainer, #ReadingPaneContainerId, main[aria-label="Reading Pane"]'),
  );
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
  if (findQuotedReplyElement(editor) || isInlineReadingPaneReply(editor) || !findSubjectInput(editor)) {
    return 'reply';
  }

  return 'new';
}

export function getOutlookComposeMountForAssistant(editor: HTMLElement): AssistantMount {
  const compose = findOutlookComposeRoot(editor);
  const surface = findDirectChildContaining(compose, editor) ?? compose;
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
  const boundary = findQuotedReplyElement(clone);

  if (boundary?.parentElement) {
    const siblings = Array.from(boundary.parentElement.childNodes);
    const boundaryIndex = siblings.indexOf(boundary);
    for (const node of siblings.slice(0, boundaryIndex)) {
      if (!(node instanceof HTMLElement)) {
        continue;
      }

      const text = readNodeText(node);
      const headerCount = (text.match(/(?:From|Sent|To|Cc|Bcc|Subject):/gi) ?? []).length;
      if (isReplyHeaderId(node.id) || headerCount >= 2) {
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
    const previous = boundaryIndex > 0 ? parent.childNodes[boundaryIndex - 1] : null;
    if (previous instanceof HTMLElement && previous.tagName === 'HR') {
      previous.remove();
    }
    for (const child of Array.from(parent.childNodes).slice(
      Array.from(parent.childNodes).indexOf(boundary),
    )) {
      child.remove();
    }
  }

  return normalizeText(readStructuredText(clone));
}

export function readOutlookSubject(editor: HTMLElement): string {
  return normalizeText(findSubjectInput(editor)?.value ?? '');
}

export function extractOutlookComposeAttachments(editor: HTMLElement): ContextAttachment[] {
  return extractOutlookAttachments(findOutlookComposeRoot(editor));
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
  if (!composeEditor) {
    return extractReadingPaneContext(root);
  }

  return extractQuotedContext(composeEditor) || extractReadingPaneContext(root);
}

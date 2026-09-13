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
    .replace(/\u200b/g, '')
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

function parseGmailDownload(node: HTMLElement): { mediaType: string; name: string; sourceUrl?: string } | null {
  const download = node.getAttribute('download_url') || '';
  const parts = download.split(':');
  if (parts.length < 3) {
    return null;
  }

  let name = '';
  try {
    name = normalizeText(decodeURIComponent(parts[1] || ''));
  } catch {
    name = normalizeText(parts[1] || '');
  }
  if (!name) {
    return null;
  }

  const sourceUrl = parts.slice(2).join(':');
  return {
    mediaType: parts[0] || '',
    name,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
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

function extractGmailAttachments(root: HTMLElement): ContextAttachment[] {
  const attachments: ContextAttachment[] = [];
  const fileNodes = root.querySelectorAll<HTMLElement>('[download_url], .aZo');
  for (const node of fileNodes) {
    if (node.closest('[data-email-assist="true"]')) {
      continue;
    }
    if (!node.hasAttribute('download_url') && node.querySelector('[download_url]')) {
      continue;
    }

    const parsed = parseGmailDownload(node);
    const rawText = normalizeText(node.textContent || node.getAttribute('aria-label') || '');
    const size = rawText.match(/\b\d+(?:\.\d+)?\s*(?:B|KB|MB|GB)\b/i)?.[0] || 'unknown';
    const name = parsed?.name || normalizeText(rawText.replace(size, '').replace(/download|add to drive|edit with/gi, '')) || 'Gmail attachment';
    const mediaType = parsed?.mediaType || mediaTypeForName(name);
    const kind = isImageMediaType(mediaType) ? 'image' : 'file';
    const imageSource = kind === 'image'
      ? parsed?.sourceUrl || node.querySelector<HTMLImageElement>('img[src]')?.currentSrc || node.querySelector<HTMLImageElement>('img[src]')?.src
      : undefined;
    const href = node.querySelector<HTMLAnchorElement>('a[href]')?.href;
    const sourceUrl = kind === 'image' ? imageSource || href : undefined;
    pushUniqueAttachment(attachments, {
      name,
      kind,
      mediaType: mediaType || mediaTypeForName(name),
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
  const text = normalizeText(readStructuredText(clone));
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

export function extractGmailComposeAttachments(editor: HTMLElement): ContextAttachment[] {
  return extractGmailAttachments(getGmailComposeRoot(editor));
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
  const attachments = messageRoots.flatMap(extractGmailAttachments);

  return {
    id: 'gmail:current',
    kind: 'current-thread',
    provider: 'gmail',
    subject,
    participants,
    messages,
    label: subject || 'Current Gmail thread',
    attachments: attachments.length > 0 ? attachments : undefined,
  };
}

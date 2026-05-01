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
    .replace(/\u200c/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function toAnchorRect(left: number, top: number, width: number, height: number): AssistantAnchorRect {
  return { left, top, width, height };
}

function findVisibleButton(root: ParentNode, matcher: (element: HTMLElement) => boolean): HTMLElement | null {
  return Array.from(root.querySelectorAll<HTMLElement>('button, div[role="button"]')).find(
    (element) => isVisible(element) && matcher(element),
  ) ?? null;
}

function extractHeaderValue(text: string, label: string): string {
  const pattern = new RegExp(`${label}:\\s*(.+?)(?=(?:From|Sent|To|Cc|Bcc|Subject):|$)`, 'i');
  const match = text.match(pattern);
  return normalizeText(match?.[1] ?? '');
}

function extractEmailAddresses(text: string): string[] {
  return Array.from(new Set(text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []));
}

function findMeaningfulHeading(root: ParentNode): HTMLElement | null {
  const headings = Array.from(root.querySelectorAll<HTMLElement>('h1, h2, h3')).filter(isVisible);

  return headings
    .map((heading) => ({ heading, text: normalizeText(heading.textContent ?? '') }))
    .filter(({ text }) => text.length > 6 && !/navigation pane/i.test(text))
    .at(-1)?.heading ?? null;
}

function findReadingPaneRoots(root: ParentNode): HTMLElement[] {
  const scoredCandidates = Array.from(root.querySelectorAll<HTMLElement>('article, section, div, td'))
    .filter((element) => isVisible(element) && !element.isContentEditable)
    .map((element) => {
      const text = normalizeText(element.textContent ?? '');
      if (text.length < 80) {
        return null;
      }

      let score = 0;
      if (/From:\s*/i.test(text)) {
        score += 4;
      }
      if (/Subject:\s*/i.test(text)) {
        score += 4;
      }
      if (/To:\s*/i.test(text)) {
        score += 2;
      }
      if (/Sent:\s*/i.test(text)) {
        score += 2;
      }
      if (element.querySelector('h1, h2, h3')) {
        score += 1;
      }
      if (element.querySelector('[role="document"][aria-label*="Message body"]')) {
        score += 2;
      }
      if (element.querySelector('[aria-label="Message body"][contenteditable="true"]')) {
        score -= 2;
      }

      return score >= 6
        ? {
            element,
            score,
            area: element.getBoundingClientRect().width * element.getBoundingClientRect().height,
          }
        : null;
    })
    .filter((candidate): candidate is { element: HTMLElement; score: number; area: number } => Boolean(candidate))
    .sort((left, right) => right.score - left.score || left.area - right.area);

  const selected: HTMLElement[] = [];

  for (const candidate of scoredCandidates) {
    if (selected.some((element) => element.contains(candidate.element))) {
      continue;
    }

    selected.push(candidate.element);
  }

  return selected.slice(0, 8);
}

function extractMessageBody(root: HTMLElement): string {
  const bodyNode = Array.from(
    root.querySelectorAll<HTMLElement>('div[aria-label="Message body"][role="document"], [role="document"][aria-label*="Message body"]'),
  ).find((node) => isVisible(node) && node.getAttribute('contenteditable') !== 'true');

  if (bodyNode) {
    return normalizeText(bodyNode.textContent ?? '');
  }

  const heading = findMeaningfulHeading(root);
  const bodyContainer = heading?.closest<HTMLElement>('td, article, section, div') ?? root;
  return normalizeText(bodyContainer.textContent ?? '');
}

function createFormattedLines(documentRef: Document, text: string): DocumentFragment {
  const fragment = documentRef.createDocumentFragment();
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    const lineNode = documentRef.createElement('div');
    lineNode.className = 'elementToProof';

    if (line) {
      lineNode.textContent = line;
    } else {
      lineNode.append(documentRef.createElement('br'));
    }

    fragment.append(lineNode);

    if (index === lines.length - 1) {
      return;
    }
  });

  return fragment;
}

function createInputEvent(documentRef: Document, text: string): Event {
  const inputEventConstructor = documentRef.defaultView?.InputEvent;

  if (inputEventConstructor) {
    return new inputEventConstructor('input', { bubbles: true, data: text, inputType: 'insertText' });
  }

  return new Event('input', { bubbles: true });
}

function dispatchInputValue(input: HTMLInputElement, text: string): void {
  input.dispatchEvent(createInputEvent(input.ownerDocument ?? document, text));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function isEmptyComposerNode(node: ChildNode): boolean {
  if (!(node instanceof HTMLElement)) {
    return !normalizeText(node.textContent ?? '');
  }

  if (node.dataset.emailAssistDraft === 'true') {
    return false;
  }

  if (/VirtualEdit_Placeholder/i.test(node.className) || !normalizeText(node.textContent ?? '')) {
    return true;
  }

  return false;
}

function isQuotedReplyNode(node: ChildNode): boolean {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  if (node.dataset.emailAssistDraft === 'true') {
    return false;
  }

  const text = normalizeText(node.textContent ?? '');
  return (
    /^(from|sent|to|cc|bcc|subject):/i.test(text) ||
    /original message/i.test(text) ||
    node.getAttribute('contenteditable') === 'false' ||
    Boolean(node.querySelector('[role="document"][aria-label*="Message body"]'))
  );
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

function collectParticipantNames(root: ParentNode): string[] {
  const candidates = root.querySelectorAll<HTMLElement>('[title], [aria-label]');
  const names = Array.from(candidates)
    .map((element) => normalizeText(element.getAttribute('title') ?? element.getAttribute('aria-label') ?? ''))
    .filter((value) => /@|from|to/i.test(value) || value.split(' ').length <= 4)
    .slice(0, 16);

  return Array.from(new Set(names));
}

export function findOutlookComposeEditors(root: ParentNode = document): HTMLElement[] {
  const editors = root.querySelectorAll<HTMLElement>(
    'div[aria-label="Message body"][contenteditable="true"], div[aria-label="Message body"][role="textbox"]',
  );

  return Array.from(editors).filter(isVisible);
}

export function getOutlookComposeMount(editor: HTMLElement): HTMLElement {
  return editor.closest<HTMLElement>('[role="dialog"], [data-app-section], section') ?? editor.parentElement ?? editor;
}

function getOutlookSubjectInput(editor: HTMLElement): HTMLInputElement | null {
  const mount = getOutlookComposeMount(editor);
  return mount.querySelector<HTMLInputElement>('input[aria-label="Subject"], input[placeholder="Add a subject"]');
}

export function getOutlookAssistantAnchor(
  editor: HTMLElement,
  triggerWidth: number,
  triggerHeight: number,
): AssistantAnchorRect | null {
  const mount = getOutlookComposeMount(editor);
  const discardButton = findVisibleButton(mount, (element) => /^Discard/i.test(element.getAttribute('aria-label') ?? ''));

  if (!discardButton) {
    return null;
  }

  const discardRect = discardButton.getBoundingClientRect();
  const gap = 8;
  const left = discardRect.left - triggerWidth - gap;
  const top = discardRect.top + Math.max(0, (discardRect.height - triggerHeight) / 2);

  return toAnchorRect(left, top, triggerWidth, triggerHeight);
}

export function readPlainTextFromOutlookEditor(editor: HTMLElement): string {
  return normalizeText(editor.innerText || editor.textContent || '');
}

export function readOutlookSubject(editor: HTMLElement): string {
  return normalizeText(getOutlookSubjectInput(editor)?.value ?? '');
}

export function insertPlainTextIntoOutlook(editor: HTMLElement, text: string): void {
  const documentRef = editor.ownerDocument ?? document;
  const existingChildren = Array.from(editor.childNodes);
  let boundaryNode: ChildNode | null = null;

  for (const child of existingChildren) {
    if (isQuotedReplyNode(child)) {
      boundaryNode = child;
      break;
    }
  }

  for (const child of existingChildren) {
    if (child === boundaryNode) {
      break;
    }

    if (child instanceof HTMLElement && child.dataset.emailAssistDraft === 'true') {
      child.remove();
      continue;
    }

    if (isEmptyComposerNode(child) || !boundaryNode) {
      child.remove();
      continue;
    }

    child.remove();
  }

  const draftBlock = documentRef.createElement('div');
  draftBlock.dataset.emailAssistDraft = 'true';
  draftBlock.append(createFormattedLines(documentRef, text));

  editor.insertBefore(draftBlock, boundaryNode);
  editor.dispatchEvent(createInputEvent(documentRef, text));
  editor.focus();
}

export function insertOutlookSubject(editor: HTMLElement, text: string): void {
  const subjectInput = getOutlookSubjectInput(editor);
  if (!subjectInput) {
    return;
  }

  subjectInput.focus();
  subjectInput.value = text;
  dispatchInputValue(subjectInput, text);
}

export function extractOutlookThreadContext(root: Document | HTMLElement = document): ThreadContext {
  const doc = root.ownerDocument ?? (root as Document);
  const readingPaneRoots = findReadingPaneRoots(root);

  const messages = readingPaneRoots
    .map<EmailMessage | null>((messageRoot) => {
      const headerText = normalizeText(messageRoot.textContent ?? '');
      const sender =
        extractHeaderValue(headerText, 'From') ||
        extractEmailAddresses(headerText)[0] ||
        collectParticipantNames(messageRoot)[0] ||
        '';
      const date = extractHeaderValue(headerText, 'Sent');
      const body = extractMessageBody(messageRoot);
      if (!body) {
        return null;
      }

      return {
        sender: sender || 'Outlook message',
        date,
        body,
      };
    })
    .filter((message): message is EmailMessage => Boolean(message))
    .slice(-8);

  const participantSet = new Set<string>();
  for (const messageRoot of readingPaneRoots) {
    const headerText = normalizeText(messageRoot.textContent ?? '');
    const sender = extractHeaderValue(headerText, 'From');
    const toValue = extractHeaderValue(headerText, 'To');
    const ccValue = extractHeaderValue(headerText, 'Cc');

    for (const value of [sender, toValue, ccValue]) {
      for (const email of extractEmailAddresses(value)) {
        participantSet.add(email);
      }
    }
  }

  if (participantSet.size === 0) {
    for (const message of messages) {
      for (const email of extractEmailAddresses(message.sender)) {
        participantSet.add(email);
      }
    }

    const fallbackText = root.nodeType === 9 ? (root as Document).body?.textContent ?? '' : root.textContent ?? '';
    for (const email of extractEmailAddresses(normalizeText(fallbackText))) {
      participantSet.add(email);
    }
  }

  const participants =
    participantSet.size > 0
      ? Array.from(participantSet)
      : collectParticipantNames(root).filter((value) => !/^message body$/i.test(value));
  const subjectRoot = readingPaneRoots[0];
  const subjectFromHeaders = subjectRoot ? extractHeaderValue(normalizeText(subjectRoot.textContent ?? ''), 'Subject') : '';
  const subjectFromHeading = subjectRoot ? normalizeText(findMeaningfulHeading(subjectRoot)?.textContent ?? '') : '';
  const subjectFromTitle = normalizeText(doc.title.replace(/^Mail\s+-\s+/, '').replace(/\s+-\s+Outlook$/, ''));

  const subject = normalizeText(subjectFromHeading || subjectFromHeaders || (messages.length > 0 ? subjectFromTitle : ''));

  return {
    provider: 'outlook',
    subject,
    participants,
    messages,
    sourceUrl: doc.location.href,
  };
}
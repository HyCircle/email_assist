import './panel.css';

import {
  extractGmailCurrentContext,
  findGmailComposeEditors,
  getGmailComposeKind,
  getGmailComposeMountForAssistant,
  insertGmailSubject,
  insertPlainTextIntoGmail,
  readGmailSubject,
  readPlainTextFromGmailEditor,
} from './gmail-dom';
import { attachAssistantPanel } from './panel';

const instances = new Map<HTMLElement, ReturnType<typeof attachAssistantPanel>>();
let scanTimer: number | undefined;

function scanComposeSurfaces(): void {
  for (const [editor, instance] of instances) {
    if (!editor.isConnected) {
      instance.cleanup();
      instances.delete(editor);
    }
  }

  for (const editor of findGmailComposeEditors()) {
    const existing = instances.get(editor);
    if (existing) {
      continue;
    }

    instances.set(
      editor,
      attachAssistantPanel({
        provider: 'gmail',
        editor,
        composeKind: getGmailComposeKind(editor),
        getAssistantMount: getGmailComposeMountForAssistant,
        getCurrentContext: () => extractGmailCurrentContext(document),
        readDraft: readPlainTextFromGmailEditor,
        readSubject: readGmailSubject,
        insertDraft: insertPlainTextIntoGmail,
        insertSubject: insertGmailSubject,
      }),
    );
  }
}

function scheduleScan(): void {
  if (scanTimer !== undefined) {
    window.clearTimeout(scanTimer);
  }
  scanTimer = window.setTimeout(() => {
    scanTimer = undefined;
    scanComposeSurfaces();
  }, 180);
}

function isAssistantNode(node: Node): boolean {
  return node instanceof Element && (node.matches('[data-email-assist]') || Boolean(node.closest('[data-email-assist]')));
}

function isComposeRelatedNode(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  const composeSelector = 'div[aria-label="Message Body"][contenteditable="true"], [aria-label="Describe your message"], [aria-label^="Help me write"]';
  return node.matches(composeSelector) || Boolean(node.closest(composeSelector)) ||
    (node.matches('[role="dialog"]') && Boolean(node.querySelector(composeSelector)));
}

const observer = new MutationObserver((records) => {
  const providerChanged = records.some((record) => {
    if (isAssistantNode(record.target)) {
      return false;
    }

    return isComposeRelatedNode(record.target)
      || Array.from(record.addedNodes).some(isComposeRelatedNode)
      || Array.from(record.removedNodes).some(isComposeRelatedNode);
  });
  if (providerChanged) scheduleScan();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleScan);
window.addEventListener('popstate', scheduleScan);
scanComposeSurfaces();

import './panel.css';

import {
  extractOutlookCurrentContext,
  findOutlookComposeEditors,
  getOutlookComposeKind,
  getOutlookComposeMountForAssistant,
  insertOutlookSubject,
  insertPlainTextIntoOutlook,
  readOutlookSubject,
  readPlainTextFromOutlookEditor,
} from './outlook-dom';
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

  for (const editor of findOutlookComposeEditors()) {
    const existing = instances.get(editor);
    if (existing) {
      continue;
    }

    instances.set(
      editor,
      attachAssistantPanel({
        provider: 'outlook',
        editor,
        composeKind: getOutlookComposeKind(editor),
        getAssistantMount: getOutlookComposeMountForAssistant,
        getCurrentContext: () => extractOutlookCurrentContext(document, editor),
        readDraft: readPlainTextFromOutlookEditor,
        readSubject: readOutlookSubject,
        insertDraft: insertPlainTextIntoOutlook,
        insertSubject: insertOutlookSubject,
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

  const composeSelector = 'div[aria-label="Message body"][contenteditable="true"], [id^="docking_InitVisiblePart_"], button[aria-label="Send"], button[aria-label="Discard"]';
  return node.matches(composeSelector) || Boolean(node.closest(composeSelector)) ||
    (node.matches('[data-app-section="MailReadCompose"]') && Boolean(node.querySelector(composeSelector)));
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

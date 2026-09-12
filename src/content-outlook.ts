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
import type { ComposeKind } from './types';

type PanelInstance = { composeKind: ComposeKind; instance: ReturnType<typeof attachAssistantPanel> };
const instances = new Map<HTMLElement, PanelInstance>();
let scanTimer: number | undefined;

function scanComposeSurfaces(): void {
  const editors = findOutlookComposeEditors();
  const visibleEditors = new Set(editors);
  for (const [editor, instance] of instances) {
    if (!editor.isConnected || !visibleEditors.has(editor)) {
      instance.instance.cleanup();
      instances.delete(editor);
    }
  }

  for (const editor of editors) {
    const composeKind = getOutlookComposeKind(editor);
    const existing = instances.get(editor);
    if (existing) {
      if (existing.composeKind !== composeKind) {
        existing.composeKind = composeKind;
        existing.instance.setComposeKind(composeKind);
      }
      continue;
    }

    instances.set(
      editor,
      {
        composeKind,
        instance: attachAssistantPanel({
          provider: 'outlook',
          editor,
          composeKind,
          getAssistantMount: getOutlookComposeMountForAssistant,
          getCurrentContext: () => extractOutlookCurrentContext(document, editor),
          readDraft: readPlainTextFromOutlookEditor,
          readSubject: readOutlookSubject,
          insertDraft: insertPlainTextIntoOutlook,
          insertSubject: insertOutlookSubject,
        }),
      },
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

function isComposeSurfaceInsertion(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  const composeSignalSelector = 'div[aria-label="Message body"][contenteditable="true"], input[aria-label="Subject"], input[placeholder="Add a subject"], #divRplyFwdMsg, blockquote';
  return node.matches(composeSignalSelector) || Boolean(node.querySelector(composeSignalSelector));
}

const observer = new MutationObserver((records) => {
  const providerChanged = records.some((record) => {
    if (isAssistantNode(record.target)) {
      return false;
    }

    return record.type === 'childList' &&
      [...record.addedNodes, ...record.removedNodes].some(isComposeSurfaceInsertion);
  });
  if (providerChanged) scheduleScan();
});
observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleScan);
window.addEventListener('popstate', scheduleScan);
scanComposeSurfaces();

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
import type { ComposeKind } from './types';

type PanelInstance = { composeKind: ComposeKind; instance: ReturnType<typeof attachAssistantPanel> };
const instances = new Map<HTMLElement, PanelInstance>();
let scanTimer: number | undefined;

function scanComposeSurfaces(): void {
  const editors = findGmailComposeEditors();
  const visibleEditors = new Set(editors);
  for (const [editor, instance] of instances) {
    if (!editor.isConnected || !visibleEditors.has(editor)) {
      instance.instance.cleanup();
      instances.delete(editor);
    }
  }

  for (const editor of editors) {
    const composeKind = getGmailComposeKind(editor);
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
          provider: 'gmail',
          editor,
          composeKind,
          getAssistantMount: getGmailComposeMountForAssistant,
          getCurrentContext: () => extractGmailCurrentContext(document),
          readDraft: readPlainTextFromGmailEditor,
          readSubject: readGmailSubject,
          insertDraft: insertPlainTextIntoGmail,
          insertSubject: insertGmailSubject,
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

  const composeSignalSelector = 'div[aria-label="Message Body"][contenteditable="true"], input[name="subjectbox"], input[aria-label="Subject"]';
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

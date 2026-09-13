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

type PanelInstance = {
  composeKind: ComposeKind;
  surface: HTMLElement;
  instance: ReturnType<typeof attachAssistantPanel>;
};
type ScanCandidate = {
  editor: HTMLElement;
  composeKind: ComposeKind;
  surface: HTMLElement;
};

type OutlookContentController = { dispose: () => void };
type OutlookWindow = Window & { __emailAssistOutlookController__?: OutlookContentController };

const instances = new Map<HTMLElement, PanelInstance>();
let scanTimer: number | undefined;

function getAssistantSurface(editor: HTMLElement): HTMLElement {
  const mount = getOutlookComposeMountForAssistant(editor);
  return mount.kind === 'flow' ? mount.host : editor;
}

function scanComposeSurfaces(): void {
  const editors = findOutlookComposeEditors();
  const candidates = new Map<HTMLElement, ScanCandidate>();

  for (const editor of editors) {
    const surface = getAssistantSurface(editor);
    if (!candidates.has(surface)) {
      candidates.set(surface, { editor, composeKind: getOutlookComposeKind(editor), surface });
    }
  }

  const activeEditors = new Set(Array.from(candidates.values(), (candidate) => candidate.editor));
  for (const [editor, instance] of instances) {
    if (!editor.isConnected || !activeEditors.has(editor)) {
      instance.instance.cleanup();
      instances.delete(editor);
    }
  }

  for (const candidate of candidates.values()) {
    const { editor, composeKind, surface } = candidate;
    const existing = instances.get(editor);
    if (existing) {
      if (existing.surface !== surface) {
        existing.instance.cleanup();
        instances.delete(editor);
      } else if (existing.composeKind !== composeKind) {
        existing.composeKind = composeKind;
        existing.instance.setComposeKind(composeKind);
      } else {
        existing.instance.refresh();
      }
      continue;
    }

    instances.set(
      editor,
      {
        composeKind,
        surface,
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

function isAssistantMutation(record: MutationRecord): boolean {
  return isAssistantNode(record.target) ||
    [...record.addedNodes, ...record.removedNodes].some(isAssistantNode);
}

function isComposeSurfaceInsertion(node: Node): boolean {
  if (!(node instanceof Element)) {
    return false;
  }

  const composeSignalSelector = 'div[aria-label="Message body"][contenteditable="true"], input[aria-label="Subject"], input[placeholder="Add a subject"], #divRplyFwdMsg, blockquote, #ReadingPaneContainerId, #ConversationReadingPaneContainer';
  return node.matches(composeSignalSelector) || Boolean(node.querySelector(composeSignalSelector));
}

const observer = new MutationObserver((records) => {
  const providerChanged = records.some((record) => {
    if (isAssistantMutation(record)) {
      return false;
    }

    return record.type === 'childList' &&
      [...record.addedNodes, ...record.removedNodes].some(isComposeSurfaceInsertion);
  });
  if (providerChanged) scheduleScan();
});

function dispose(): void {
  if (scanTimer !== undefined) {
    window.clearTimeout(scanTimer);
    scanTimer = undefined;
  }
  observer.disconnect();
  window.removeEventListener('hashchange', scheduleScan);
  window.removeEventListener('popstate', scheduleScan);
  for (const instance of instances.values()) {
    instance.instance.cleanup();
  }
  instances.clear();
}

const controllerWindow = window as OutlookWindow;
controllerWindow.__emailAssistOutlookController__?.dispose();
controllerWindow.__emailAssistOutlookController__ = { dispose };

observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', scheduleScan);
window.addEventListener('popstate', scheduleScan);
scanComposeSurfaces();

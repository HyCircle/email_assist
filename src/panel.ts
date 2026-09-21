import {
  EXTENSION_NAME,
  MAX_CONTEXT_ITEM_CHARS,
  MAX_CONTEXT_ITEMS,
  MAX_DRAFT_CHARS,
  MAX_INSTRUCTION_CHARS,
} from './constants';
import {
  createDraftSession,
  failDraftRequest,
  finishDraftRequest,
  getPrimaryActionLabel,
  setSessionContexts,
  setSessionDraft,
  startDraftRequest,
  startOver,
} from './draft-session';
import { getSettings } from './storage';
import type {
  AssistantMount,
  ComposeKind,
  ContextAttachment,
  ContextItem,
  DraftRequest,
  DraftResponse,
  DraftSession,
  OpenSettingsResponse,
  ProviderName,
} from './types';

export type PanelBindings = {
  provider: ProviderName;
  editor: HTMLElement;
  composeKind: ComposeKind;
  getAssistantMount: (editor: HTMLElement) => AssistantMount;
  getCurrentContext: () => ContextItem | null;
  getWriter?: () => string;
  readDraft: (editor: HTMLElement) => string;
  readSubject: (editor: HTMLElement) => string;
  getComposeAttachments?: (editor: HTMLElement) => ContextAttachment[];
  prepareAttachments?: (attachments: ContextAttachment[]) => Promise<ContextAttachment[]>;
  insertDraft: (editor: HTMLElement, text: string) => void;
  insertSubject: (editor: HTMLElement, text: string) => void;
};

type PresetSettings = {
  draftPresets: string[];
  improvePresets: string[];
};

type DraftHistoryEntry = {
  version: number;
  draft: string;
  subject: string;
};

const DEFAULT_PANEL_EDITOR_HEIGHT = 160;
const MIN_PANEL_EDITOR_HEIGHT = 120;
const MAX_PANEL_EDITOR_HEIGHT = 520;

function makeId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function contextDisplayLabel(context: ContextItem): string {
  return context.label || (context.kind === 'current-thread' ? 'Current thread' : 'Reference email');
}

function createPastedContext(provider: ProviderName, label: string, text: string): ContextItem {
  return {
    id: makeId('pasted'),
    kind: 'pasted',
    provider,
    subject: label,
    participants: [],
    messages: [{ sender: 'User-provided reference', date: '', body: text }],
    label,
  };
}

function field(labelText: string, control: HTMLElement): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'ea-field';
  const caption = document.createElement('span');
  caption.textContent = labelText;
  label.append(caption, control);
  return label;
}

function copyIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '1.8');
  path.setAttribute('d', 'M8 8V4h12v12h-4M4 8h12v12H4V8Z');
  svg.append(path);
  return svg;
}

function plusIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('d', 'M12 5v14M5 12h14');
  svg.append(path);
  return svg;
}

function hostTheme(editor: HTMLElement): 'dark' | 'light' {
  let current: HTMLElement | null = editor;
  while (current) {
    const background = window.getComputedStyle(current).backgroundColor;
    const match = background.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/i);
    if (match && (match[4] === undefined || Number(match[4]) > 0) && Number(match[1]) + Number(match[2]) + Number(match[3]) < 180) {
      return 'dark';
    }
    current = current.parentElement;
  }

  return 'light';
}

function positionPopover(root: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  const rootRect = root.getBoundingClientRect();
  const maxLeft = Math.max(12, window.innerWidth - rootRect.width - 12);
  const left = Math.min(Math.max(12, rect.left), maxLeft);
  const below = rect.bottom + 8;
  const above = rect.top - rootRect.height - 8;
  const top = below + rootRect.height > window.innerHeight && above >= 12 ? above : below;
  root.style.top = `${Math.round(top)}px`;
  root.style.left = `${Math.round(left)}px`;
}

function attachRoot(root: HTMLElement, mount: AssistantMount): () => void {
  if (mount.kind === 'flow') {
    root.dataset.layout = 'strip';
    if (mount.before && mount.before.parentNode === mount.host) {
      mount.host.insertBefore(root, mount.before);
    } else {
      mount.host.append(root);
    }
    return () => undefined;
  }

  root.dataset.layout = 'popover';
  document.body.append(root);
  const reposition = (): void => {
    positionPopover(root, mount.anchor);
  };
  reposition();
  window.addEventListener('resize', reposition);
  document.addEventListener('scroll', reposition, true);
  return () => {
    window.removeEventListener('resize', reposition);
    document.removeEventListener('scroll', reposition, true);
  };
}

export function attachAssistantPanel(bindings: PanelBindings) {
  const mount = bindings.getAssistantMount(bindings.editor);
  const initialContext = bindings.composeKind === 'reply' ? bindings.getCurrentContext() : null;
  let session: DraftSession = createDraftSession(
    bindings.composeKind,
    initialContext ? [initialContext] : [],
    bindings.readDraft(bindings.editor),
    bindings.readSubject(bindings.editor),
  );
  let presetSettings: PresetSettings = { draftPresets: [], improvePresets: [] };
  let submittedInstructions: string[] = [];
  let promptView: 'input' | 'history' = 'input';
  let open = false;
  let currentContextDismissed = false;
  let requestSeq = 0;
  let activeRequestId: string | null = null;
  let adoptNativeSubject = bindings.composeKind === 'new';
  let draftView: 'input' | 'history' = 'input';
  let draftHistoryEntries: DraftHistoryEntry[] = [];
  let currentHistoryVersion: number | null = null;
  let viewingThread = false;

  const root = document.createElement('div');
  root.className = 'ea-root';
  root.dataset.provider = bindings.provider;
  root.dataset.theme = hostTheme(bindings.editor);
  root.setAttribute('data-email-assist', 'true');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ea-trigger';
  trigger.textContent = 'Assist';
  trigger.setAttribute('aria-expanded', 'false');
  trigger.title = 'Open Email Assistant';

  const panel = document.createElement('section');
  panel.className = 'ea-panel';
  panel.id = makeId('email-assist-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', `${EXTENSION_NAME} panel`);
  trigger.setAttribute('aria-controls', panel.id);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'ea-resize-handle';
  resizeHandle.hidden = true;
  resizeHandle.setAttribute('role', 'separator');
  resizeHandle.setAttribute('aria-label', 'Resize Email Assistant panel');
  resizeHandle.setAttribute('aria-orientation', 'horizontal');

  const contextChips = document.createElement('div');
  contextChips.className = 'ea-context-chips';

  const addContextButton = document.createElement('button');
  addContextButton.type = 'button';
  addContextButton.className = 'ea-icon-button ea-action-icon ea-context-add';
  addContextButton.append(plusIcon());
  addContextButton.setAttribute('aria-label', 'Add context');
  addContextButton.title = 'Add context';

  const contextRow = document.createElement('div');
  contextRow.className = 'ea-context-row';
  contextRow.append(contextChips, addContextButton);

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'ea-icon-button ea-settings-button';
  settingsButton.textContent = '⚙';
  settingsButton.setAttribute('aria-label', 'Open Email Assistant settings');
  settingsButton.title = 'Settings';

  const panelHeader = document.createElement('div');
  panelHeader.className = 'ea-panel-header';
  panelHeader.append(trigger, contextRow, settingsButton);
  contextRow.hidden = true;
  settingsButton.hidden = true;

  const contextLabelInput = document.createElement('input');
  contextLabelInput.placeholder = 'Label';
  const contextTextInput = document.createElement('textarea');
  contextTextInput.rows = 4;
  contextTextInput.placeholder = 'Paste the email text you want the model to use.';
  const addPastedButton = document.createElement('button');
  addPastedButton.type = 'button';
  addPastedButton.className = 'ea-primary-button';
  addPastedButton.textContent = 'Add context';
  const cancelContextButton = document.createElement('button');
  cancelContextButton.type = 'button';
  cancelContextButton.className = 'ea-secondary-button';
  cancelContextButton.textContent = 'Cancel';
  const contextFormActions = document.createElement('div');
  contextFormActions.className = 'ea-inline-actions';
  contextFormActions.append(addPastedButton, cancelContextButton);
  const contextForm = document.createElement('div');
  contextForm.className = 'ea-context-form';
  contextForm.hidden = true;
  contextForm.append(field('Label', contextLabelInput), field('Paste email text', contextTextInput), contextFormActions);

  const instructionInput = document.createElement('textarea');
  instructionInput.rows = 3;
  instructionInput.maxLength = MAX_INSTRUCTION_CHARS;
  instructionInput.setAttribute('aria-label', 'Writing instruction');
  instructionInput.placeholder = 'Describe the message you want to write…';

  const startOverButton = document.createElement('button');
  startOverButton.type = 'button';
  startOverButton.className = 'ea-icon-button ea-start-over';
  startOverButton.textContent = '↺';
  startOverButton.setAttribute('aria-label', 'Start over');
  startOverButton.title = 'Start over — clear this draft and prompt history';
  startOverButton.hidden = true;

  const promptCaption = document.createElement('button');
  promptCaption.type = 'button';
  promptCaption.className = 'ea-field-caption ea-prompt-toggle';
  promptCaption.textContent = 'Prompt';
  promptCaption.setAttribute('aria-expanded', 'false');
  promptCaption.setAttribute('aria-label', 'Show prompt history');
  const promptHeader = document.createElement('div');
  promptHeader.className = 'ea-field-header';
  promptHeader.append(promptCaption, startOverButton);

  const promptHistory = document.createElement('div');
  promptHistory.className = 'ea-prompt-history';
  promptHistory.hidden = true;
  promptHistory.setAttribute('aria-label', 'Prompt history');
  const promptHistoryList = document.createElement('ol');
  promptHistoryList.className = 'ea-prompt-history-list';
  promptHistory.append(promptHistoryList);

  const promptBody = document.createElement('div');
  promptBody.className = 'ea-prompt-body';
  promptBody.append(instructionInput, promptHistory);

  const instructionField = document.createElement('div');
  instructionField.className = 'ea-field ea-prompt-field';
  instructionField.append(promptHeader, promptBody);

  const presetSelect = document.createElement('select');
  presetSelect.setAttribute('aria-label', 'Saved instructions');
  const presetPlaceholder = new Option('Presets', '');
  presetPlaceholder.disabled = true;
  presetPlaceholder.selected = true;
  presetSelect.append(presetPlaceholder);

  const primaryButton = document.createElement('button');
  primaryButton.type = 'button';
  primaryButton.className = 'ea-primary-button';

  const draftActions = document.createElement('div');
  draftActions.className = 'ea-draft-actions';
  draftActions.append(primaryButton, presetSelect);

  const draftOutput = document.createElement('textarea');
  draftOutput.rows = 8;
  draftOutput.maxLength = MAX_DRAFT_CHARS;
  draftOutput.setAttribute('aria-label', 'Draft email');
  draftOutput.placeholder = 'Your draft will appear here.';

  const status = document.createElement('p');
  status.className = 'ea-status';
  status.setAttribute('role', 'status');

  const draftCaption = document.createElement('button');
  draftCaption.type = 'button';
  draftCaption.className = 'ea-field-caption ea-draft-toggle';
  draftCaption.textContent = 'Draft';
  draftCaption.setAttribute('aria-expanded', 'false');
  draftCaption.setAttribute('aria-label', 'Show draft history');
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'ea-icon-button ea-action-icon ea-copy-button';
  copyButton.append(copyIcon());
  copyButton.setAttribute('aria-label', 'Copy draft');
  copyButton.title = 'Copy draft';
  const draftHeader = document.createElement('div');
  draftHeader.className = 'ea-field-header';
  draftHeader.append(draftCaption, status, copyButton);

  const draftLabel = document.createElement('div');
  draftLabel.className = 'ea-field ea-draft-field';
  const draftHistory = document.createElement('div');
  draftHistory.className = 'ea-draft-history';
  draftHistory.hidden = true;
  draftHistory.setAttribute('aria-label', 'Draft history');
  const draftHistoryList = document.createElement('ol');
  draftHistoryList.className = 'ea-draft-history-list';
  draftHistory.append(draftHistoryList);
  draftLabel.append(draftHeader, draftOutput, draftHistory);

  const subjectInput = document.createElement('input');
  subjectInput.setAttribute('aria-label', 'Subject');
  subjectInput.placeholder = 'If available';
  const subjectLabel = field('Subject:', subjectInput);

  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'ea-primary-button';
  applyButton.textContent = 'Apply';
  applyButton.title = 'Apply draft to compose';
  const reviewActions = document.createElement('div');
  reviewActions.className = 'ea-review-actions';
  reviewActions.append(applyButton);

  const promptColumn = document.createElement('div');
  promptColumn.className = 'ea-prompt-column';
  promptColumn.append(instructionField, draftActions);

  const outputColumn = document.createElement('div');
  outputColumn.className = 'ea-output-column';
  const subjectActions = document.createElement('div');
  subjectActions.className = 'ea-subject-actions';
  subjectActions.append(subjectLabel, reviewActions);
  outputColumn.append(draftLabel, subjectActions);

  const panelMain = document.createElement('div');
  panelMain.className = 'ea-panel-main';
  panelMain.append(promptColumn, outputColumn);

  const threadViewer = document.createElement('div');
  threadViewer.className = 'ea-thread-viewer';
  threadViewer.hidden = true;
  threadViewer.setAttribute('aria-label', 'Reply chain');
  const threadViewerList = document.createElement('div');
  threadViewerList.className = 'ea-thread-viewer-list';
  threadViewer.append(threadViewerList);

  panel.append(
    contextForm,
    panelMain,
    threadViewer,
  );
  root.append(panelHeader, panel, resizeHandle);
  const detachRoot = attachRoot(root, mount);

  function isLoading(): boolean {
    return session.phase === 'drafting' || session.phase === 'improving';
  }

  function takeNativeSubjectIfNeeded(): void {
    if (bindings.composeKind !== 'new' || !adoptNativeSubject) {
      return;
    }

    session = { ...session, suggestedSubject: bindings.readSubject(bindings.editor) };
  }

  function cancelActiveRequest(): void {
    if (!activeRequestId && !isLoading()) {
      return;
    }

    const requestId = activeRequestId;
    activeRequestId = null;
    requestSeq += 1;
    session = {
      ...session,
      phase: session.draft ? 'ready' : 'idle',
      error: '',
    };
    if (requestId) {
      void Promise.resolve(chrome.runtime.sendMessage({ type: 'email-assist:cancel-draft', requestId })).catch(() => undefined);
    }
  }

  let resizeState: { startY: number; startHeight: number } | null = null;

  function getEditorHeight(): number {
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue('--ea-editor-height'));
    return Number.isFinite(value) ? value : DEFAULT_PANEL_EDITOR_HEIGHT;
  }

  function setEditorHeight(height: number): void {
    const nextHeight = Math.round(Math.max(MIN_PANEL_EDITOR_HEIGHT, Math.min(MAX_PANEL_EDITOR_HEIGHT, height)));
    root.style.setProperty('--ea-editor-height', `${nextHeight}px`);
  }

  function stopResizing(): void {
    if (!resizeState) return;
    resizeState = null;
    window.removeEventListener('pointermove', handleResizePointerMove);
    window.removeEventListener('pointerup', stopResizing);
    window.removeEventListener('pointercancel', stopResizing);
    document.body.style.userSelect = '';
  }

  function handleResizePointerMove(event: PointerEvent): void {
    if (!resizeState) return;
    setEditorHeight(resizeState.startHeight + event.clientY - resizeState.startY);
  }

  function handleResizePointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    resizeState = { startY: event.clientY, startHeight: getEditorHeight() };
    resizeHandle.setPointerCapture?.(event.pointerId);
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handleResizePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);
  }

  resizeHandle.addEventListener('pointerdown', handleResizePointerDown);

  function renderPresets(): void {
    const presets = session.draft ? presetSettings.improvePresets : presetSettings.draftPresets;
    const placeholder = new Option('Presets', '');
    placeholder.disabled = true;
    placeholder.selected = true;
    presetSelect.replaceChildren(placeholder);
    for (const preset of presets) {
      presetSelect.append(new Option(preset, preset));
    }
  }

  function renderPromptHistory(): void {
    promptHistoryList.replaceChildren();
    for (const instruction of submittedInstructions) {
      const item = document.createElement('li');
      item.textContent = instruction;
      promptHistoryList.append(item);
    }
  }

  function renderDraftHistory(): void {
    draftHistoryList.replaceChildren();
    for (const entry of [...draftHistoryEntries].reverse()) {
      const item = document.createElement('li');
      item.className = 'ea-draft-history-item';

      const itemHeader = document.createElement('div');
      itemHeader.className = 'ea-draft-history-header';
      const version = document.createElement('span');
      version.textContent = `V${entry.version}${currentHistoryVersion === entry.version ? ' (Current)' : ''}`;
      const subject = document.createElement('span');
      subject.className = 'ea-draft-history-subject';
      subject.textContent = entry.subject ? `Subject: ${entry.subject}` : '';
      const restore = document.createElement('button');
      restore.type = 'button';
      restore.className = 'ea-secondary-button';
      restore.textContent = 'Restore';
      restore.disabled = isLoading();
      restore.addEventListener('click', () => {
        session = setSessionDraft(session, entry.draft);
        session = {
          ...session,
          suggestedSubject: bindings.composeKind === 'new' ? entry.subject : '',
        };
        adoptNativeSubject = false;
        currentHistoryVersion = entry.version;
        draftView = 'input';
        status.textContent = `Restored draft V${entry.version}.`;
        render();
        draftOutput.focus();
      });
      itemHeader.append(version, subject, restore);

      const preview = document.createElement('textarea');
      preview.readOnly = true;
      preview.rows = 4;
      preview.value = entry.draft;
      preview.setAttribute('aria-label', `Draft history V${entry.version}`);
      item.append(itemHeader, preview);
      draftHistoryList.append(item);
    }
  }

  function renderPromptView(): void {
    const hasHistory = submittedInstructions.length > 0;
    const showingHistory = hasHistory && promptView === 'history';
    promptCaption.textContent = showingHistory ? 'Prompt history' : 'Prompt';
    promptCaption.disabled = !hasHistory;
    promptCaption.setAttribute('aria-expanded', String(showingHistory));
    promptCaption.setAttribute('aria-label', showingHistory ? 'Show prompt input' : 'Show prompt history');
    instructionInput.hidden = showingHistory;
    promptHistory.hidden = !showingHistory;
  }

  function currentThreadContext(): ContextItem | undefined {
    return session.contexts.find((context) => context.kind === 'current-thread');
  }

  function renderThreadViewer(): void {
    const thread = currentThreadContext();
    threadViewerList.replaceChildren();
    if (!thread || thread.messages.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'ea-thread-viewer-empty';
      empty.textContent = 'No reply-chain messages to show.';
      threadViewerList.append(empty);
      return;
    }

    for (const message of thread.messages) {
      const item = document.createElement('article');
      item.className = 'ea-thread-message';
      const meta = document.createElement('header');
      meta.className = 'ea-thread-message-meta';
      const sender = document.createElement('div');
      sender.className = 'ea-thread-message-sender';
      sender.textContent = message.sender || 'Unknown sender';
      meta.append(sender);
      if (message.date) {
        const date = document.createElement('div');
        date.className = 'ea-thread-message-date';
        date.textContent = message.date;
        meta.append(date);
      }
      const body = document.createElement('pre');
      body.className = 'ea-thread-message-body';
      body.textContent = message.body;
      item.append(meta, body);
      threadViewerList.append(item);
    }
  }

  function syncThreadViewer(): void {
    if (viewingThread && (bindings.composeKind !== 'reply' || !currentThreadContext())) {
      viewingThread = false;
    }

    if (viewingThread) {
      contextForm.hidden = true;
      panelMain.hidden = true;
      threadViewer.hidden = false;
      renderThreadViewer();
      return;
    }

    panelMain.hidden = false;
    threadViewer.hidden = true;
  }

  function renderContexts(): void {
    contextChips.replaceChildren();
    for (const context of session.contexts) {
      const chip = document.createElement('span');
      chip.className = 'ea-context-chip';
      if (context.kind === 'current-thread' && viewingThread) {
        chip.classList.add('ea-context-chip-active');
      }

      const canToggleThread = context.kind === 'current-thread' && bindings.composeKind === 'reply';
      if (canToggleThread) {
        const label = document.createElement('button');
        label.type = 'button';
        label.className = 'ea-context-chip-label';
        label.textContent = contextDisplayLabel(context);
        label.title = viewingThread ? 'Hide reply chain' : 'View reply chain';
        label.setAttribute('aria-pressed', String(viewingThread));
        label.setAttribute(
          'aria-label',
          viewingThread ? 'Hide reply chain' : `View reply chain: ${contextDisplayLabel(context)}`,
        );
        label.addEventListener('click', () => {
          viewingThread = !viewingThread;
          render();
        });
        chip.append(label);
      } else {
        const label = document.createElement('span');
        label.textContent = contextDisplayLabel(context);
        chip.append(label);
      }

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ea-chip-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${contextDisplayLabel(context)}`);
      remove.addEventListener('click', () => {
        if (context.kind === 'current-thread') {
          currentContextDismissed = true;
          viewingThread = false;
        }
        session = setSessionContexts(session, session.contexts.filter((item) => item.id !== context.id));
        render();
      });
      chip.append(remove);
      contextChips.append(chip);
    }
  }

  function render(): void {
    const loading = isLoading();
    const hasDraft = Boolean(session.draft.trim());
    const showingPromptHistory = submittedInstructions.length > 0 && promptView === 'history';
    const showingDraftHistory = draftHistoryEntries.length > 0 && draftView === 'history';
    panelMain.dataset.hasDraft = String(hasDraft);
    root.dataset.open = String(open);
    root.dataset.loading = String(loading);
    instructionInput.placeholder = hasDraft
      ? 'Describe how to improve the draft…'
      : 'Describe the message you want to write…';
    primaryButton.textContent = getPrimaryActionLabel(session.phase, hasDraft);
    primaryButton.title = loading ? 'Request in progress' : hasDraft ? 'Improve the draft' : 'Draft an email';
    trigger.title = open ? 'Collapse Email Assistant' : 'Open Email Assistant';
    primaryButton.disabled = loading || showingPromptHistory || showingDraftHistory;
    if (draftOutput.value !== session.draft) {
      draftOutput.value = session.draft;
    }
    draftOutput.disabled = loading;
    draftOutput.hidden = showingDraftHistory;
    draftHistory.hidden = !showingDraftHistory;
    draftCaption.textContent = showingDraftHistory ? 'Draft history' : 'Draft';
    draftCaption.disabled = draftHistoryEntries.length === 0;
    draftCaption.setAttribute('aria-expanded', String(showingDraftHistory));
    draftCaption.setAttribute('aria-label', showingDraftHistory ? 'Show current draft' : 'Show draft history');
    outputColumn.hidden = !hasDraft && draftHistoryEntries.length === 0;
    subjectActions.hidden = showingDraftHistory;
    subjectActions.dataset.hasSubject = String(bindings.composeKind === 'new');
    if (subjectInput.value !== session.suggestedSubject) {
      subjectInput.value = session.suggestedSubject;
    }
    subjectLabel.hidden = bindings.composeKind !== 'new';
    applyButton.disabled = loading || !hasDraft;
    copyButton.disabled = loading || !hasDraft;
    startOverButton.disabled = loading;
    startOverButton.hidden = !hasDraft && draftHistoryEntries.length === 0;
    reviewActions.hidden = !hasDraft;
    presetSelect.disabled = loading || showingPromptHistory || showingDraftHistory;
    instructionInput.disabled = loading;
    addContextButton.disabled = loading || session.contexts.length >= MAX_CONTEXT_ITEMS;
    contextTextInput.maxLength = MAX_CONTEXT_ITEM_CHARS;
    status.textContent = session.error;
    resizeHandle.hidden = !open;
    const statusHost = hasDraft ? draftHeader : draftActions;
    if (status.parentElement !== statusHost) {
      statusHost.insertBefore(status, hasDraft ? copyButton : null);
    }
    renderContexts();
    renderPresets();
    renderPromptHistory();
    renderDraftHistory();
    renderPromptView();
    syncThreadViewer();
  }

  function refreshCurrentContext(): boolean {
    if (bindings.composeKind !== 'reply' || currentContextDismissed) {
      return false;
    }

    const currentContext = bindings.getCurrentContext();
    if (!currentContext) {
      return false;
    }

    const currentIndex = session.contexts.findIndex((context) => context.kind === 'current-thread');
    if (currentIndex < 0) {
      session = setSessionContexts(session, [...session.contexts, currentContext]);
      return true;
    }

    if (JSON.stringify(session.contexts[currentIndex]) === JSON.stringify(currentContext)) {
      return false;
    }

    const contexts = [...session.contexts];
    contexts[currentIndex] = currentContext;
    session = setSessionContexts(session, contexts);
    return true;
  }

  async function loadPresets(): Promise<void> {
    const settings = await getSettings();
    presetSettings = { draftPresets: settings.draftPresets, improvePresets: settings.improvePresets };
    renderPresets();
  }

  async function runDraft(): Promise<void> {
    refreshCurrentContext();
    const instruction = instructionInput.value.trim();
    if (!instruction) {
      session = failDraftRequest(session, 'Describe what you want the email to say.');
      render();
      instructionInput.focus();
      return;
    }
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      session = failDraftRequest(session, `Instruction is limited to ${MAX_INSTRUCTION_CHARS} characters.`);
      render();
      instructionInput.focus();
      return;
    }

    takeNativeSubjectIfNeeded();
    const seq = ++requestSeq;
    const requestId = makeId('request');
    const action = session.draft.trim() ? 'improve' : 'draft';
    session = startDraftRequest(session);
    render();

    try {
      const subject = bindings.composeKind === 'new' ? session.suggestedSubject : '';
      const contexts = bindings.prepareAttachments
        ? await Promise.all(session.contexts.map(async (context) => ({
          ...context,
          attachments: context.attachments
            ? await bindings.prepareAttachments!(context.attachments)
            : undefined,
        })))
        : session.contexts;
      const composeAttachments = bindings.getComposeAttachments?.(bindings.editor) ?? [];
      const attachments = bindings.prepareAttachments
        ? await bindings.prepareAttachments(composeAttachments)
        : composeAttachments;
      if (seq !== requestSeq || !root.isConnected) {
        return;
      }
      activeRequestId = requestId;
      const writer = bindings.getWriter?.().trim() || undefined;
      const request: DraftRequest = {
        type: 'email-assist:draft',
        requestId,
        provider: bindings.provider,
        composeKind: bindings.composeKind,
        action,
        instruction,
        draft: session.draft,
        subject,
        contexts,
        attachments,
        ...(writer ? { writer } : {}),
      };
      const response = (await chrome.runtime.sendMessage(request)) as DraftResponse | undefined;
      if (seq !== requestSeq || !root.isConnected) {
        return;
      }
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Could not create a draft.');
      }

      session = finishDraftRequest(session, response.draft, response.suggestedSubject);
      draftHistoryEntries = [...draftHistoryEntries, {
        version: draftHistoryEntries.length + 1,
        draft: session.draft,
        subject: session.suggestedSubject,
      }];
      currentHistoryVersion = draftHistoryEntries.at(-1)?.version ?? null;
      adoptNativeSubject = false;
      submittedInstructions = [...submittedInstructions, instruction];
      instructionInput.value = '';
    } catch (error) {
      if (seq !== requestSeq || !root.isConnected) {
        return;
      }
      session = failDraftRequest(session, error instanceof Error ? error.message : 'Could not create a draft.');
    } finally {
      if (activeRequestId === requestId) {
        activeRequestId = null;
      }
    }

    render();
    if (session.phase === 'ready') {
      instructionInput.focus();
    }
  }

  root.addEventListener('click', (event) => {
    event.stopPropagation();
  });

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    if (open) {
      cancelActiveRequest();
      viewingThread = false;
    }
    open = !open;
    root.dataset.open = String(open);
    panel.hidden = !open;
    contextRow.hidden = !open;
    settingsButton.hidden = !open;
    resizeHandle.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    trigger.title = open ? 'Collapse Email Assistant' : 'Open Email Assistant';
    if (open) {
      root.dataset.theme = hostTheme(bindings.editor);
      refreshCurrentContext();
      void loadPresets().catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not load saved instructions.';
      });
      render();
      instructionInput.focus();
      window.requestAnimationFrame(() => {
        if (open && mount.kind === 'popover') {
          positionPopover(root, mount.anchor);
        }
      });
    } else {
      panelMain.hidden = false;
      threadViewer.hidden = true;
    }
  });

  addContextButton.addEventListener('click', () => {
    if (viewingThread) {
      viewingThread = false;
      syncThreadViewer();
    }
    contextForm.hidden = !contextForm.hidden;
    if (!contextForm.hidden) {
      contextLabelInput.focus();
    }
  });

  cancelContextButton.addEventListener('click', () => {
    contextForm.hidden = true;
    contextLabelInput.value = '';
    contextTextInput.value = '';
  });

  addPastedButton.addEventListener('click', () => {
    const label = contextLabelInput.value.trim();
    const text = contextTextInput.value.trim();
    if (!label || !text) {
      status.textContent = 'Add a label and paste the reference email first.';
      return;
    }

    if (session.contexts.length >= MAX_CONTEXT_ITEMS) {
      status.textContent = `You can add up to ${MAX_CONTEXT_ITEMS} context items.`;
      return;
    }
    if (text.length > MAX_CONTEXT_ITEM_CHARS) {
      status.textContent = `Reference email is limited to ${MAX_CONTEXT_ITEM_CHARS} characters.`;
      return;
    }

    session = setSessionContexts(session, [...session.contexts, createPastedContext(bindings.provider, label, text)]);
    contextForm.hidden = true;
    contextLabelInput.value = '';
    contextTextInput.value = '';
    render();
  });

  presetSelect.addEventListener('change', () => {
    if (presetSelect.value) {
      instructionInput.value = presetSelect.value;
    }
    presetSelect.value = '';
    instructionInput.focus();
  });

  promptCaption.addEventListener('click', () => {
    if (!submittedInstructions.length) return;
    promptView = promptView === 'history' ? 'input' : 'history';
    render();
    if (promptView === 'input') {
      instructionInput.focus();
    } else {
      promptCaption.focus();
    }
  });

  draftCaption.addEventListener('click', () => {
    if (!draftHistoryEntries.length) return;
    draftView = draftView === 'history' ? 'input' : 'history';
    render();
    if (draftView === 'input') {
      draftOutput.focus();
    } else {
      draftCaption.focus();
    }
  });

  primaryButton.addEventListener('click', () => void runDraft());
  instructionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void runDraft();
    }
  });

  draftOutput.addEventListener('input', () => {
    if (!isLoading()) {
      currentHistoryVersion = null;
      session = setSessionDraft(session, draftOutput.value);
      render();
    }
  });

  subjectInput.addEventListener('input', () => {
    currentHistoryVersion = null;
    adoptNativeSubject = false;
    session = { ...session, suggestedSubject: subjectInput.value };
  });

  applyButton.addEventListener('click', () => {
    if (!session.draft.trim()) return;
    bindings.insertDraft(bindings.editor, session.draft);
    if (bindings.composeKind === 'new') {
      const nextSubject = session.suggestedSubject.trim();
      const existingSubject = bindings.readSubject(bindings.editor).trim();
      if (nextSubject !== existingSubject) {
        bindings.insertSubject(bindings.editor, nextSubject);
      }
    }
    status.textContent = 'Applied to compose. Review it before sending.';
  });

  copyButton.addEventListener('click', () => {
    void navigator.clipboard.writeText(session.draft).then(
      () => {
        status.textContent = 'Copied to clipboard.';
      },
      () => {
        status.textContent = 'Could not copy the draft.';
      },
    );
  });

  startOverButton.addEventListener('click', () => {
    cancelActiveRequest();
    session = startOver(session);
    submittedInstructions = [];
    draftHistoryEntries = [];
    currentHistoryVersion = null;
    adoptNativeSubject = bindings.composeKind === 'new';
    takeNativeSubjectIfNeeded();
    promptView = 'input';
    draftView = 'input';
    instructionInput.value = '';
    render();
    instructionInput.focus();
  });

  settingsButton.addEventListener('click', () => {
    void chrome.runtime
      .sendMessage({ type: 'email-assist:open-settings' })
      .then((response: OpenSettingsResponse | undefined) => {
        if (response && !response.ok) {
          status.textContent = response.error ?? 'Could not open Settings.';
        }
      })
      .catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not open Settings.';
      });
  });

  const handleStorageChange = (): void => {
    void loadPresets().catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : 'Could not load saved instructions.';
    });
  };
  const handleEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !open) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    cancelActiveRequest();
    open = false;
    viewingThread = false;
    root.dataset.open = 'false';
    panel.hidden = true;
    panelMain.hidden = false;
    threadViewer.hidden = true;
    contextRow.hidden = true;
    settingsButton.hidden = true;
    resizeHandle.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    bindings.editor.focus();
  };

  chrome.storage.onChanged.addListener(handleStorageChange);
  document.addEventListener('keydown', handleEscape, true);
  render();

  return {
    cleanup() {
      cancelActiveRequest();
      stopResizing();
      chrome.storage.onChanged.removeListener(handleStorageChange);
      document.removeEventListener('keydown', handleEscape, true);
      detachRoot();
      root.remove();
    },
    setComposeKind(composeKind: ComposeKind) {
      cancelActiveRequest();
      bindings.composeKind = composeKind;
      if (composeKind !== 'reply') {
        viewingThread = false;
      }
      session = {
        ...session,
        composeKind,
        suggestedSubject: composeKind === 'new' ? bindings.readSubject(bindings.editor) : '',
      };
      adoptNativeSubject = composeKind === 'new';
      currentHistoryVersion = null;
      refreshCurrentContext();
      render();
    },
    refresh() {
      if (refreshCurrentContext()) {
        render();
      }
    },
  };
}

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
  readDraft: (editor: HTMLElement) => string;
  readSubject: (editor: HTMLElement) => string;
  insertDraft: (editor: HTMLElement, text: string) => void;
  insertSubject: (editor: HTMLElement, text: string) => void;
};

type PresetSettings = {
  draftPresets: string[];
  improvePresets: string[];
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

  const draftCaption = document.createElement('span');
  draftCaption.className = 'ea-field-caption';
  draftCaption.textContent = 'Draft';
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
  draftLabel.append(draftHeader, draftOutput);

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

  panel.append(
    contextForm,
    panelMain,
  );
  root.append(panelHeader, panel, resizeHandle);
  const detachRoot = attachRoot(root, mount);

  function isLoading(): boolean {
    return session.phase === 'drafting' || session.phase === 'improving';
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

  function renderContexts(): void {
    contextChips.replaceChildren();
    for (const context of session.contexts) {
      const chip = document.createElement('span');
      chip.className = 'ea-context-chip';
      const label = document.createElement('span');
      label.textContent = contextDisplayLabel(context);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ea-chip-remove';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${contextDisplayLabel(context)}`);
      remove.addEventListener('click', () => {
        if (context.kind === 'current-thread') {
          currentContextDismissed = true;
        }
        session = setSessionContexts(session, session.contexts.filter((item) => item.id !== context.id));
        render();
      });
      chip.append(label, remove);
      contextChips.append(chip);
    }
  }

  function render(): void {
    const loading = isLoading();
    const hasDraft = Boolean(session.draft.trim());
    const showingPromptHistory = submittedInstructions.length > 0 && promptView === 'history';
    panelMain.dataset.hasDraft = String(hasDraft);
    root.dataset.open = String(open);
    root.dataset.loading = String(loading);
    instructionInput.placeholder = hasDraft
      ? 'Describe how to improve the draft…'
      : 'Describe the message you want to write…';
    primaryButton.textContent = getPrimaryActionLabel(session.phase, hasDraft);
    primaryButton.title = loading ? 'Request in progress' : hasDraft ? 'Improve the draft' : 'Draft an email';
    trigger.title = open ? 'Collapse Email Assistant' : 'Open Email Assistant';
    primaryButton.disabled = loading || showingPromptHistory;
    if (draftOutput.value !== session.draft) {
      draftOutput.value = session.draft;
    }
    draftOutput.disabled = loading;
    outputColumn.hidden = !hasDraft;
    subjectActions.dataset.hasSubject = String(bindings.composeKind === 'new');
    if (subjectInput.value !== session.suggestedSubject) {
      subjectInput.value = session.suggestedSubject;
    }
    subjectLabel.hidden = bindings.composeKind !== 'new';
    applyButton.disabled = loading || !hasDraft;
    copyButton.disabled = loading || !hasDraft;
    startOverButton.disabled = loading;
    startOverButton.hidden = !hasDraft;
    reviewActions.hidden = !hasDraft;
    presetSelect.disabled = loading || showingPromptHistory;
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
    renderPromptView();
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

    const seq = ++requestSeq;
    const action = session.draft.trim() ? 'improve' : 'draft';
    session = startDraftRequest(session);
    render();

    const subject = bindings.composeKind === 'new'
      ? session.suggestedSubject
      : bindings.readSubject(bindings.editor);

    const request: DraftRequest = {
      type: 'email-assist:draft',
      provider: bindings.provider,
      composeKind: bindings.composeKind,
      action,
      instruction,
      draft: session.draft,
      subject,
      contexts: session.contexts,
      includeSubject: action === 'draft' && bindings.composeKind === 'new' && !subject.trim(),
    };

    try {
      const response = (await chrome.runtime.sendMessage(request)) as DraftResponse | undefined;
      if (seq !== requestSeq || !root.isConnected) {
        return;
      }
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Could not create a draft.');
      }

      session = finishDraftRequest(session, response.draft, response.suggestedSubject);
      submittedInstructions = [...submittedInstructions, instruction];
      instructionInput.value = '';
      if (response.subjectError) {
        session = { ...session, error: `Draft ready. Subject suggestion unavailable: ${response.subjectError}` };
      }
    } catch (error) {
      if (seq !== requestSeq || !root.isConnected) {
        return;
      }
      session = failDraftRequest(session, error instanceof Error ? error.message : 'Could not create a draft.');
    }

    render();
    if (session.phase === 'ready') {
      instructionInput.focus();
    }
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
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
    }
  });

  addContextButton.addEventListener('click', () => {
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

  primaryButton.addEventListener('click', () => void runDraft());
  instructionInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void runDraft();
    }
  });

  draftOutput.addEventListener('input', () => {
    if (!isLoading()) {
      session = setSessionDraft(session, draftOutput.value);
      render();
    }
  });

  subjectInput.addEventListener('input', () => {
    session = { ...session, suggestedSubject: subjectInput.value };
  });

  applyButton.addEventListener('click', () => {
    if (!session.draft.trim()) return;
    bindings.insertDraft(bindings.editor, session.draft);
    const existingSubject = bindings.readSubject(bindings.editor).trim();
    const nextSubject = session.suggestedSubject.trim();
    if (bindings.composeKind === 'new' && nextSubject !== existingSubject) {
      bindings.insertSubject(bindings.editor, nextSubject);
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
    requestSeq += 1;
    session = startOver(session);
    submittedInstructions = [];
    promptView = 'input';
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
    open = false;
    root.dataset.open = 'false';
    panel.hidden = true;
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
      requestSeq += 1;
      stopResizing();
      chrome.storage.onChanged.removeListener(handleStorageChange);
      document.removeEventListener('keydown', handleEscape, true);
      detachRoot();
      root.remove();
    },
    setComposeKind(composeKind: ComposeKind) {
      bindings.composeKind = composeKind;
      session = {
        ...session,
        composeKind,
        suggestedSubject: composeKind === 'new' ? bindings.readSubject(bindings.editor) : '',
      };
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

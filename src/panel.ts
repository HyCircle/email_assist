import triggerIconUrl from '../icon.svg';

import { EXTENSION_NAME, getDefaultSettings } from './constants';
import { getSettings } from './storage';
import type {
  AssistAction,
  AssistantAnchorRect,
  AssistantSettings,
  GenerateDraftRequest,
  GenerateDraftResponse,
  OpenSettingsResponse,
  ProviderName,
  RequestState,
  ThreadContext,
} from './types';

type PanelBindings = {
  provider: ProviderName;
  editor: HTMLElement;
  getComposeMount: (editor: HTMLElement) => HTMLElement;
  getTriggerAnchor?: (editor: HTMLElement, triggerWidth: number, triggerHeight: number) => AssistantAnchorRect | null;
  getThreadContext: () => ThreadContext;
  panelDirection?: 'auto' | 'down';
  readDraft: (editor: HTMLElement) => string;
  readSubject: (editor: HTMLElement) => string;
  insertDraft: (editor: HTMLElement, text: string) => void;
  insertSubject: (editor: HTMLElement, text: string) => void;
};

type PanelState = {
  requestState: RequestState;
  result: string;
  error: string;
  suggestedSubject: string;
  showSuggestedSubject: boolean;
};

type PanelUiSettings = Pick<AssistantSettings, 'generatePresets' | 'refinePresets'>;

type SplitActionControls = {
  action: AssistAction;
  primaryButton: HTMLButtonElement;
  toggleButton: HTMLButtonElement;
  menu: HTMLDivElement;
};

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temp = document.createElement('textarea');
  temp.value = text;
  temp.style.position = 'fixed';
  temp.style.opacity = '0';
  document.body.append(temp);
  temp.select();
  document.execCommand('copy');
  temp.remove();
}

function stateLabel(state: PanelState): string {
  if (state.requestState === 'loading') {
    return 'Generating draft...';
  }

  if (state.requestState === 'error') {
    return state.error;
  }

  if (state.requestState === 'success') {
    return 'Draft ready.';
  }

  return 'Ready.';
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveTriggerSize(editor: HTMLElement): number {
  const editorFontSize = Number.parseFloat(window.getComputedStyle(editor).fontSize);
  const fallbackFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
  const baseFontSize = Number.isFinite(editorFontSize)
    ? editorFontSize
    : Number.isFinite(fallbackFontSize)
      ? fallbackFontSize
      : 14;

  return clamp(Math.round(baseFontSize * 1.9), 24, 30);
}

function syncTriggerMetrics(root: HTMLElement, editor: HTMLElement): void {
  const triggerSize = resolveTriggerSize(editor);
  const shadowY = Math.max(6, Math.round(triggerSize * 0.3));
  const shadowBlur = Math.max(12, Math.round(triggerSize * 0.6));
  root.style.setProperty('--ea-trigger-size', `${triggerSize}px`);
  root.style.setProperty('--ea-trigger-shadow', `0 ${shadowY}px ${shadowBlur}px rgba(86, 34, 21, 0.18)`);
}

function shortcutModifierLabel(): string {
  return /mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
}

function resolvePresets(settings: PanelUiSettings, action: AssistAction): string[] {
  return action === 'generate' ? settings.generatePresets : settings.refinePresets;
}

function createTriggerIcon(): HTMLImageElement {
  const icon = document.createElement('img');
  icon.className = 'ea-trigger-icon';
  icon.src = triggerIconUrl;
  icon.alt = '';
  icon.decoding = 'async';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
}

export function attachAssistantPanel(bindings: PanelBindings) {
  const defaultSettings = getDefaultSettings();
  const panelSettings: PanelUiSettings = {
    generatePresets: [...defaultSettings.generatePresets],
    refinePresets: [...defaultSettings.refinePresets],
  };
  const root = document.createElement('div');
  root.className = 'ea-root';
  root.dataset.expand = 'down';

  const mount = bindings.getComposeMount(bindings.editor);
  const panelState: PanelState = {
    requestState: 'idle',
    result: '',
    error: '',
    suggestedSubject: '',
    showSuggestedSubject: false,
  };

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ea-trigger';
  trigger.append(createTriggerIcon());
  trigger.setAttribute('aria-label', 'Open email assistant');
  trigger.title = 'Open email assistant';

  const panel = document.createElement('section');
  panel.className = 'ea-panel';
  panel.hidden = true;

  const menuLayer = document.createElement('div');
  menuLayer.className = 'ea-menu-layer';

  const header = document.createElement('div');
  header.className = 'ea-header';
  const headerTop = document.createElement('div');
  headerTop.className = 'ea-header-top';
  headerTop.innerHTML = `
    <div>
      <p class="ea-kicker">${EXTENSION_NAME}</p>
      <h2>${bindings.provider === 'gmail' ? 'Gmail' : 'Outlook'} compose helper</h2>
    </div>
  `;

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'ea-icon-button';
  settingsButton.innerHTML = '<span aria-hidden="true">⚙</span>';
  settingsButton.title = 'Settings';
  settingsButton.setAttribute('aria-label', 'Open Settings');
  headerTop.append(settingsButton);
  header.append(headerTop);

  const subjectLine = document.createElement('p');
  subjectLine.className = 'ea-subject';
  subjectLine.textContent = 'Current thread';
  header.append(subjectLine);

  const instructionLabel = document.createElement('label');
  instructionLabel.className = 'ea-field';
  instructionLabel.innerHTML = '<span>Instruction</span>';

  const instructionInput = document.createElement('textarea');
  instructionInput.rows = 4;
  instructionInput.placeholder = 'reply politely and propose Friday';
  instructionLabel.append(instructionInput);

  const shortcutHint = document.createElement('p');
  shortcutHint.className = 'ea-field-note';
  shortcutHint.textContent = `${shortcutModifierLabel()}+Enter generates. ${shortcutModifierLabel()}+Shift+Enter refines.`;
  instructionLabel.append(shortcutHint);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'ea-actions';

  function createSplitAction(action: AssistAction, label: string, toneClass: string): SplitActionControls {
    const group = document.createElement('div');
    group.className = 'ea-split';

    const primaryButton = document.createElement('button');
    primaryButton.type = 'button';
    primaryButton.className = `ea-action-button ${toneClass}`;
    primaryButton.textContent = label;

    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = `ea-action-toggle ${toneClass}`;
    toggleButton.innerHTML = '<span aria-hidden="true">▾</span>';
    toggleButton.setAttribute('aria-expanded', 'false');
    toggleButton.setAttribute('aria-haspopup', 'menu');
    toggleButton.setAttribute('aria-label', `${label} presets`);

    const menu = document.createElement('div');
    menu.className = 'ea-menu';
    menu.hidden = true;

    group.append(primaryButton, toggleButton);
    buttonRow.append(group);
    menuLayer.append(menu);

    return { action, primaryButton, toggleButton, menu };
  }

  const generateControls = createSplitAction('generate', 'Generate', 'ea-generate');
  generateControls.primaryButton.title = `${shortcutModifierLabel()}+Enter`;

  const refineControls = createSplitAction('refine', 'Refine', 'ea-refine');
  refineControls.primaryButton.title = `${shortcutModifierLabel()}+Shift+Enter`;

  const splitControls = new Map<AssistAction, SplitActionControls>([
    ['generate', generateControls],
    ['refine', refineControls],
  ]);

  const resultLabel = document.createElement('label');
  resultLabel.className = 'ea-field';
  resultLabel.innerHTML = '<span>Draft</span>';

  const subjectSuggestionLabel = document.createElement('label');
  subjectSuggestionLabel.className = 'ea-field';
  subjectSuggestionLabel.hidden = true;
  subjectSuggestionLabel.innerHTML = '<span>Suggested subject</span>';

  const subjectSuggestionInput = document.createElement('input');
  subjectSuggestionInput.type = 'text';
  subjectSuggestionInput.className = 'ea-compact-input';
  subjectSuggestionInput.placeholder = 'Suggested subject will appear here.';
  subjectSuggestionLabel.append(subjectSuggestionInput);

  const resultOutput = document.createElement('textarea');
  resultOutput.rows = 8;
  resultOutput.placeholder = 'Generated text will appear here.';
  resultLabel.append(resultOutput);

  const footer = document.createElement('div');
  footer.className = 'ea-footer';

  const status = document.createElement('p');
  status.className = 'ea-status';
  status.textContent = 'Ready.';

  const insertButton = document.createElement('button');
  insertButton.type = 'button';
  insertButton.textContent = 'Insert';

  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.textContent = 'Copy';

  footer.append(status, insertButton, copyButton);
  panel.append(header, instructionLabel, buttonRow, subjectSuggestionLabel, resultLabel, footer);
  root.append(trigger, panel, menuLayer);
  document.body.append(root);
  syncTriggerMetrics(root, bindings.editor);

  let open = false;
  let openMenuAction: AssistAction | null = null;

  function closePresetMenus(): void {
    for (const controls of splitControls.values()) {
      controls.menu.hidden = true;
      controls.toggleButton.dataset.open = 'false';
      controls.toggleButton.setAttribute('aria-expanded', 'false');
    }

    openMenuAction = null;
  }

  function renderPresetMenu(action: AssistAction): void {
    const controls = splitControls.get(action);
    if (!controls) {
      return;
    }

    controls.menu.replaceChildren();
    const presets = resolvePresets(panelSettings, action);

    if (presets.length === 0) {
      const emptyState = document.createElement('p');
      emptyState.className = 'ea-menu-empty';
      emptyState.textContent = 'No presets yet. Add them in Settings.';
      controls.menu.append(emptyState);
      return;
    }

    for (const preset of presets) {
      const presetButton = document.createElement('button');
      presetButton.type = 'button';
      presetButton.className = 'ea-menu-item';
      presetButton.textContent = preset;
      presetButton.addEventListener('click', () => {
        instructionInput.value = preset;
        instructionInput.focus();
        closePresetMenus();
        void runAction(action);
      });
      controls.menu.append(presetButton);
    }
  }

  function renderPresetMenus(): void {
    renderPresetMenu('generate');
    renderPresetMenu('refine');
  }

  function refreshOpenMenuPosition(): void {
    if (!openMenuAction) {
      return;
    }

    const controls = splitControls.get(openMenuAction);
    if (!controls || controls.menu.hidden) {
      return;
    }

    const rootRect = root.getBoundingClientRect();
    const toggleRect = controls.toggleButton.getBoundingClientRect();
    const menuRect = controls.menu.getBoundingClientRect();
    const preferredTop = root.dataset.expand === 'up'
      ? toggleRect.top - rootRect.top - menuRect.height - 8
      : toggleRect.bottom - rootRect.top + 8;
    const preferredLeft = toggleRect.right - rootRect.left - menuRect.width;
    const absoluteLeft = clamp(rootRect.left + preferredLeft, 16, window.innerWidth - menuRect.width - 16);
    const absoluteTop = clamp(rootRect.top + preferredTop, 16, window.innerHeight - menuRect.height - 16);

    controls.menu.style.left = `${absoluteLeft - rootRect.left}px`;
    controls.menu.style.top = `${absoluteTop - rootRect.top}px`;
  }

  async function loadPanelSettings(): Promise<void> {
    try {
      const settings = await getSettings();
      panelSettings.generatePresets = [...settings.generatePresets];
      panelSettings.refinePresets = [...settings.refinePresets];
    } catch {
      panelSettings.generatePresets = [...defaultSettings.generatePresets];
      panelSettings.refinePresets = [...defaultSettings.refinePresets];
    }

    renderPresetMenus();
    if (open) {
      refreshSubject();
      refreshPosition();
    }
  }

  function syncState(): void {
    const isLoading = panelState.requestState === 'loading';
    const hasResult = Boolean(panelState.result.trim());

    status.textContent = stateLabel(panelState);
    subjectSuggestionLabel.hidden = !panelState.showSuggestedSubject;
    subjectSuggestionInput.value = panelState.suggestedSubject;
    resultOutput.value = panelState.result;
    insertButton.disabled = isLoading || !hasResult;
    copyButton.disabled = isLoading || !hasResult;
    for (const controls of splitControls.values()) {
      controls.primaryButton.disabled = isLoading;
      controls.toggleButton.disabled = isLoading;
    }
    trigger.dataset.loading = String(isLoading);

    if (open) {
      refreshPosition();
    }
  }

  function refreshSubject(): void {
    const thread = bindings.getThreadContext();
    const currentSubject = bindings.readSubject(bindings.editor).trim();
    subjectLine.textContent = currentSubject || thread.subject || 'New message';
  }

  function resolveAnchor(triggerWidth: number, triggerHeight: number): AssistantAnchorRect {
    const mountRect = mount.getBoundingClientRect();
    return (
      bindings.getTriggerAnchor?.(bindings.editor, triggerWidth, triggerHeight) ?? {
        left: mountRect.right - triggerWidth,
        top: mountRect.top + 12,
        width: triggerWidth,
        height: triggerHeight,
      }
    );
  }

  function resolveExpandDirection(anchor: AssistantAnchorRect, rootHeight: number): 'up' | 'down' {
    if (bindings.panelDirection === 'down') {
      return 'down';
    }

    const spaceBelow = window.innerHeight - (anchor.top + anchor.height) - 16;
    const spaceAbove = anchor.top - 16;
    return spaceBelow >= rootHeight || spaceBelow >= spaceAbove ? 'down' : 'up';
  }

  function refreshPosition(): void {
    if (!bindings.editor.isConnected || !mount.isConnected) {
      root.style.display = 'none';
      return;
    }

    root.style.display = 'flex';
    syncTriggerMetrics(root, bindings.editor);

    const triggerRect = trigger.getBoundingClientRect();
    const triggerWidth = Math.ceil(triggerRect.width || 42);
    const triggerHeight = Math.ceil(triggerRect.height || 36);
    const anchor = resolveAnchor(triggerWidth, triggerHeight);
    const isPanelOpen = open && !panel.hidden;
    const rootRect = root.getBoundingClientRect();
    const rootWidth = Math.ceil(isPanelOpen ? Math.max(rootRect.width, triggerWidth) : triggerWidth);
    const rootHeight = Math.ceil(
      isPanelOpen ? Math.min(Math.max(rootRect.height, triggerHeight), window.innerHeight - 32) : triggerHeight,
    );
    const direction = isPanelOpen ? resolveExpandDirection(anchor, rootHeight) : 'down';
    root.dataset.expand = direction;

    const maxLeft = Math.max(16, window.innerWidth - rootWidth - 16);
    const maxTop = Math.max(16, window.innerHeight - rootHeight - 16);
    const triggerLeft = clamp(anchor.left, 16, Math.max(16, window.innerWidth - triggerWidth - 16));
    const triggerTop = clamp(anchor.top, 16, Math.max(16, window.innerHeight - triggerHeight - 16));
    const left = clamp(isPanelOpen ? triggerLeft + triggerWidth - rootWidth : triggerLeft, 16, maxLeft);
    const top = clamp(
      isPanelOpen && direction === 'up' ? triggerTop + triggerHeight - rootHeight : triggerTop,
      16,
      maxTop,
    );

    root.style.top = `${top}px`;
    root.style.left = `${left}px`;
    refreshOpenMenuPosition();
  }

  async function runAction(action: 'generate' | 'refine'): Promise<void> {
    const instruction = instructionInput.value.trim();
    const currentDraft = bindings.readDraft(bindings.editor);
    const currentSubject = bindings.readSubject(bindings.editor).trim();
    const thread = bindings.getThreadContext();
    const shouldGenerateSubject =
      action === 'generate' && !currentSubject && !thread.subject.trim() && thread.messages.length === 0;

    if (!instruction) {
      panelState.requestState = 'error';
      panelState.error = 'Add an instruction before generating.';
      syncState();
      return;
    }

    if (action === 'refine' && !currentDraft) {
      panelState.requestState = 'error';
      panelState.error = 'There is no current draft to refine.';
      syncState();
      return;
    }

    refreshSubject();
    panelState.requestState = 'loading';
    panelState.error = '';
    if (action === 'generate') {
      panelState.suggestedSubject = '';
      panelState.showSuggestedSubject = false;
    }
    closePresetMenus();
    syncState();

    const request: GenerateDraftRequest = {
      type: 'email-assist:generate',
      provider: bindings.provider,
      action,
      instruction,
      currentDraft: action === 'refine' ? currentDraft : currentDraft || undefined,
      currentSubject: currentSubject || undefined,
      generateSubject: shouldGenerateSubject,
      thread,
    };

    try {
      const response = (await chrome.runtime.sendMessage(request)) as GenerateDraftResponse;
      if (!response.ok) {
        throw new Error(response.error);
      }

      panelState.requestState = 'success';
      panelState.result = response.draft;
      panelState.error = '';
      if (shouldGenerateSubject) {
        panelState.suggestedSubject = response.subject ?? '';
        panelState.showSuggestedSubject = Boolean(panelState.suggestedSubject);
      }
    } catch (error) {
      panelState.requestState = 'error';
      panelState.error = error instanceof Error ? error.message : 'Could not generate a draft.';
    }

    syncState();
  }

  trigger.addEventListener('click', () => {
    open = !open;
    panel.hidden = !open;
    closePresetMenus();
    refreshSubject();
    if (open) {
      void loadPanelSettings();
      window.setTimeout(() => {
        if (!open) {
          return;
        }

        refreshSubject();
        refreshPosition();
      }, 180);
    }
    refreshPosition();
    if (open) {
      instructionInput.focus();
    }
  });

  for (const controls of splitControls.values()) {
    controls.primaryButton.addEventListener('click', () => {
      void runAction(controls.action);
    });

    controls.toggleButton.addEventListener('click', (event) => {
      event.stopPropagation();
      const shouldOpen = openMenuAction !== controls.action;
      closePresetMenus();
      if (!shouldOpen) {
        refreshPosition();
        return;
      }

      controls.menu.hidden = false;
      controls.toggleButton.dataset.open = 'true';
      controls.toggleButton.setAttribute('aria-expanded', 'true');
      openMenuAction = controls.action;
      refreshPosition();
    });
  }

  instructionInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || (!event.ctrlKey && !event.metaKey)) {
      return;
    }

    event.preventDefault();
    void runAction(event.shiftKey ? 'refine' : 'generate');
  });

  insertButton.addEventListener('click', () => {
    const text = resultOutput.value.trim();
    if (!text) {
      return;
    }

    bindings.insertDraft(bindings.editor, text);
    const suggestedSubject = subjectSuggestionInput.value.trim();
    const currentSubject = bindings.readSubject(bindings.editor).trim();
    const insertedSubject = Boolean(suggestedSubject) && !currentSubject;

    if (insertedSubject) {
      bindings.insertSubject(bindings.editor, suggestedSubject);
    }

    panelState.requestState = 'success';
    panelState.error = '';
    panelState.suggestedSubject = suggestedSubject;
    panelState.showSuggestedSubject = Boolean(suggestedSubject);
    status.textContent = insertedSubject ? 'Inserted draft and subject.' : 'Inserted into compose.';
  });

  subjectSuggestionInput.addEventListener('input', () => {
    panelState.suggestedSubject = subjectSuggestionInput.value;
  });

  copyButton.addEventListener('click', () => {
    const text = resultOutput.value.trim();
    if (!text) {
      return;
    }

    void copyText(text).then(() => {
      status.textContent = 'Copied to clipboard.';
    });
  });

  settingsButton.addEventListener('click', () => {
    void chrome.runtime
      .sendMessage({ type: 'email-assist:open-settings' })
      .then((response: OpenSettingsResponse | undefined) => {
        if (response && !response.ok) {
          panelState.requestState = 'error';
          panelState.error = response.error ?? 'Could not open Settings.';
          syncState();
          return;
        }

        status.textContent = 'Opened settings in a new tab.';
      })
      .catch((error: unknown) => {
        panelState.requestState = 'error';
        panelState.error = error instanceof Error ? error.message : 'Could not open Settings.';
        syncState();
      });
  });

  const handleStorageChange = (): void => {
    void loadPanelSettings();
  };

  const handlePointerDown = (event: Event): void => {
    if (!(event.target instanceof Node) || root.contains(event.target)) {
      return;
    }

    closePresetMenus();
  };

  const handleDocumentKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      closePresetMenus();
    }
  };

  const resizeObserver = new ResizeObserver(() => {
    refreshPosition();
  });

  resizeObserver.observe(mount);
  chrome.storage.onChanged.addListener(handleStorageChange);
  window.addEventListener('resize', refreshPosition);
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('keydown', handleDocumentKeyDown, true);
  document.addEventListener('scroll', refreshPosition, true);

  refreshSubject();
  renderPresetMenus();
  void loadPanelSettings();
  syncState();
  refreshPosition();

  return {
    cleanup() {
      resizeObserver.disconnect();
      chrome.storage.onChanged.removeListener(handleStorageChange);
      window.removeEventListener('resize', refreshPosition);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleDocumentKeyDown, true);
      document.removeEventListener('scroll', refreshPosition, true);
      root.remove();
    },
    refreshPosition,
  };
}
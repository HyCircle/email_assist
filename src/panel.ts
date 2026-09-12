import triggerIconUrl from '../icon.svg';

import { EXTENSION_NAME } from './constants';
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

function makeId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

function createTriggerIcon(): HTMLImageElement {
  const icon = document.createElement('img');
  icon.src = triggerIconUrl;
  icon.alt = '';
  icon.setAttribute('aria-hidden', 'true');
  return icon;
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

function attachRoot(root: HTMLElement, mount: AssistantMount): void {
  if (mount.kind === 'flow') {
    root.dataset.layout = 'strip';
    if (mount.before && mount.before.parentNode === mount.host) {
      mount.host.insertBefore(root, mount.before);
    } else {
      mount.host.append(root);
    }
    return;
  }

  root.dataset.layout = 'popover';
  document.body.append(root);
  const rect = mount.anchor.getBoundingClientRect();
  root.style.top = `${Math.round(rect.bottom + 8)}px`;
  root.style.left = `${Math.round(rect.left)}px`;
}

export function attachAssistantPanel(bindings: PanelBindings) {
  const mount = bindings.getAssistantMount(bindings.editor);
  const initialContext = bindings.composeKind === 'reply' ? bindings.getCurrentContext() : null;
  let session: DraftSession = createDraftSession(
    bindings.composeKind,
    initialContext ? [initialContext] : [],
    bindings.readDraft(bindings.editor),
  );
  let presetSettings: PresetSettings = { draftPresets: [], improvePresets: [] };
  let open = false;
  let currentContextDismissed = false;
  let requestSeq = 0;

  const root = document.createElement('div');
  root.className = 'ea-root';
  root.dataset.provider = bindings.provider;
  root.setAttribute('data-email-assist', 'true');

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ea-trigger';
  trigger.append(createTriggerIcon(), document.createTextNode('Assist'));
  trigger.setAttribute('aria-expanded', 'false');

  const triggerRow = document.createElement('div');
  triggerRow.className = 'ea-trigger-row';
  triggerRow.append(trigger);

  const panel = document.createElement('section');
  panel.className = 'ea-panel';
  panel.id = makeId('email-assist-panel');
  panel.hidden = true;
  panel.setAttribute('aria-label', `${EXTENSION_NAME} panel`);
  trigger.setAttribute('aria-controls', panel.id);

  const contextChips = document.createElement('div');
  contextChips.className = 'ea-context-chips';

  const addContextButton = document.createElement('button');
  addContextButton.type = 'button';
  addContextButton.className = 'ea-link-button';
  addContextButton.textContent = 'Context +';

  const contextRow = document.createElement('div');
  contextRow.className = 'ea-context-row';
  contextRow.append(contextChips, addContextButton);

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
  instructionInput.placeholder = 'Describe the message you want to write…';
  const instructionLabel = field('What should the email say?', instructionInput);

  const presetSelect = document.createElement('select');
  presetSelect.setAttribute('aria-label', 'Saved instructions');
  presetSelect.append(new Option('Presets', ''));

  const primaryButton = document.createElement('button');
  primaryButton.type = 'button';
  primaryButton.className = 'ea-primary-button';

  const draftActions = document.createElement('div');
  draftActions.className = 'ea-draft-actions';
  draftActions.append(primaryButton, presetSelect);

  const draftOutput = document.createElement('textarea');
  draftOutput.rows = 8;
  draftOutput.placeholder = 'Your draft will appear here.';
  const draftLabel = field('Draft', draftOutput);
  draftLabel.classList.add('ea-draft-field');

  const subjectInput = document.createElement('input');
  subjectInput.placeholder = 'Suggested subject';
  const subjectLabel = field('Suggested subject', subjectInput);

  const applyButton = document.createElement('button');
  applyButton.type = 'button';
  applyButton.className = 'ea-primary-button';
  applyButton.textContent = 'Apply';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'ea-secondary-button';
  copyButton.textContent = 'Copy';
  const startOverButton = document.createElement('button');
  startOverButton.type = 'button';
  startOverButton.className = 'ea-secondary-button';
  startOverButton.textContent = 'Start over';
  const reviewActions = document.createElement('div');
  reviewActions.className = 'ea-review-actions';
  reviewActions.append(applyButton, copyButton, startOverButton);

  const status = document.createElement('p');
  status.className = 'ea-status';
  status.setAttribute('role', 'status');
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'ea-link-button';
  settingsButton.textContent = 'Settings';
  const footer = document.createElement('div');
  footer.className = 'ea-footer';
  footer.append(status, settingsButton);

  panel.append(
    contextRow,
    contextForm,
    instructionLabel,
    draftActions,
    draftLabel,
    subjectLabel,
    reviewActions,
    footer,
  );
  root.append(triggerRow, panel);
  attachRoot(root, mount);

  function isLoading(): boolean {
    return session.phase === 'drafting' || session.phase === 'improving';
  }

  function renderPresets(): void {
    const presets = session.draft ? presetSettings.improvePresets : presetSettings.draftPresets;
    presetSelect.replaceChildren(new Option('Presets', ''));
    for (const preset of presets) {
      presetSelect.append(new Option(preset, preset));
    }
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
    primaryButton.textContent = getPrimaryActionLabel(session.phase, hasDraft);
    primaryButton.disabled = loading;
    if (draftOutput.value !== session.draft) {
      draftOutput.value = session.draft;
    }
    draftOutput.disabled = loading;
    if (subjectInput.value !== session.suggestedSubject) {
      subjectInput.value = session.suggestedSubject;
    }
    subjectLabel.hidden = !session.suggestedSubject;
    applyButton.disabled = loading || !hasDraft;
    copyButton.disabled = loading || !hasDraft;
    startOverButton.disabled = loading;
    draftLabel.hidden = !hasDraft;
    reviewActions.hidden = !hasDraft;
    presetSelect.disabled = loading;
    instructionInput.disabled = loading;
    addContextButton.disabled = loading;
    status.textContent = loading ? 'Writing…' : session.error;
    renderContexts();
    renderPresets();
  }

  function refreshCurrentContext(): void {
    if (
      bindings.composeKind !== 'reply' ||
      currentContextDismissed ||
      session.contexts.some((context) => context.kind === 'current-thread')
    ) {
      return;
    }

    const currentContext = bindings.getCurrentContext();
    if (currentContext) {
      session = setSessionContexts(session, [...session.contexts, currentContext]);
    }
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

    const seq = ++requestSeq;
    const action = session.draft.trim() ? 'improve' : 'draft';
    session = startDraftRequest(session);
    render();

    const request: DraftRequest = {
      type: 'email-assist:draft',
      provider: bindings.provider,
      composeKind: bindings.composeKind,
      action,
      instruction,
      draft: session.draft,
      subject: bindings.readSubject(bindings.editor),
      contexts: session.contexts,
      includeSubject: action === 'draft' && bindings.composeKind === 'new' && !bindings.readSubject(bindings.editor).trim(),
    };

    try {
      const response = (await chrome.runtime.sendMessage(request)) as DraftResponse | undefined;
      if (seq !== requestSeq || !root.isConnected) {
        return;
      }
      if (!response || !response.ok) {
        throw new Error(response?.error || 'Could not create a draft.');
      }

      session = finishDraftRequest(session, response.draft, response.suggestedSubject ?? '');
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
  }

  trigger.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    open = !open;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    if (open) {
      refreshCurrentContext();
      void loadPresets().catch((error: unknown) => {
        status.textContent = error instanceof Error ? error.message : 'Could not load saved instructions.';
      });
      render();
      instructionInput.focus();
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
    if (!existingSubject && session.suggestedSubject.trim()) {
      bindings.insertSubject(bindings.editor, session.suggestedSubject.trim());
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
    instructionInput.value = '';
    render();
    instructionInput.focus();
  });

  settingsButton.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'email-assist:open-settings' }).then((response: OpenSettingsResponse | undefined) => {
      if (response && !response.ok) {
        status.textContent = response.error ?? 'Could not open Settings.';
      }
    });
  });

  const handleStorageChange = (): void => {
    void loadPresets();
  };
  const handleEscape = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !open) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    open = false;
    panel.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
  };

  chrome.storage.onChanged.addListener(handleStorageChange);
  document.addEventListener('keydown', handleEscape, true);
  render();

  return {
    cleanup() {
      requestSeq += 1;
      chrome.storage.onChanged.removeListener(handleStorageChange);
      document.removeEventListener('keydown', handleEscape, true);
      root.remove();
    },
  };
}

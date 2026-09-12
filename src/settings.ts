import './settings.css';

import { COMMON_MODELS } from './constants';
import { getEndpointOriginPattern } from './llm';
import { getSettings, parseSettingsImport, resetSettings, saveSettings, serializeSettingsExport } from './storage';
import type { AssistantSettings, TestConnectionResponse } from './types';

const app = document.querySelector<HTMLDivElement>('#app');

function parseList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function listValue(values: string[]): string {
  return values.join('\n');
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function downloadSettings(text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `email-assistant-settings-${new Date().toISOString().replace(/:/g, '-')}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function buildLayout(): void {
  if (!app) return;

  app.innerHTML = `
    <main class="settings-shell">
      <header class="settings-hero">
        <p class="settings-kicker">Email Assistant</p>
        <h1>Local writing help for Gmail and Outlook</h1>
        <p>Configure the local llama.cpp connection and the writing defaults used by Draft and Improve.</p>
      </header>
      <form class="settings-card" id="settings-form">
        <section class="settings-section">
          <div class="settings-section-heading"><h2>Connection</h2><span id="permission-status" class="settings-badge">Checking…</span></div>
          <label><span>Base URL</span><input id="base-url" name="base-url" type="url" required /></label>
          <label><span>Model</span><select id="model-choice" name="model-choice"></select></label>
          <label id="custom-model-field" hidden><span>Custom model</span><input id="custom-model" name="custom-model" type="text" /></label>
          <label><span>Temperature</span><input id="temperature" name="temperature" type="number" min="0" max="2" step="0.1" required /></label>
          <div class="settings-actions"><button type="button" id="test-connection">Test connection</button></div>
          <p class="settings-note">Requests use <code>/chat/completions</code> under this base URL and never stream. Saving a custom endpoint asks Chrome for access to that endpoint origin.</p>
        </section>

        <section class="settings-section">
          <div class="settings-section-heading"><h2>Writing defaults</h2></div>
          <label><span>Default language</span><select id="language" name="language"><option value="english">English</option><option value="chinese">Chinese</option></select></label>
          <label><span>Style notes</span><textarea id="style-notes" name="style-notes" rows="3" placeholder="Concise, warm, and direct."></textarea></label>
          <label><span>Sign-off options</span><textarea id="sign-offs" name="sign-offs" rows="3" placeholder="One option per line."></textarea></label>
          <label><span>Signature block</span><textarea id="signature" name="signature" rows="3" placeholder="Optional fixed signature text."></textarea></label>
        </section>

        <section class="settings-section settings-preset-grid">
          <div><h2>Draft presets</h2><textarea id="draft-presets" rows="6" placeholder="One instruction per line."></textarea><p class="settings-note">Shown before the first draft.</p></div>
          <div><h2>Improve presets</h2><textarea id="improve-presets" rows="6" placeholder="One instruction per line."></textarea><p class="settings-note">Shown after a draft exists.</p></div>
        </section>

        <section class="settings-section settings-advanced">
          <div class="settings-section-heading"><h2>Advanced</h2><span>Transfer or restore settings</span></div>
          <div class="settings-actions"><button type="button" id="export-button">Export</button><button type="button" id="import-button">Import</button><button type="button" id="reset-button">Restore defaults</button></div>
          <input id="import-file" type="file" accept="application/json,.json" hidden />
        </section>

        <div class="settings-submit"><button type="submit" class="primary">Save settings</button><p id="status" class="settings-status" role="status">Ready.</p></div>
      </form>
    </main>`;
}

function setupModelOptions(): void {
  const select = document.querySelector<HTMLSelectElement>('#model-choice');
  if (!select) return;
  select.replaceChildren(...COMMON_MODELS.map((model) => new Option(model, model)), new Option('Custom model', 'custom'));
  select.addEventListener('change', () => {
    const customField = document.querySelector<HTMLElement>('#custom-model-field');
    if (customField) customField.hidden = select.value !== 'custom';
  });
}

function setFormValues(settings: AssistantSettings): void {
  const modelChoice = document.querySelector<HTMLSelectElement>('#model-choice');
  const customField = document.querySelector<HTMLElement>('#custom-model-field');
  const customModel = document.querySelector<HTMLInputElement>('#custom-model');
  if (!modelChoice || !customField || !customModel) return;

  modelChoice.value = COMMON_MODELS.includes(settings.model) ? settings.model : 'custom';
  customField.hidden = modelChoice.value !== 'custom';
  customModel.value = COMMON_MODELS.includes(settings.model) ? '' : settings.model;
  (document.querySelector<HTMLInputElement>('#base-url')!).value = settings.baseUrl;
  (document.querySelector<HTMLInputElement>('#temperature')!).value = String(settings.temperature);
  (document.querySelector<HTMLSelectElement>('#language')!).value = settings.defaultLanguage;
  (document.querySelector<HTMLTextAreaElement>('#style-notes')!).value = settings.styleNotes;
  (document.querySelector<HTMLTextAreaElement>('#sign-offs')!).value = listValue(settings.signOffOptions);
  (document.querySelector<HTMLTextAreaElement>('#signature')!).value = settings.signatureBlock;
  (document.querySelector<HTMLTextAreaElement>('#draft-presets')!).value = listValue(settings.draftPresets);
  (document.querySelector<HTMLTextAreaElement>('#improve-presets')!).value = listValue(settings.improvePresets);
}

function readFormValues(): AssistantSettings {
  const modelChoice = document.querySelector<HTMLSelectElement>('#model-choice')!;
  const customModel = document.querySelector<HTMLInputElement>('#custom-model')!;
  return {
    baseUrl: document.querySelector<HTMLInputElement>('#base-url')!.value.trim(),
    model: (modelChoice.value === 'custom' ? customModel.value : modelChoice.value).trim(),
    temperature: Number.parseFloat(document.querySelector<HTMLInputElement>('#temperature')!.value),
    defaultLanguage: document.querySelector<HTMLSelectElement>('#language')!.value === 'chinese' ? 'chinese' : 'english',
    styleNotes: document.querySelector<HTMLTextAreaElement>('#style-notes')!.value.trim(),
    signOffOptions: parseList(document.querySelector<HTMLTextAreaElement>('#sign-offs')!.value),
    signatureBlock: document.querySelector<HTMLTextAreaElement>('#signature')!.value.trim(),
    draftPresets: parseList(document.querySelector<HTMLTextAreaElement>('#draft-presets')!.value),
    improvePresets: parseList(document.querySelector<HTMLTextAreaElement>('#improve-presets')!.value),
  };
}

async function ensureEndpointAccess(baseUrl: string): Promise<string> {
  const pattern = getEndpointOriginPattern(baseUrl);
  if (!pattern) throw new Error('Base URL must be a valid http or https URL.');
  if (await chrome.permissions.contains({ origins: [pattern] })) return 'Endpoint access is ready.';
  if (!(await chrome.permissions.request({ origins: [pattern] }))) throw new Error('Endpoint permission was not granted.');
  return 'Endpoint access granted.';
}

async function updatePermissionStatus(baseUrl: string): Promise<void> {
  const status = document.querySelector<HTMLSpanElement>('#permission-status');
  if (!status) return;
  const pattern = getEndpointOriginPattern(baseUrl);
  const ready = Boolean(pattern && (await chrome.permissions.contains({ origins: [pattern] })));
  status.textContent = ready ? 'Access ready' : 'Access needed';
  status.dataset.ready = String(ready);
}

async function main(): Promise<void> {
  if (!app) return;
  buildLayout();
  setupModelOptions();

  const status = document.querySelector<HTMLParagraphElement>('#status')!;
  const form = document.querySelector<HTMLFormElement>('#settings-form')!;
  const current = await getSettings();
  setFormValues(current);
  await updatePermissionStatus(current.baseUrl);

  document.querySelector<HTMLInputElement>('#base-url')!.addEventListener('input', () => {
    void updatePermissionStatus(document.querySelector<HTMLInputElement>('#base-url')!.value.trim());
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = 'Saving…';
    try {
      const values = readFormValues();
      if (!values.baseUrl || !values.model) throw new Error('Base URL and model are required.');
      await ensureEndpointAccess(values.baseUrl);
      setFormValues(await saveSettings(values));
      await updatePermissionStatus(values.baseUrl);
      status.textContent = 'Settings saved.';
    } catch (error) {
      status.textContent = errorMessage(error, 'Could not save settings.');
    }
  });

  document.querySelector<HTMLButtonElement>('#test-connection')!.addEventListener('click', async () => {
    status.textContent = 'Testing connection…';
    try {
      const baseUrl = document.querySelector<HTMLInputElement>('#base-url')!.value.trim();
      if (!baseUrl) throw new Error('Base URL is required.');
      await ensureEndpointAccess(baseUrl);
      const response = (await chrome.runtime.sendMessage({
        type: 'email-assist:test-connection',
        baseUrl,
      })) as TestConnectionResponse | undefined;
      if (!response?.ok) throw new Error(response?.error || 'Connection failed.');
      status.textContent = 'Connection successful.';
    } catch (error) {
      status.textContent = errorMessage(error, 'Could not test the connection.');
    }
  });

  document.querySelector<HTMLButtonElement>('#reset-button')!.addEventListener('click', async () => {
    const restored = await resetSettings();
    setFormValues(restored);
    await updatePermissionStatus(restored.baseUrl);
    status.textContent = 'Defaults restored.';
  });

  document.querySelector<HTMLButtonElement>('#export-button')!.addEventListener('click', () => {
    downloadSettings(serializeSettingsExport(readFormValues()));
    status.textContent = 'Settings exported.';
  });

  const fileInput = document.querySelector<HTMLInputElement>('#import-file')!;
  document.querySelector<HTMLButtonElement>('#import-button')!.addEventListener('click', () => {
    fileInput.value = '';
    fileInput.click();
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      const imported = parseSettingsImport(await file.text());
      await ensureEndpointAccess(imported.baseUrl);
      setFormValues(await saveSettings(imported));
      await updatePermissionStatus(imported.baseUrl);
      status.textContent = 'Settings imported.';
    } catch (error) {
      status.textContent = errorMessage(error, 'Could not import settings.');
    } finally {
      fileInput.value = '';
    }
  });
}

void main();

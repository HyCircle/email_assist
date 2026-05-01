import './settings.css';

import { getDefaultSettings } from './constants';
import { getEndpointOriginPattern } from './llm';
import { getSettings, parseSettingsImport, resetSettings, saveSettings, serializeSettingsExport } from './storage';
import type { AssistantSettings } from './types';

const app = document.querySelector<HTMLDivElement>('#app');

function formatPresetList(values: string[]): string {
  return values.join('\n');
}

function parsePresetList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function downloadTextFile(fileName: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function buildExportFileName(): string {
  return `email-assistant-settings-${new Date().toISOString().replace(/[:]/g, '-')}.json`;
}

function buildLayout(defaultSettings: AssistantSettings): string {
  const safeDefaults = {
    endpoint: defaultSettings.endpoint || '(empty)',
    model: defaultSettings.model || '(empty)',
    temperature: String(defaultSettings.temperature),
    defaultLanguage: defaultSettings.defaultLanguage === 'chinese' ? 'Chinese' : 'English',
  };

  return `
    <main class="settings-shell">
      <section class="settings-hero">
        <p class="settings-kicker">Email Assistant</p>
        <h1>Local-first config for Gmail and Outlook Web</h1>
        <p class="settings-copy">
          Runtime settings are stored in Chrome storage. Build defaults come from your local <code>.env.local</code>,
          so the repo can stay public without baking private endpoints into tracked files.
        </p>
        <dl class="settings-defaults">
          <div>
            <dt>Default endpoint</dt>
            <dd>${safeDefaults.endpoint}</dd>
          </div>
          <div>
            <dt>Default model</dt>
            <dd>${safeDefaults.model}</dd>
          </div>
          <div>
            <dt>Default temperature</dt>
            <dd>${safeDefaults.temperature}</dd>
          </div>
          <div>
            <dt>Default language</dt>
            <dd>${safeDefaults.defaultLanguage}</dd>
          </div>
        </dl>
      </section>

      <form class="settings-card" id="settings-form">
        <label>
          <span>API endpoint</span>
          <input id="endpoint" name="endpoint" type="url" placeholder="http://localhost:8070/v1/chat/completions" required />
        </label>

        <label>
          <span>Model name</span>
          <input id="model" name="model" type="text" placeholder="Qwen3.6-35B-A3B-Q4_K_S-Agent" required />
        </label>

        <label>
          <span>Temperature</span>
          <input id="temperature" name="temperature" type="number" min="0" max="2" step="0.1" required />
        </label>

        <label>
          <span>Default email language</span>
          <select id="defaultLanguage" name="defaultLanguage">
            <option value="english">English</option>
            <option value="chinese">Chinese</option>
          </select>
        </label>

        <div class="settings-presets">
          <label>
            <span>Generate presets</span>
            <textarea id="generatePresets" name="generatePresets" rows="5" placeholder="One preset per line."></textarea>
            <small class="settings-note">One preset per line. Choosing a Generate preset from the panel runs it immediately.</small>
          </label>

          <label>
            <span>Refine presets</span>
            <textarea id="refinePresets" name="refinePresets" rows="5" placeholder="One preset per line."></textarea>
            <small class="settings-note">One preset per line. Choosing a Refine preset from the panel runs it immediately.</small>
          </label>

          <label>
            <span>Sign-off options</span>
            <textarea id="signOffOptions" name="signOffOptions" rows="5" placeholder="One sign-off per line, such as Thanks, or Best regards,"></textarea>
            <small class="settings-note">One option per line. The model will choose the best fit for the email.</small>
          </label>

          <label>
            <span>Signature block</span>
            <textarea id="signatureBlock" name="signatureBlock" rows="5" placeholder="Your name, title, phone, or any fixed signature text."></textarea>
            <small class="settings-note">This block is appended after the chosen sign-off unless you ask the model not to include it.</small>
          </label>
        </div>

        <label>
          <span>Style notes</span>
          <textarea id="styleNotes" name="styleNotes" rows="5" placeholder="Optional guidance such as concise, warm, and direct."></textarea>
        </label>

        <label>
          <span>API key</span>
          <input id="apiKey" name="apiKey" type="password" placeholder="Leave blank for llama.cpp or other local servers." />
        </label>

        <div class="settings-actions">
          <button type="submit" class="primary">Save settings</button>
          <button type="button" id="reset-button">Reset to build defaults</button>
          <button type="button" id="permission-button">Grant endpoint access</button>
          <button type="button" id="export-button">Export settings</button>
          <button type="button" id="import-button">Import settings</button>
        </div>

        <input id="import-file" type="file" accept="application/json,.json" hidden />

        <p class="settings-status" id="status" role="status">Ready.</p>
      </form>
    </main>
  `;
}

function setFormValues(form: HTMLFormElement, settings: AssistantSettings): void {
  (form.elements.namedItem('endpoint') as HTMLInputElement).value = settings.endpoint;
  (form.elements.namedItem('model') as HTMLInputElement).value = settings.model;
  (form.elements.namedItem('temperature') as HTMLInputElement).value = String(settings.temperature);
  (form.elements.namedItem('defaultLanguage') as HTMLSelectElement).value = settings.defaultLanguage;
  (form.elements.namedItem('generatePresets') as HTMLTextAreaElement).value = formatPresetList(settings.generatePresets);
  (form.elements.namedItem('refinePresets') as HTMLTextAreaElement).value = formatPresetList(settings.refinePresets);
  (form.elements.namedItem('signOffOptions') as HTMLTextAreaElement).value = formatPresetList(settings.signOffOptions);
  (form.elements.namedItem('signatureBlock') as HTMLTextAreaElement).value = settings.signatureBlock;
  (form.elements.namedItem('styleNotes') as HTMLTextAreaElement).value = settings.styleNotes;
  (form.elements.namedItem('apiKey') as HTMLInputElement).value = settings.apiKey;
}

function readFormValues(form: HTMLFormElement): AssistantSettings {
  return {
    endpoint: (form.elements.namedItem('endpoint') as HTMLInputElement).value.trim(),
    model: (form.elements.namedItem('model') as HTMLInputElement).value.trim(),
    temperature: Number.parseFloat((form.elements.namedItem('temperature') as HTMLInputElement).value),
    defaultLanguage: (form.elements.namedItem('defaultLanguage') as HTMLSelectElement).value === 'chinese' ? 'chinese' : 'english',
    generatePresets: parsePresetList((form.elements.namedItem('generatePresets') as HTMLTextAreaElement).value),
    refinePresets: parsePresetList((form.elements.namedItem('refinePresets') as HTMLTextAreaElement).value),
    signOffOptions: parsePresetList((form.elements.namedItem('signOffOptions') as HTMLTextAreaElement).value),
    signatureBlock: (form.elements.namedItem('signatureBlock') as HTMLTextAreaElement).value.trim(),
    styleNotes: (form.elements.namedItem('styleNotes') as HTMLTextAreaElement).value.trim(),
    apiKey: (form.elements.namedItem('apiKey') as HTMLInputElement).value.trim(),
  };
}

async function ensureEndpointAccess(endpoint: string): Promise<string> {
  const originPattern = getEndpointOriginPattern(endpoint);

  if (!originPattern) {
    throw new Error('Endpoint must be a valid http or https URL.');
  }

  const alreadyGranted = await chrome.permissions.contains({ origins: [originPattern] });

  if (alreadyGranted) {
    return 'Endpoint access already granted.';
  }

  const granted = await chrome.permissions.request({ origins: [originPattern] });

  if (!granted) {
    throw new Error('Endpoint permission was not granted.');
  }

  return 'Endpoint permission granted.';
}

async function main(): Promise<void> {
  if (!app) {
    return;
  }

  const defaultSettings = getDefaultSettings();
  app.innerHTML = buildLayout(defaultSettings);

  const form = document.querySelector<HTMLFormElement>('#settings-form');
  const status = document.querySelector<HTMLParagraphElement>('#status');
  const resetButton = document.querySelector<HTMLButtonElement>('#reset-button');
  const permissionButton = document.querySelector<HTMLButtonElement>('#permission-button');
  const exportButton = document.querySelector<HTMLButtonElement>('#export-button');
  const importButton = document.querySelector<HTMLButtonElement>('#import-button');
  const importFileInput = document.querySelector<HTMLInputElement>('#import-file');

  if (!form || !status || !resetButton || !permissionButton || !exportButton || !importButton || !importFileInput) {
    return;
  }

  setFormValues(form, await getSettings());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    status.textContent = 'Saving settings...';

    try {
      const settings = readFormValues(form);
      await ensureEndpointAccess(settings.endpoint);
      const savedSettings = await saveSettings(settings);
      setFormValues(form, savedSettings);
      status.textContent = 'Settings saved.';
    } catch (error) {
      status.textContent = toErrorMessage(error, 'Could not save settings.');
    }
  });

  resetButton.addEventListener('click', async () => {
    status.textContent = 'Restoring build defaults...';

    try {
      const restored = await resetSettings();
      setFormValues(form, restored);
      status.textContent = 'Build defaults restored.';
    } catch (error) {
      status.textContent = toErrorMessage(error, 'Could not reset settings.');
    }
  });

  permissionButton.addEventListener('click', async () => {
    status.textContent = 'Requesting endpoint permission...';

    try {
      const settings = readFormValues(form);
      status.textContent = await ensureEndpointAccess(settings.endpoint);
    } catch (error) {
      status.textContent = toErrorMessage(error, 'Could not request endpoint access.');
    }
  });

  exportButton.addEventListener('click', () => {
    try {
      const settings = readFormValues(form);
      downloadTextFile(buildExportFileName(), serializeSettingsExport(settings));
      status.textContent = 'Settings exported.';
    } catch (error) {
      status.textContent = toErrorMessage(error, 'Could not export settings.');
    }
  });

  importButton.addEventListener('click', () => {
    importFileInput.value = '';
    importFileInput.click();
  });

  importFileInput.addEventListener('change', async () => {
    const file = importFileInput.files?.[0];
    if (!file) {
      return;
    }

    status.textContent = 'Importing settings...';

    try {
      const importedSettings = parseSettingsImport(await file.text());

      if (importedSettings.endpoint) {
        await ensureEndpointAccess(importedSettings.endpoint);
      }

      const savedSettings = await saveSettings(importedSettings);
      setFormValues(form, savedSettings);
      status.textContent = 'Settings imported.';
    } catch (error) {
      status.textContent = toErrorMessage(error, 'Could not import settings.');
    } finally {
      importFileInput.value = '';
    }
  });
}

void main();
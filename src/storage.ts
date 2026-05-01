import { SETTINGS_STORAGE_KEY, getDefaultSettings } from './constants';
import type { AssistantSettings, AssistantSettingsExport, EmailLanguage } from './types';

function normalizeTemperature(candidate: unknown, fallback: number): number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    return fallback;
  }

  return Math.min(2, Math.max(0, candidate));
}

function normalizeLanguage(candidate: unknown, fallback: EmailLanguage): EmailLanguage {
  return candidate === 'chinese' || candidate === 'english' ? candidate : fallback;
}

function normalizePresetList(candidate: unknown, fallback: string[]): string[] {
  const source = Array.isArray(candidate) ? candidate : fallback;

  return Array.from(
    new Set(
      source
        .map((value) => (typeof value === 'string' ? value.trim() : ''))
        .filter((value) => value.length > 0),
    ),
  ).slice(0, 12);
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return Boolean(candidate) && typeof candidate === 'object' && !Array.isArray(candidate);
}

function setStoredSettings(settings: AssistantSettings): Promise<void> {
  return chrome.storage.sync.set({ [SETTINGS_STORAGE_KEY]: settings });
}

export function normalizeSettings(candidate?: Partial<AssistantSettings> | null): AssistantSettings {
  const defaults = getDefaultSettings();

  return {
    endpoint: typeof candidate?.endpoint === 'string' ? candidate.endpoint.trim() : defaults.endpoint,
    model: typeof candidate?.model === 'string' ? candidate.model.trim() : defaults.model,
    temperature: normalizeTemperature(candidate?.temperature, defaults.temperature),
    styleNotes: typeof candidate?.styleNotes === 'string' ? candidate.styleNotes.trim() : defaults.styleNotes,
    apiKey: typeof candidate?.apiKey === 'string' ? candidate.apiKey.trim() : defaults.apiKey,
    defaultLanguage: normalizeLanguage(candidate?.defaultLanguage, defaults.defaultLanguage),
    generatePresets: normalizePresetList(candidate?.generatePresets, defaults.generatePresets),
    refinePresets: normalizePresetList(candidate?.refinePresets, defaults.refinePresets),
    signOffOptions: normalizePresetList(candidate?.signOffOptions, defaults.signOffOptions),
    signatureBlock:
      typeof candidate?.signatureBlock === 'string' ? candidate.signatureBlock.trim() : defaults.signatureBlock,
  };
}

export function serializeSettingsExport(candidate: AssistantSettings, exportedAt = new Date().toISOString()): string {
  const payload = {
    version: 1,
    exportedAt,
    settings: normalizeSettings(candidate),
  } satisfies AssistantSettingsExport;

  return JSON.stringify(payload, null, 2);
}

export function parseSettingsImport(text: string): AssistantSettings {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Imported file is not valid JSON.');
  }

  const candidate = isRecord(parsed) && 'settings' in parsed ? parsed.settings : parsed;

  if (!isRecord(candidate)) {
    throw new Error('Imported file does not contain valid settings.');
  }

  return normalizeSettings(candidate as Partial<AssistantSettings>);
}

export async function getSettings(): Promise<AssistantSettings> {
  const stored = await chrome.storage.sync.get(SETTINGS_STORAGE_KEY);
  return normalizeSettings(stored[SETTINGS_STORAGE_KEY] as Partial<AssistantSettings> | undefined);
}

export async function saveSettings(candidate: AssistantSettings): Promise<AssistantSettings> {
  const normalized = normalizeSettings(candidate);
  await setStoredSettings(normalized);
  return normalized;
}

export async function resetSettings(): Promise<AssistantSettings> {
  const defaults = normalizeSettings(getDefaultSettings());
  await setStoredSettings(defaults);
  return defaults;
}

export async function ensureSettingsInitialized(): Promise<AssistantSettings> {
  const settings = await getSettings();
  await setStoredSettings(settings);
  return settings;
}
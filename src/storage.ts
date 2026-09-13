import {
  getDefaultSettings,
  MAX_SIGNATURE_CHARS,
  MAX_SYSTEM_PROMPT_CHARS,
  MAX_STYLE_NOTES_CHARS,
  SETTINGS_EXPORT_VERSION,
  SETTINGS_STORAGE_KEY,
} from './constants';
import type {
  AssistantSettings,
  AssistantSettingsExport,
  CompatibilityMode,
  EmailLanguage,
  ReasoningEffort,
} from './types';

function normalizeBaseUrl(candidate: unknown, fallback: string): string {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    return fallback;
  }

  return candidate.trim().replace(/\/+$/, '');
}

function normalizeTemperature(candidate: unknown, fallback: number): number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    return fallback;
  }

  return Math.min(2, Math.max(0, candidate));
}

function normalizeInteger(candidate: unknown, fallback: number, minimum: number, maximum: number): number {
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    return fallback;
  }

  return Math.round(Math.min(maximum, Math.max(minimum, candidate)));
}

function normalizeBoundedText(candidate: unknown, fallback: string, maximum: number): string {
  return typeof candidate === 'string' ? candidate.trim().slice(0, maximum) : fallback;
}

function normalizeCompatibilityMode(candidate: unknown, fallback: CompatibilityMode): CompatibilityMode {
  return candidate === 'llama.cpp' || candidate === 'openai-compatible' ? candidate : fallback;
}

function normalizeReasoningEffort(candidate: unknown, fallback: ReasoningEffort): ReasoningEffort {
  return candidate === 'none' || candidate === 'low' || candidate === 'medium' || candidate === 'high' ? candidate : fallback;
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
    baseUrl: normalizeBaseUrl(candidate?.baseUrl, defaults.baseUrl),
    model: typeof candidate?.model === 'string' ? candidate.model.trim() : defaults.model,
    apiKey: normalizeBoundedText(candidate?.apiKey, defaults.apiKey, 500),
    compatibilityMode: normalizeCompatibilityMode(candidate?.compatibilityMode, defaults.compatibilityMode),
    temperature: normalizeTemperature(candidate?.temperature, defaults.temperature),
    maxOutputTokens: normalizeInteger(candidate?.maxOutputTokens, defaults.maxOutputTokens, 128, 8192),
    reasoningEffort: normalizeReasoningEffort(candidate?.reasoningEffort, defaults.reasoningEffort),
    enableThinking: typeof candidate?.enableThinking === 'boolean' ? candidate.enableThinking : defaults.enableThinking,
    systemPrompt: normalizeBoundedText(candidate?.systemPrompt, defaults.systemPrompt, MAX_SYSTEM_PROMPT_CHARS) || defaults.systemPrompt,
    styleNotes: normalizeBoundedText(candidate?.styleNotes, defaults.styleNotes, MAX_STYLE_NOTES_CHARS),
    defaultLanguage: normalizeLanguage(candidate?.defaultLanguage, defaults.defaultLanguage),
    draftPresets: normalizePresetList(candidate?.draftPresets, defaults.draftPresets),
    improvePresets: normalizePresetList(candidate?.improvePresets, defaults.improvePresets),
    signOffOptions: normalizePresetList(candidate?.signOffOptions, defaults.signOffOptions),
    signatureBlock: normalizeBoundedText(candidate?.signatureBlock, defaults.signatureBlock, MAX_SIGNATURE_CHARS),
  };
}

export function serializeSettingsExport(candidate: AssistantSettings, exportedAt = new Date().toISOString()): string {
  const payload = {
    version: SETTINGS_EXPORT_VERSION,
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

  const envelope = isRecord(parsed) && 'settings' in parsed ? parsed : null;
  if (envelope && envelope.version !== SETTINGS_EXPORT_VERSION) {
    throw new Error(`Unsupported settings export version: ${String(envelope.version ?? 'missing')}.`);
  }

  const candidate = envelope ? envelope.settings : parsed;
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

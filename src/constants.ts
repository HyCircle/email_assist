import type { AssistantSettings } from './types';

export const EXTENSION_NAME = 'Email Assistant';
export const SETTINGS_STORAGE_KEY = 'emailAssistantSettings.v3';
export const SETTINGS_EXPORT_VERSION = 2;
export const DEFAULT_BASE_URL = 'http://pc-yh:8070/v1';
export const DEFAULT_MODEL = 'Qwen3.8-27B-Q4';
export const COMMON_MODELS = ['Qwen3.8-27B-Q4', 'gemma-4-26B-A4B-QAT'];
export const MAX_CONTEXT_ITEMS = 6;
export const MAX_CONTEXT_ITEM_CHARS = 7000;
export const MAX_CONTEXT_PROMPT_CHARS = 24_000;
export const MAX_DRAFT_CHARS = 6000;
export const MAX_INSTRUCTION_CHARS = 4000;
export const REQUEST_TIMEOUT_MS = 45_000;

export const DEFAULT_DRAFT_PRESETS = ['Reply politely and propose Friday afternoon.'];
export const DEFAULT_IMPROVE_PRESETS = [
  'Shorten this while keeping the important details.',
  'Make this more formal and direct.',
  'Make this warmer without adding unnecessary wording.',
];
export const DEFAULT_SIGN_OFF_OPTIONS: string[] = [];
export const DEFAULT_SIGNATURE_BLOCK = '';

export function getDefaultSettings(): AssistantSettings {
  return {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    temperature: 0.2,
    styleNotes: '',
    defaultLanguage: 'english',
    draftPresets: [...DEFAULT_DRAFT_PRESETS],
    improvePresets: [...DEFAULT_IMPROVE_PRESETS],
    signOffOptions: [...DEFAULT_SIGN_OFF_OPTIONS],
    signatureBlock: DEFAULT_SIGNATURE_BLOCK,
  };
}

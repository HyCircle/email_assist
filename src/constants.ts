import type { AssistantSettings } from './types';

export const EXTENSION_NAME = 'Email Assistant';
export const SETTINGS_STORAGE_KEY = 'emailAssistantSettings';
export const MAX_THREAD_CHARS = 12000;
export const MAX_DRAFT_CHARS = 6000;

export const DEFAULT_GENERATE_PRESETS = [
  'Reply politely and propose Friday afternoon.',
];

export const DEFAULT_REFINE_PRESETS = [
  'Rewrite shorter and firmer.',
  'Clarify the next steps in plain language.',
];

export const DEFAULT_SIGN_OFF_OPTIONS: string[] = [];
export const DEFAULT_SIGNATURE_BLOCK = '';

function parseTemperature(candidate: string | undefined): number {
  const parsed = Number.parseFloat(candidate ?? '0.2');
  if (!Number.isFinite(parsed)) {
    return 0.2;
  }

  return Math.min(2, Math.max(0, parsed));
}

export function getDefaultSettings(): AssistantSettings {
  return {
    endpoint: import.meta.env.VITE_DEFAULT_LLM_ENDPOINT?.trim() ?? '',
    model: import.meta.env.VITE_DEFAULT_LLM_MODEL?.trim() ?? '',
    temperature: parseTemperature(import.meta.env.VITE_DEFAULT_LLM_TEMPERATURE),
    styleNotes: import.meta.env.VITE_DEFAULT_STYLE_NOTES?.trim() ?? '',
    apiKey: import.meta.env.VITE_DEFAULT_API_KEY?.trim() ?? '',
    defaultLanguage: 'english',
    generatePresets: [...DEFAULT_GENERATE_PRESETS],
    refinePresets: [...DEFAULT_REFINE_PRESETS],
    signOffOptions: [...DEFAULT_SIGN_OFF_OPTIONS],
    signatureBlock: DEFAULT_SIGNATURE_BLOCK,
  };
}
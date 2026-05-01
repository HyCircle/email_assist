export type ProviderName = 'gmail' | 'outlook';
export type AssistAction = 'generate' | 'refine';
export type RequestState = 'idle' | 'loading' | 'success' | 'error';
export type EmailLanguage = 'english' | 'chinese';

export interface EmailMessage {
  sender: string;
  date: string;
  body: string;
}

export interface ThreadContext {
  provider: ProviderName;
  subject: string;
  participants: string[];
  messages: EmailMessage[];
  sourceUrl: string;
}

export interface AssistantSettings {
  endpoint: string;
  model: string;
  temperature: number;
  styleNotes: string;
  apiKey: string;
  defaultLanguage: EmailLanguage;
  generatePresets: string[];
  refinePresets: string[];
  signOffOptions: string[];
  signatureBlock: string;
}

export interface AssistantSettingsExport {
  version: 1;
  exportedAt: string;
  settings: AssistantSettings;
}

export interface AssistantAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface GenerateDraftRequest {
  type: 'email-assist:generate';
  provider: ProviderName;
  action: AssistAction;
  instruction: string;
  currentDraft?: string;
  currentSubject?: string;
  generateSubject?: boolean;
  thread: ThreadContext;
}

export interface GenerateDraftSuccess {
  ok: true;
  draft: string;
  subject?: string;
}

export interface GenerateDraftFailure {
  ok: false;
  error: string;
}

export type GenerateDraftResponse = GenerateDraftSuccess | GenerateDraftFailure;

export interface OpenSettingsRequest {
  type: 'email-assist:open-settings';
}

export interface OpenSettingsResponse {
  ok: boolean;
  error?: string;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
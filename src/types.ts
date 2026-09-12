export type ProviderName = 'gmail' | 'outlook';
export type ComposeKind = 'new' | 'reply';
export type DraftAction = 'draft' | 'improve';
export type DraftPhase = 'idle' | 'drafting' | 'ready' | 'improving' | 'error';
export type EmailLanguage = 'english' | 'chinese';

export interface EmailMessage {
  sender: string;
  date: string;
  body: string;
}

export interface ContextItem {
  id: string;
  kind: 'current-thread' | 'pasted';
  provider: ProviderName;
  subject: string;
  participants: string[];
  messages: EmailMessage[];
  label: string;
}

export interface DraftSession {
  composeKind: ComposeKind;
  contexts: ContextItem[];
  draft: string;
  suggestedSubject: string;
  phase: DraftPhase;
  error: string;
}

export interface AssistantSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  styleNotes: string;
  defaultLanguage: EmailLanguage;
  draftPresets: string[];
  improvePresets: string[];
  signOffOptions: string[];
  signatureBlock: string;
}

export interface AssistantSettingsExport {
  version: 2;
  exportedAt: string;
  settings: AssistantSettings;
}

export interface DraftRequest {
  type: 'email-assist:draft';
  provider: ProviderName;
  composeKind: ComposeKind;
  action: DraftAction;
  instruction: string;
  draft: string;
  subject: string;
  contexts: ContextItem[];
  includeSubject: boolean;
}

export interface DraftSuccess {
  ok: true;
  draft: string;
  suggestedSubject?: string;
  subjectError?: string;
}

export interface DraftFailure {
  ok: false;
  error: string;
}

export type DraftResponse = DraftSuccess | DraftFailure;

export interface OpenSettingsRequest {
  type: 'email-assist:open-settings';
}

export interface OpenSettingsResponse {
  ok: boolean;
  error?: string;
}

export interface TestConnectionRequest {
  type: 'email-assist:test-connection';
  baseUrl: string;
}

export interface TestConnectionResponse {
  ok: boolean;
  error?: string;
}

export type AssistantMount =
  | { kind: 'flow'; host: HTMLElement; before: HTMLElement | null }
  | { kind: 'popover'; anchor: HTMLElement };

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type ProviderName = 'gmail' | 'outlook';
export type ComposeKind = 'new' | 'reply';
export type DraftAction = 'draft' | 'improve';
export type DraftPhase = 'idle' | 'drafting' | 'ready' | 'improving' | 'error';
export type EmailLanguage = 'english' | 'chinese';
export type CompatibilityMode = 'llama.cpp' | 'openai-compatible';
export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

export interface EmailMessage {
  sender: string;
  date: string;
  body: string;
}

export interface ContextAttachment {
  name: string;
  kind: 'image' | 'file';
  mediaType: string;
  size: string;
  dataUrl?: string;
  sourceUrl?: string;
  temporary?: boolean;
}

export interface ContextItem {
  id: string;
  kind: 'current-thread' | 'pasted';
  provider: ProviderName;
  subject: string;
  participants: string[];
  messages: EmailMessage[];
  label: string;
  attachments?: ContextAttachment[];
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
  apiKey: string;
  compatibilityMode: CompatibilityMode;
  temperature: number;
  maxOutputTokens: number;
  reasoningEffort: ReasoningEffort;
  enableThinking: boolean;
  systemPrompt: string;
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
  requestId: string;
  provider: ProviderName;
  composeKind: ComposeKind;
  action: DraftAction;
  instruction: string;
  draft: string;
  subject: string;
  contexts: ContextItem[];
  attachments: ContextAttachment[];
  writer?: string;
}

export interface DraftSuccess {
  ok: true;
  draft: string;
  suggestedSubject?: string;
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
  apiKey: string;
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
  content: string | LlmContentPart[];
}

export type LlmContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'auto' | 'high' } };

export interface CancelDraftRequest {
  type: 'email-assist:cancel-draft';
  requestId: string;
}

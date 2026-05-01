import { MAX_DRAFT_CHARS, MAX_THREAD_CHARS } from './constants';
import type { AssistantSettings, EmailLanguage, EmailMessage, GenerateDraftRequest, LlmMessage } from './types';

function normalizeBlock(text: string): string {
  return text
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function trimToLimit(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, maxChars).trim()}\n[truncated]`;
}

function formatMessage(message: EmailMessage, index: number): string {
  const headerParts = [`Message ${index + 1}`, `From: ${message.sender}`];
  if (message.date) {
    headerParts.push(`Date: ${message.date}`);
  }

  return `${headerParts.join(' | ')}\n${normalizeBlock(message.body)}`;
}

function languageLabel(language: EmailLanguage): string {
  return language === 'chinese' ? 'Chinese' : 'English';
}

function buildWritingPreferenceSections(settings: AssistantSettings): string[] {
  const sections: string[] = [];

  if (settings.signOffOptions.length > 0) {
    sections.push(
      `When a sign-off is appropriate, choose the best fit from these options: ${settings.signOffOptions.join(' | ')}.`,
    );
  }

  if (settings.signatureBlock) {
    sections.push(
      `After the sign-off, append this exact signature block unless the instruction explicitly says to omit it:\n${normalizeBlock(settings.signatureBlock)}`,
    );
  }

  return sections;
}

export function buildChatMessages(
  request: GenerateDraftRequest,
  settings: AssistantSettings,
): LlmMessage[] {
  const transcript = request.thread.messages.map(formatMessage).join('\n\n---\n\n');
  const safeTranscript = transcript ? trimToLimit(transcript, MAX_THREAD_CHARS) : '(no visible thread context)';
  const safeDraft = request.currentDraft ? trimToLimit(normalizeBlock(request.currentDraft), MAX_DRAFT_CHARS) : '';
  const styleNotes = settings.styleNotes ? `Preferred writing style: ${settings.styleNotes}` : 'Preferred writing style: clear, direct, and useful.';
  const defaultLanguageInstruction =
    settings.defaultLanguage === 'chinese'
      ? 'Default email language: Chinese. Write in Chinese unless the instruction clearly asks for another language.'
      : 'Default email language: English. Write in English unless the instruction clearly asks for another language.';
  const actionHint =
    request.action === 'refine'
      ? 'Refine the current draft using the instruction and the thread context.'
      : 'Draft a new reply or outbound message using the instruction and the thread context.';

  const systemPrompt = [
    'You are a careful email writing assistant.',
    'Return plain text only.',
    'Do not output HTML, Markdown fences, or explanations unless explicitly requested.',
    'Do not claim actions were taken or emails were sent.',
    'If context is incomplete, write a reasonable draft and keep assumptions minimal.',
    defaultLanguageInstruction,
    styleNotes,
    ...buildWritingPreferenceSections(settings),
  ].join(' ');

  const userPromptSections = [
    `Provider: ${request.provider}`,
    `Action: ${request.action}`,
    `Task: ${actionHint}`,
    `Default language: ${languageLabel(settings.defaultLanguage)}`,
    `Instruction:\n${normalizeBlock(request.instruction)}`,
    `Subject: ${request.thread.subject || '(unknown subject)'}`,
    `Participants: ${request.thread.participants.join(', ') || '(unknown participants)'}`,
    `Visible thread transcript:\n${safeTranscript}`,
  ];

  if (safeDraft) {
    userPromptSections.push(`Current draft:\n${safeDraft}`);
  }

  userPromptSections.push('Write the email body only. Do not add a subject line unless the instruction explicitly asks for one.');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPromptSections.join('\n\n') },
  ];
}

export function buildSubjectMessages(
  request: GenerateDraftRequest,
  draftBody: string,
  settings: AssistantSettings,
): LlmMessage[] {
  const safeDraft = trimToLimit(normalizeBlock(draftBody), MAX_DRAFT_CHARS);
  const transcript = request.thread.messages.map(formatMessage).join('\n\n---\n\n');
  const safeTranscript = transcript ? trimToLimit(transcript, MAX_THREAD_CHARS) : '(no visible thread context)';
  const languageInstruction =
    settings.defaultLanguage === 'chinese'
      ? 'Write the subject in Chinese unless the instruction clearly asks for another language.'
      : 'Write the subject in English unless the instruction clearly asks for another language.';

  return [
    {
      role: 'system',
      content: [
        'You write concise email subject lines.',
        'Return only the subject line text.',
        'Do not include quotes, bullets, numbering, or a `Subject:` label.',
        'Do not add Re:, Fwd:, or similar prefixes.',
        languageInstruction,
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Provider: ${request.provider}`,
        `Instruction:\n${normalizeBlock(request.instruction)}`,
        `Participants: ${request.thread.participants.join(', ') || '(unknown participants)'}`,
        `Visible thread transcript:\n${safeTranscript}`,
        `Generated email body:\n${safeDraft}`,
        'Write one concise subject line for this new outbound email.',
      ].join('\n\n'),
    },
  ];
}
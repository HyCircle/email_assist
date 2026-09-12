import { MAX_CONTEXT_ITEM_CHARS, MAX_DRAFT_CHARS } from './constants';
import type { AssistantSettings, ContextItem, DraftRequest, EmailLanguage, EmailMessage, LlmMessage } from './types';

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

  return `${text.slice(-maxChars).trim()}\n[older content omitted]`;
}

function formatMessage(message: EmailMessage, index: number): string {
  const header = [`Message ${index + 1}`, `From: ${message.sender}`];
  if (message.date) {
    header.push(`Date: ${message.date}`);
  }

  return `${header.join(' | ')}\n${normalizeBlock(message.body)}`;
}

function contextLabel(context: ContextItem): string {
  if (context.kind === 'current-thread') {
    return 'Current thread';
  }

  return 'User-provided reference email';
}

function formatContext(context: ContextItem, index: number): string {
  const transcript = context.messages.map(formatMessage).join('\n\n---\n\n');
  const lines = [
    `Context ${index + 1}: ${contextLabel(context)}`,
    `Label: ${normalizeBlock(context.label) || '(unnamed)'}`,
    `Subject: ${normalizeBlock(context.subject) || '(no subject)'}`,
    `Participants: ${context.participants.join(', ') || '(unknown participants)'}`,
    `Messages:\n${trimToLimit(transcript || '(no message text)', MAX_CONTEXT_ITEM_CHARS)}`,
  ];

  return lines.join('\n');
}

function languageInstruction(language: EmailLanguage): string {
  return language === 'chinese'
    ? 'Default email language: Chinese. Write in Chinese unless the instruction clearly asks for another language.'
    : 'Default email language: English. Write in English unless the instruction clearly asks for another language.';
}

function writingPreferences(settings: AssistantSettings): string[] {
  const sections: string[] = [];

  if (settings.styleNotes) {
    sections.push(`Preferred writing style: ${settings.styleNotes}`);
  }

  if (settings.signOffOptions.length > 0) {
    sections.push(`When a sign-off is appropriate, choose the best fit from: ${settings.signOffOptions.join(' | ')}.`);
  }

  if (settings.signatureBlock) {
    sections.push(
      `After the sign-off, append this exact signature block unless the instruction explicitly says to omit it:\n${normalizeBlock(settings.signatureBlock)}`,
    );
  }

  return sections;
}

export function buildDraftMessages(request: DraftRequest, settings: AssistantSettings): LlmMessage[] {
  const contexts = request.contexts.length
    ? request.contexts.map(formatContext).join('\n\n---\n\n')
    : '(no email context was selected)';
  const draft = request.draft ? trimToLimit(normalizeBlock(request.draft), MAX_DRAFT_CHARS) : '';
  const actionInstruction =
    request.action === 'improve'
      ? 'Improve the current draft while preserving its intent and factual content.'
      : request.composeKind === 'reply'
        ? 'Draft a reply to the selected email context.'
        : 'Draft a new outbound email using only the selected context and instruction.';

  const systemPrompt = [
    'You are a careful email writing assistant.',
    'Return plain text only.',
    'Do not output HTML, Markdown fences, or explanations unless explicitly requested.',
    'Do not claim that an email was sent or that an action was taken.',
    'Use only the selected email context and the user instruction.',
    languageInstruction(settings.defaultLanguage),
    ...writingPreferences(settings),
  ].join(' ');

  const userSections = [
    `Task: ${actionInstruction}`,
    `Instruction:\n${normalizeBlock(request.instruction)}`,
    `Subject on compose: ${normalizeBlock(request.subject) || '(no subject)'}`,
    contexts,
  ];

  if (draft) {
    userSections.push(`Current draft:\n${draft}`);
  }

  userSections.push('Write the email body only. Do not add a subject line.');

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userSections.join('\n\n') },
  ];
}

export function buildSubjectMessages(request: DraftRequest, draftBody: string, settings: AssistantSettings): LlmMessage[] {
  const contexts = request.contexts.length
    ? request.contexts.map(formatContext).join('\n\n---\n\n')
    : '(no email context was selected)';

  return [
    {
      role: 'system',
      content: [
        'You write concise email subject lines.',
        'Return only one subject line.',
        'Do not include quotes, bullets, numbering, or a Subject label.',
        'Do not add Re: or Fwd: prefixes.',
        languageInstruction(settings.defaultLanguage),
      ].join(' '),
    },
    {
      role: 'user',
      content: [
        `Instruction:\n${normalizeBlock(request.instruction)}`,
        `Selected context:\n${contexts}`,
        `Generated email body:\n${trimToLimit(normalizeBlock(draftBody), MAX_DRAFT_CHARS)}`,
        'Write one concise subject line for this new outbound email.',
      ].join('\n\n'),
    },
  ];
}

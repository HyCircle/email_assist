import {
  MAX_ATTACHMENT_NAME_CHARS,
  MAX_CONTEXT_ITEM_CHARS,
  MAX_CONTEXT_PROMPT_CHARS,
  MAX_DRAFT_CHARS,
} from './constants';
import type {
  AssistantSettings,
  ContextAttachment,
  ContextItem,
  DraftRequest,
  EmailLanguage,
  EmailMessage,
  LlmContentPart,
  LlmMessage,
} from './types';

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
  return context.kind === 'current-thread' ? 'Current thread' : 'User-provided reference email';
}

function formatAttachmentMetadata(attachment: ContextAttachment): string {
  const name = normalizeBlock(attachment.name).slice(0, MAX_ATTACHMENT_NAME_CHARS) || '(unnamed attachment)';
  const lines = [
    `Attachment: ${name}`,
    `Kind: ${attachment.kind}`,
    `Type: ${normalizeBlock(attachment.mediaType) || 'unknown'}`,
    `Size: ${normalizeBlock(attachment.size) || 'unknown'}`,
  ];

  return lines.join('\n');
}

function formatContext(context: ContextItem, index: number): string {
  const transcript = context.messages.map(formatMessage).join('\n\n---\n\n');
  const attachments = context.attachments?.map(formatAttachmentMetadata).join('\n\n') || '(none)';
  const lines = [
    `Context ${index + 1}: ${contextLabel(context)}`,
    `Label: ${normalizeBlock(context.label) || '(unnamed)'}`,
    `Subject: ${normalizeBlock(context.subject) || '(no subject)'}`,
    `Participants: ${context.participants.map(normalizeBlock).filter(Boolean).join(', ') || '(unknown participants)'}`,
    `Messages:\n${trimToLimit(transcript || '(no message text)', MAX_CONTEXT_ITEM_CHARS)}`,
    `Attachments:\n${attachments}`,
  ];

  return `BEGIN_EMAIL_CONTEXT\n${lines.join('\n')}\nEND_EMAIL_CONTEXT`;
}

function formatContexts(contexts: ContextItem[]): string {
  if (contexts.length === 0) {
    return '(no email context was selected)';
  }

  let remaining = MAX_CONTEXT_PROMPT_CHARS;
  const formatted: string[] = [];

  for (const [index, context] of contexts.entries()) {
    if (remaining <= 0) {
      break;
    }

    const block = formatContext(context, index);
    const endMarker = '\nEND_EMAIL_CONTEXT';
    const omission = '\n[context truncated]';
    const clipped = block.length > remaining && remaining > endMarker.length + omission.length + 1
      ? `${block.slice(0, remaining - endMarker.length - omission.length).trim()}${omission}${endMarker}`
      : block;
    if (clipped.length > remaining) {
      break;
    }
    formatted.push(clipped);
    remaining -= clipped.length + 8;
  }

  if (formatted.length < contexts.length) {
    const omission = '[additional contexts omitted]';
    while (formatted.length > 0 && [...formatted, omission].join('\n\n---\n\n').length > MAX_CONTEXT_PROMPT_CHARS) {
      formatted.pop();
    }
    formatted.push(omission);
  }

  return formatted.join('\n\n---\n\n');
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

function buildSystemPrompt(settings: AssistantSettings): string {
  return [
    settings.systemPrompt,
    languageInstruction(settings.defaultLanguage),
    ...writingPreferences(settings),
  ].join(' ');
}

function imageParts(attachments: ContextAttachment[]): LlmContentPart[] {
  const parts: LlmContentPart[] = [];
  for (const attachment of attachments) {
    if (attachment.kind !== 'image' || !attachment.dataUrl) {
      continue;
    }

    parts.push(
      { type: 'text', text: `Image attachment: ${normalizeBlock(attachment.name) || '(unnamed image)'}` },
      { type: 'image_url', image_url: { url: attachment.dataUrl, detail: 'high' } },
    );
  }
  return parts;
}

function buildStableContextContent(request: DraftRequest): string | LlmContentPart[] {
  const contextText = [
    `BEGIN_SELECTED_CONTEXTS\n${formatContexts(request.contexts)}\nEND_SELECTED_CONTEXTS`,
    `BEGIN_COMPOSE_ATTACHMENTS\n${request.attachments.length
      ? request.attachments.map(formatAttachmentMetadata).join('\n\n')
      : '(none)'}\nEND_COMPOSE_ATTACHMENTS`,
  ].join('\n\n');
  const parts = imageParts([
    ...request.contexts.flatMap((context) => context.attachments ?? []),
    ...request.attachments,
  ]);
  return parts.length > 0 ? [{ type: 'text', text: contextText }, ...parts] : contextText;
}

function previousCandidate(request: DraftRequest): string | null {
  const draft = trimToLimit(normalizeBlock(request.draft), MAX_DRAFT_CHARS);
  if (!draft) {
    return null;
  }

  return JSON.stringify({
    subject: request.composeKind === 'new' ? normalizeBlock(request.subject) : null,
    body: draft,
  });
}

export function buildDraftMessages(request: DraftRequest, settings: AssistantSettings): LlmMessage[] {
  const action = request.action === 'improve'
    ? 'Improve the previous candidate while preserving its intent and factual content.'
    : request.composeKind === 'reply'
      ? 'Draft a reply to the selected email context.'
      : 'Draft a new outbound email using the selected context and instruction.';
  const task = [
    `Compose kind: ${request.composeKind}`,
    `Action: ${action}`,
    `Current subject: ${normalizeBlock(request.subject) || '(no subject)'}`,
    `User instruction:\n${normalizeBlock(request.instruction)}`,
    'Produce the next email candidate now.',
  ];
  const messages: LlmMessage[] = [
    { role: 'system', content: buildSystemPrompt(settings) },
    { role: 'user', content: buildStableContextContent(request) },
  ];
  const candidate = previousCandidate(request);
  if (candidate) {
    messages.push({ role: 'assistant', content: candidate });
  }
  messages.push({ role: 'user', content: task.join('\n\n') });
  return messages;
}

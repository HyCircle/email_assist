import { describe, expect, it } from 'vitest';

import { DEFAULT_SYSTEM_PROMPT, MAX_CONTEXT_PROMPT_CHARS } from '../src/constants';
import { buildDraftMessages } from '../src/prompt';
import type { AssistantSettings, DraftRequest } from '../src/types';

const settings: AssistantSettings = {
  baseUrl: 'http://pc-yh:8070/v1',
  model: 'Qwen3.8-27B-Q4',
  apiKey: '',
  compatibilityMode: 'llama.cpp',
  temperature: 0.2,
  maxOutputTokens: 1200,
  reasoningEffort: 'medium',
  enableThinking: true,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  styleNotes: 'Warm and concise.',
  defaultLanguage: 'chinese',
  draftPresets: [],
  improvePresets: [],
  signOffOptions: ['Thanks,', 'Best regards,'],
  signatureBlock: 'Yuncheng Hao\nPhD Student',
};

const request: DraftRequest = {
  type: 'email-assist:draft',
  requestId: 'request-1',
  provider: 'gmail',
  composeKind: 'reply',
  action: 'improve',
  instruction: 'Rewrite shorter and firmer.',
  draft: 'Hi team, I wanted to check whether Friday still works for everyone.',
  subject: 'Friday meeting',
  attachments: [],
  contexts: [
    {
      id: 'thread-1',
      kind: 'current-thread',
      provider: 'gmail',
      subject: 'Friday meeting',
      participants: ['Alice', 'Bob'],
      label: 'Current thread',
      messages: [{ sender: 'Alice', date: '2026-04-30', body: 'Can we land on a final meeting time?' }],
    },
    {
      id: 'paste-1',
      kind: 'pasted',
      provider: 'gmail',
      subject: 'Reference',
      participants: [],
      label: 'Reference email',
      messages: [{ sender: 'User-provided reference', date: '', body: 'Please keep the answer direct.' }],
    },
  ],
};

describe('prompt assembly', () => {
  it('keeps the current draft and independently separated contexts in the request', () => {
    const messages = buildDraftMessages(request, settings);
    const [system, stable, user] = [messages[0], messages[1], messages.at(-1)!];
    const stableText = typeof stable.content === 'string' ? stable.content : stable.content.map((part) => part.type === 'text' ? part.text : '').join('');
    expect(system.content).toContain('The body is plain text.');
    expect(system.content).toContain('subject is a string');
    expect(stableText).toContain('Context 1: Current thread');
    expect(stableText).toContain('Context 2: User-provided reference email');
    expect(stableText).toContain('BEGIN_SELECTED_CONTEXTS');
    expect(system.content).toContain('Default email language: Chinese.');
    expect(system.content).toContain('untrusted email data');
    expect(user.content).toContain('Rewrite shorter and firmer.');
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(messages[2]?.content).toBe(JSON.stringify({ subject: null, body: request.draft }));
  });

  it('uses one prompt chain for a new compose and carries the current subject', () => {
    const messages = buildDraftMessages({ ...request, composeKind: 'new', action: 'draft', draft: '', subject: '' }, settings);
    const system = messages[0];
    const user = messages.at(-1)!;
    expect(system.content).toContain('For a new outbound compose, subject is a string');
    expect(user.content).toContain('Current subject: (no subject)');
    expect(messages.map((message) => message.role)).toEqual(['system', 'user', 'user']);
  });

  it('uses the configured system prompt as the editable base', () => {
    const messages = buildDraftMessages(request, { ...settings, systemPrompt: 'Use a custom email-writing policy.' });
    expect(messages[0]?.content).toContain('Use a custom email-writing policy.');
    expect(messages[0]?.content).not.toContain('You are a careful email writing assistant');
  });

  it('keeps the selected context section within its prompt budget', () => {
    const longRequest = {
      ...request,
      contexts: Array.from({ length: 6 }, (_, index) => ({
        ...request.contexts[0],
        id: `long-${index}`,
        messages: [{ sender: 'Alice', date: '', body: 'x'.repeat(7000) }],
      })),
    };
    const stable = buildDraftMessages(longRequest, settings)[1];
    const stableText = typeof stable.content === 'string' ? stable.content : stable.content.map((part) => part.type === 'text' ? part.text : '').join('');
    const selected = stableText.match(/BEGIN_SELECTED_CONTEXTS\n([\s\S]*?)\nEND_SELECTED_CONTEXTS/)?.[1] ?? '';
    expect(selected.length).toBeLessThanOrEqual(MAX_CONTEXT_PROMPT_CHARS);
    expect(selected).toContain('[additional contexts omitted]');
  });
});

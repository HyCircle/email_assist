import { describe, expect, it } from 'vitest';

import { buildDraftMessages, buildSubjectMessages } from '../src/prompt';
import type { AssistantSettings, DraftRequest } from '../src/types';

const settings: AssistantSettings = {
  baseUrl: 'http://pc-yh:8070/v1',
  model: 'Qwen3.8-27B-Q4',
  temperature: 0.2,
  styleNotes: 'Warm and concise.',
  defaultLanguage: 'chinese',
  draftPresets: [],
  improvePresets: [],
  signOffOptions: ['Thanks,', 'Best regards,'],
  signatureBlock: 'Yuncheng Hao\nPhD Student',
};

const request: DraftRequest = {
  type: 'email-assist:draft',
  provider: 'gmail',
  composeKind: 'reply',
  action: 'improve',
  instruction: 'Rewrite shorter and firmer.',
  draft: 'Hi team, I wanted to check whether Friday still works for everyone.',
  subject: 'Friday meeting',
  includeSubject: false,
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
    const [system, user] = buildDraftMessages(request, settings);
    expect(system.content).toContain('Return plain text only.');
    expect(system.content).toContain('Default email language: Chinese.');
    expect(system.content).toContain('Thanks, | Best regards,');
    expect(user.content).toContain('Context 1: Current thread');
    expect(user.content).toContain('Context 2: User-provided reference email');
    expect(user.content).toContain('Current draft');
    expect(user.content).toContain('Rewrite shorter and firmer.');
  });

  it('builds a subject prompt without browser URLs or UI text', () => {
    const [system, user] = buildSubjectMessages({ ...request, composeKind: 'new', action: 'draft' }, 'Hello there.', settings);
    expect(system.content).toContain('Return only one subject line.');
    expect(user.content).toContain('Generated email body');
    expect(user.content).not.toContain('mail.google.com');
    expect(user.content).not.toContain('Context id');
  });
});

import { describe, expect, it } from 'vitest';

import { buildChatMessages, buildSubjectMessages } from '../src/prompt';
import type { AssistantSettings, GenerateDraftRequest } from '../src/types';

describe('buildChatMessages', () => {
  it('includes the instruction, thread context, and current draft when refining', () => {
    const settings: AssistantSettings = {
      endpoint: 'http://localhost:8070/v1/chat/completions',
      model: 'Qwen3.6-35B-A3B-Q4_K_S-Agent',
      temperature: 0.2,
      styleNotes: 'Warm and concise.',
      apiKey: '',
      defaultLanguage: 'chinese',
      generatePresets: ['Draft a concise update.'],
      refinePresets: ['Rewrite shorter and firmer.'],
      signOffOptions: ['Thanks,', 'Best regards,'],
      signatureBlock: 'Yuncheng Hao\nPhD Student',
    };

    const request: GenerateDraftRequest = {
      type: 'email-assist:generate',
      provider: 'gmail',
      action: 'refine',
      instruction: 'Rewrite shorter and firmer.',
      currentDraft: 'Hi team, I wanted to check whether Friday still works for everyone.',
      thread: {
        provider: 'gmail',
        subject: 'Friday meeting',
        participants: ['Alice', 'Bob'],
        sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/example',
        messages: [
          {
            sender: 'Alice',
            date: '2026-04-30',
            body: 'Can we land on a final meeting time?',
          },
        ],
      },
    };

    const [systemMessage, userMessage] = buildChatMessages(request, settings);

    expect(systemMessage.content).toContain('Return plain text only.');
    expect(systemMessage.content).toContain('Warm and concise.');
    expect(systemMessage.content).toContain('Default email language: Chinese.');
    expect(systemMessage.content).toContain('Thanks, | Best regards,');
    expect(systemMessage.content).toContain('Yuncheng Hao');
    expect(userMessage.content).toContain('Rewrite shorter and firmer.');
    expect(userMessage.content).toContain('Default language: Chinese');
    expect(userMessage.content).toContain('Friday meeting');
    expect(userMessage.content).toContain('Alice');
    expect(userMessage.content).toContain('Current draft');
  });

  it('builds a subject-only prompt for new outbound emails', () => {
    const settings: AssistantSettings = {
      endpoint: 'http://localhost:8070/v1/chat/completions',
      model: 'Qwen3.6-35B-A3B-Q4_K_S-Agent',
      temperature: 0.2,
      styleNotes: '',
      apiKey: '',
      defaultLanguage: 'english',
      generatePresets: [],
      refinePresets: [],
      signOffOptions: [],
      signatureBlock: '',
    };

    const request: GenerateDraftRequest = {
      type: 'email-assist:generate',
      provider: 'gmail',
      action: 'generate',
      instruction: 'Invite Prof. Smith to a brief check-in next week.',
      thread: {
        provider: 'gmail',
        subject: '',
        participants: ['Prof. Smith'],
        sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/example',
        messages: [],
      },
    };

    const [systemMessage, userMessage] = buildSubjectMessages(
      request,
      'Hello Prof. Smith,\n\nWould you be available for a brief check-in next week?\n\nBest regards,\nYuncheng Hao',
      settings,
    );

    expect(systemMessage.content).toContain('Return only the subject line text.');
    expect(userMessage.content).toContain('Invite Prof. Smith');
    expect(userMessage.content).toContain('Generated email body');
  });
});
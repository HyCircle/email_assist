import { describe, expect, it } from 'vitest';

import { normalizeSettings, parseSettingsImport, serializeSettingsExport } from '../src/storage';

describe('normalizeSettings', () => {
  it('normalizes language and presets', () => {
    const settings = normalizeSettings({
      endpoint: ' http://localhost:8070/v1/chat/completions ',
      model: ' Qwen ',
      temperature: 3,
      styleNotes: ' Warm and concise. ',
      apiKey: ' ',
      defaultLanguage: 'chinese',
      generatePresets: ['  Draft a polite reply. ', '', 'Draft a polite reply.'],
      refinePresets: [' Rewrite shorter. ', ''],
      signOffOptions: [' Thanks, ', '', 'Best regards,'],
      signatureBlock: ' Yuncheng Hao\nUIC ',
    });

    expect(settings.endpoint).toBe('http://localhost:8070/v1/chat/completions');
    expect(settings.model).toBe('Qwen');
    expect(settings.temperature).toBe(2);
    expect(settings.defaultLanguage).toBe('chinese');
    expect(settings.generatePresets).toEqual(['Draft a polite reply.']);
    expect(settings.refinePresets).toEqual(['Rewrite shorter.']);
    expect(settings.signOffOptions).toEqual(['Thanks,', 'Best regards,']);
    expect(settings.signatureBlock).toBe('Yuncheng Hao\nUIC');
  });

  it('serializes and parses exported settings payloads', () => {
    const source = normalizeSettings({
      endpoint: 'http://localhost:8070/v1/chat/completions',
      model: 'Qwen',
      temperature: 0.4,
      styleNotes: 'Direct and warm.',
      apiKey: '',
      defaultLanguage: 'english',
      generatePresets: ['Draft a concise reply.'],
      refinePresets: ['Rewrite shorter.'],
      signOffOptions: ['Thanks,'],
      signatureBlock: 'Yuncheng Hao',
    });

    const serialized = serializeSettingsExport(source, '2026-05-01T00:00:00.000Z');
    const parsed = parseSettingsImport(serialized);

    expect(JSON.parse(serialized)).toMatchObject({
      version: 1,
      exportedAt: '2026-05-01T00:00:00.000Z',
    });
    expect(parsed).toEqual(source);
  });
});
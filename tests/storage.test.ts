import { describe, expect, it } from 'vitest';

import { normalizeSettings, parseSettingsImport, serializeSettingsExport } from '../src/storage';

describe('settings contract', () => {
  it('uses the in-code defaults when nothing is stored', () => {
    const settings = normalizeSettings(undefined);
    expect(settings.baseUrl).toBe('http://pc-yh:8070/v1');
    expect(settings.model).toBe('Qwen3.8-27B-Q4');
    expect(settings.temperature).toBe(0.2);
  });

  it('normalizes the base URL and writing lists', () => {
    const settings = normalizeSettings({
      baseUrl: ' http://pc-yh:8070/v1/// ',
      model: ' Qwen ',
      temperature: 3,
      styleNotes: ' Warm and concise. ',
      defaultLanguage: 'chinese',
      draftPresets: ['  Draft a polite reply. ', '', 'Draft a polite reply.'],
      improvePresets: [' Rewrite shorter. ', ''],
      signOffOptions: [' Thanks, ', '', 'Best regards,'],
      signatureBlock: ' Yuncheng Hao\nUIC ',
    });

    expect(settings.baseUrl).toBe('http://pc-yh:8070/v1');
    expect(settings.temperature).toBe(2);
    expect(settings.defaultLanguage).toBe('chinese');
    expect(settings.draftPresets).toEqual(['Draft a polite reply.']);
    expect(settings.improvePresets).toEqual(['Rewrite shorter.']);
    expect(settings.signOffOptions).toEqual(['Thanks,', 'Best regards,']);
  });

  it('serializes and parses the versioned settings contract', () => {
    const source = normalizeSettings({ baseUrl: 'http://pc-yh:8070/v1', model: 'Qwen', temperature: 0.4, styleNotes: 'Direct.', defaultLanguage: 'english', draftPresets: ['Draft.'], improvePresets: ['Improve.'], signOffOptions: ['Thanks,'], signatureBlock: 'Yuncheng Hao' });
    const serialized = serializeSettingsExport(source, '2026-05-01T00:00:00.000Z');
    const parsed = parseSettingsImport(serialized);
    expect(JSON.parse(serialized)).toMatchObject({ version: 2, exportedAt: '2026-05-01T00:00:00.000Z' });
    expect(parsed).toEqual(source);
    expect(() => parseSettingsImport(serialized.replace('"version": 2', '"version": 99'))).toThrow('Unsupported settings export version');
  });
});

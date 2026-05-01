import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractGmailThreadContext,
  findGmailComposeEditors,
  readPlainTextFromGmailEditor,
} from '../src/gmail-dom';

function installDom(html: string, url: string) {
  const dom = new JSDOM(html, { url });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.spyOn(dom.window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 320,
    height: 120,
    top: 0,
    left: 0,
    right: 320,
    bottom: 120,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }));
  return dom;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('gmail-dom', () => {
  it('finds compose editors and extracts visible thread content', () => {
    installDom(
      `
        <main>
          <h2 class="hP">Project update</h2>
          <div class="adn ads">
            <span class="gD">Alice</span>
            <span class="g3" title="Apr 30">Apr 30</span>
            <div class="a3s">Could you send the final draft today?</div>
          </div>
        </main>
        <div role="dialog">
          <div aria-label="Message Body" contenteditable="true">Initial reply</div>
        </div>
      `,
      'https://mail.google.com/mail/u/0/#inbox/example',
    );

    const editors = findGmailComposeEditors(document);
    const thread = extractGmailThreadContext(document);

    expect(editors).toHaveLength(1);
    expect(readPlainTextFromGmailEditor(editors[0])).toContain('Initial reply');
    expect(thread.subject).toBe('Project update');
    expect(thread.messages[0]?.sender).toBe('Alice');
    expect(thread.messages[0]?.body).toContain('final draft');
  });

  it('does not treat the inbox title as a thread subject for a brand new compose', () => {
    installDom(
      `
        <div role="dialog">
          <input name="subjectbox" value="" />
          <div aria-label="Message Body" contenteditable="true"></div>
        </div>
      `,
      'https://mail.google.com/mail/u/0/#inbox?compose=new',
    );

    document.title = 'Inbox - haoyun119@gmail.com - Gmail';

    const thread = extractGmailThreadContext(document);

    expect(thread.subject).toBe('');
    expect(thread.messages).toEqual([]);
  });
});
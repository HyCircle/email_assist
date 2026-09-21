import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractGmailCurrentContext,
  extractGmailWriter,
  findGmailComposeEditors,
  getGmailComposeKind,
  getGmailComposeMountForAssistant,
  insertPlainTextIntoGmail,
  readPlainTextFromGmailEditor,
} from '../src/gmail-dom';

function installDom(html: string, url: string): void {
  const dom = new JSDOM(html, { url });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('InputEvent', dom.window.InputEvent);
  vi.spyOn(dom.window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 320, height: 120, top: 0, left: 0, right: 320, bottom: 120, x: 0, y: 0, toJSON: () => ({}),
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const gmailPopupCompose = `
  <div role="dialog">
    <input name="subjectbox" aria-label="Subject" value="">
    <table>
      <tr><td class="Ap">
        <div class="Ar Au Ao"><div class="aO7">
          <div aria-label="Message Body" contenteditable="true"></div>
          <span>Press / to write using your Gmail &amp; Drive</span>
        </div></div>
      </td></tr>
      <tr><td class="HE">
        <div aria-label="Describe your message"></div>
        <button aria-label="Help me write"></button>
      </td></tr>
    </table>
  </div>
`;

const gmailInlineReply = `
  <h2 data-thread-perm-id="thread-1">Project update</h2>
  <div role="list">
    <div role="listitem" class="kv">
      <div class="adf ads">
        <span email="alice@example.com">Alice</span>
        <span class="g3" title="Jul 15, 2026, 11:58 AM">Wed, Jul 15, 11:58 AM</span>
        Order Update Hello Yuncheng, we need your choice on the case color.
      </div>
    </div>
    <div role="listitem" class="kv">
      <div class="adf ads">
        <span email="me@example.com">Yuncheng</span>
        <span class="g3" title="Jul 15, 2026, 12:20 PM">Wed, Jul 15, 12:20 PM</span>
        Hi Alice, does case mean the storage container?
      </div>
    </div>
    <div role="listitem" class="kv">
      <div class="adf ads">
        <span email="alice@example.com">Alice</span>
        <span class="g3" title="Jul 16, 2026, 9:10 AM">Thu, Jul 16, 9:10 AM</span>
        Yes, the white case holds the lenses.
      </div>
    </div>
    <div role="listitem" class="h7">
      <div class="adn ads" data-message-id="m4" data-legacy-message-id="legacy-4">
        <span email="me@example.com">Yuncheng</span>
        <span class="g3" title="Jul 22, 2026, 10:19 PM">Wed, Jul 22, 10:19 PM</span>
        <div class="a3s">Could you send the final draft today?</div>
      </div>
    </div>
  </div>
  <table class="cf An">
    <tr><td class="Ap">
      <div aria-hidden="true"><input aria-label="Subject" value=""></div>
      <div class="aO7">
        <div aria-label="Message Body" contenteditable="true"></div>
        <span>Press / to write using your Gmail &amp; Drive</span>
      </div>
    </td></tr>
  </table>
  <div aria-label="Help me write"></div>
  <a aria-label="Google Account: Yuncheng (me@example.com), Google membership" href="https://accounts.google.com/SignOutOptions"></a>
`;

describe('gmail-dom', () => {
  it('identifies a new compose and keeps inbox chrome out of context', () => {
    installDom(`
      <main><h2>Inbox</h2><div>Inbox navigation</div></main>
      ${gmailPopupCompose}
    `, 'https://mail.google.com/mail/u/0/#inbox?compose=new');

    const editor = findGmailComposeEditors(document)[0];
    expect(getGmailComposeKind(editor)).toBe('new');
    expect(extractGmailCurrentContext(document)).toBeNull();
  });

  it('extracts the visible thread from conversation list items including collapsed snippets', () => {
    installDom(gmailInlineReply, 'https://mail.google.com/mail/u/0/#inbox/example');

    const context = extractGmailCurrentContext(document);
    expect(context?.kind).toBe('current-thread');
    expect(context?.subject).toBe('Project update');
    expect(context?.messages).toHaveLength(4);
    expect(context?.participants).toEqual(expect.arrayContaining(['alice@example.com', 'me@example.com']));
    expect(context?.messages[0]?.body).toContain('case color');
    expect(context?.messages[0]?.date).toBe('Jul 15, 2026, 11:58 AM');
    expect(context?.messages[3]?.sender).toBe('me@example.com');
    expect(context?.messages[3]?.body).toContain('final draft');
    expect(context?.messages[3]?.date).toBe('Jul 22, 2026, 10:19 PM');
    expect(context?.messages[0]?.body).not.toContain('Inbox');
  });

  it('reads the signed-in Gmail writer from the account control', () => {
    installDom(gmailInlineReply, 'https://mail.google.com/mail/u/0/#inbox/example');
    expect(extractGmailWriter(document)).toBe('Yuncheng <me@example.com>');
  });

  it('keeps attached files and attached images, and ignores body images', () => {
    installDom(`
      <h2 data-thread-perm-id="thread-2">Visual update</h2>
      <div data-message-id="m2">
        <span email="alice@example.com">Alice</span>
        <div class="a3s">Please see the chart.<img src="https://mail.google.com/image?id=1" alt="Chart" /></div>
        <span class="aZo" download_url="application/pdf:report.pdf:https://mail.google.com/mail/u/0?view=att">report.pdf 12 KB</span>
        <span download_url="image/png:plot.png:https://mail.google.com/mail/u/0?view=att">plot.png 80 KB</span>
      </div>
    `, 'https://mail.google.com/mail/u/0/#inbox/example');

    const context = extractGmailCurrentContext(document);
    expect(context?.attachments).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'file', name: 'report.pdf', size: '12 KB' }),
      expect.objectContaining({ kind: 'image', name: 'plot.png', mediaType: 'image/png' }),
    ]));
    expect(context?.attachments?.some((attachment) => attachment.name === 'Chart')).toBe(false);
  });

  it('does not invent a thread from page text when message markup is missing', () => {
    installDom(`
      <main><h2>Inbox</h2><div>Please reply to this UI copy alice@example.com</div></main>
      ${gmailPopupCompose}
    `, 'https://mail.google.com/mail/u/0/#inbox?compose=new');

    expect(extractGmailCurrentContext(document)).toBeNull();
  });

  it('strips nested gmail_quote from expanded message bodies', () => {
    installDom(`
      <h2 data-thread-perm-id="thread-3">Reloptix</h2>
      <div role="list">
        <div role="listitem">
          <span email="help@reloptix.com">Reloptix</span>
          <span class="g3" title="Jul 16, 2026, 9:10 AM">Jul 16</span>
          <div data-message-id="m3">
            <div class="a3s">
              Hello there, the white case holds the lenses.
              <div class="gmail_quote">On Jul 15, haoyun119@gmail.com wrote:<br>Does case refer to storage?</div>
            </div>
          </div>
        </div>
      </div>
    `, 'https://mail.google.com/mail/u/0/#inbox/example');

    const context = extractGmailCurrentContext(document);
    expect(context?.messages).toHaveLength(1);
    expect(context?.messages[0]?.body).toContain('white case holds the lenses');
    expect(context?.messages[0]?.body).not.toContain('Does case refer');
    expect(context?.messages[0]?.body).not.toContain('gmail_quote');
  });

  it('preserves Gmail signatures and quoted content when applying a draft', () => {
    installDom(`
      <div role="dialog"><div aria-label="Message Body" contenteditable="true">
        <div class="user-draft">Old draft</div>
        <div class="gmail_signature">Yuncheng Hao</div>
        <div class="gmail_quote">Quoted message</div>
      </div></div>
    `, 'https://mail.google.com/mail/u/0/#inbox/example');

    const editor = findGmailComposeEditors(document)[0];
    insertPlainTextIntoGmail(editor, 'New reply.\n\nThanks,');
    expect(readPlainTextFromGmailEditor(editor)).toContain('New reply.');
    expect(editor.textContent).toContain('Yuncheng Hao');
    expect(editor.textContent).toContain('Quoted message');
    expect(editor.querySelector('[data-email-assist-draft="true"]')?.textContent).toContain('Thanks');
  });

  it('preserves line breaks when reading an existing Gmail draft', () => {
    installDom(`<div role="dialog"><div aria-label="Message Body" contenteditable="true">
      <div>This is a test email.</div>
      <div><br></div>
      <div>Best regards,</div>
      <div>Yuncheng</div>
    </div></div>`, 'https://mail.google.com/mail/u/0/#inbox?compose=new');

    const editor = findGmailComposeEditors(document)[0];
    expect(readPlainTextFromGmailEditor(editor)).toBe('This is a test email.\n\nBest regards,\nYuncheng');
  });

  it('does not treat Gmail’s empty-editor placeholder as a draft', () => {
    installDom(gmailPopupCompose, 'https://mail.google.com/mail/u/0/#inbox?compose=new');
    const editor = findGmailComposeEditors(document)[0];
    expect(readPlainTextFromGmailEditor(editor)).toBe('');
  });

  it('mounts the strip in the message-body cell, not the Help me write toolbar', () => {
    installDom(gmailPopupCompose, 'https://mail.google.com/mail/u/0/#inbox?compose=new');
    const editor = findGmailComposeEditors(document)[0];
    const mount = getGmailComposeMountForAssistant(editor);
    expect(mount.kind).toBe('flow');
    if (mount.kind !== 'flow') return;
    expect(mount.host.className).toBe('Ap');
    expect(mount.host.querySelector('[aria-label="Help me write"]')).toBeNull();
    expect(mount.host.contains(editor)).toBe(true);
    expect(editor.closest('.aO7') === mount.host).toBe(false);
  });

  it('keeps an inline reply as reply even when a hidden subject input is present', () => {
    installDom(gmailInlineReply, 'https://mail.google.com/mail/u/0/#inbox/example');
    const editor = findGmailComposeEditors(document)[0];
    const mount = getGmailComposeMountForAssistant(editor);
    expect(getGmailComposeKind(editor)).toBe('reply');
    expect(mount.kind).toBe('flow');
    if (mount.kind !== 'flow') return;
    expect(mount.host.className).toBe('Ap');
    expect(mount.host.contains(editor)).toBe(true);
    expect(editor.parentElement === mount.host).toBe(false);
  });

  it('returns a popover mount when Gmail has no compose table cell', () => {
    installDom(`<div aria-label="Message Body" contenteditable="true"></div>`, 'https://mail.google.com/mail/u/0/#inbox');
    const editor = findGmailComposeEditors(document)[0];
    expect(getGmailComposeMountForAssistant(editor)).toEqual({ kind: 'popover', anchor: editor });
  });
});

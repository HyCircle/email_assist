import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractGmailCurrentContext,
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
  <main>
    <h2 data-thread-perm-id="thread-1">Project update</h2>
    <div data-message-id="m1">
      <span email="alice@example.com">Alice</span>
      <div class="a3s">Could you send the final draft today?</div>
    </div>
  </main>
  <table>
    <tr><td class="Ap">
      <div class="aO7">
        <div aria-label="Message Body" contenteditable="true"></div>
        <span>Press / to write using your Gmail &amp; Drive</span>
      </div>
    </td></tr>
  </table>
  <div aria-label="Help me write"></div>
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

  it('extracts the visible thread from message ids and email attributes', () => {
    installDom(gmailInlineReply, 'https://mail.google.com/mail/u/0/#inbox/example');

    const context = extractGmailCurrentContext(document);
    expect(context?.kind).toBe('current-thread');
    expect(context?.subject).toBe('Project update');
    expect(context?.participants).toContain('alice@example.com');
    expect(context?.messages[0]?.body).toContain('final draft');
    expect(context?.messages[0]?.body).not.toContain('Inbox');
  });

  it('does not invent a thread from page text when message markup is missing', () => {
    installDom(`
      <main><h2>Inbox</h2><div>Please reply to this UI copy alice@example.com</div></main>
      ${gmailPopupCompose}
    `, 'https://mail.google.com/mail/u/0/#inbox?compose=new');

    expect(extractGmailCurrentContext(document)).toBeNull();
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

  it('mounts an inline reply above the editor instead of inside it', () => {
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

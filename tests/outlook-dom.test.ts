import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractOutlookCurrentContext,
  findOutlookComposeEditors,
  getOutlookComposeKind,
  getOutlookComposeMountForAssistant,
  insertPlainTextIntoOutlook,
  readPlainTextFromOutlookEditor,
} from '../src/outlook-dom';

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

const outlookComposeShell = `
  <div data-app-section="MailReadCompose">
    <div id="docking_InitVisiblePart_0">
      <div class="surface">
        <div class="action-row">
          <div><div><button aria-label="Send">Send</button></div></div>
          <button aria-label="Discard">Discard</button>
        </div>
        <div class="fields">
          <input aria-label="Subject" id="MSG_1_SUBJECT" value="">
        </div>
        <div id="docking_DockingTriggerPart_0">
          <div aria-label="Message body" contenteditable="true"></div>
        </div>
      </div>
    </div>
  </div>
`;

describe('outlook-dom', () => {
  it('identifies a new Outlook compose and does not scrape page chrome as context', () => {
    installDom(`
      <div title="Inbox navigation">Ignore this UI email@example.com</div>
      ${outlookComposeShell}
    `, 'https://outlook.office.com/mail/');

    const editor = findOutlookComposeEditors(document)[0];
    expect(getOutlookComposeKind(editor)).toBe('new');
    expect(extractOutlookCurrentContext(document, editor)).toBeNull();
  });

  it('extracts a structured Outlook reading pane without scanning page UI', () => {
    installDom(`
      <main id="ReadingPaneContainerId"><div id="ConversationReadingPaneContainer">
        <span id="CONV_123_SUBJECT" role="heading" aria-level="3">Quarterly update</span>
        <div aria-label="Email message">
          <span aria-label="From: ois@uic.edu &lt;ois@uic.edu&gt;"></span>
          <div data-testid="SentReceivedSavedTime">Tuesday, August 26, 2025 10:19 AM</div>
          <div role="document" aria-label="Message body">Please confirm whether Tuesday still works.</div>
        </div>
      </div></main>
      <div title="Inbox navigation">Ignore this UI email@example.com</div>
    `, 'https://outlook.office.com/mail/inbox/id/example');

    const context = extractOutlookCurrentContext(document);
    expect(context?.subject).toBe('Quarterly update');
    expect(context?.messages[0]?.body).toContain('Tuesday still works');
    expect(context?.messages[0]?.sender).toContain('ois@uic.edu');
    expect(context?.participants).toContain('ois@uic.edu');
    expect(context?.participants).not.toContain('email@example.com');
  });

  it('recovers sender and date from Outlook’s inline reply lead-in', () => {
    installDom(`
      <main id="ReadingPaneContainerId"><div id="ConversationReadingPaneContainer">
        <span id="CONV_123_SUBJECT">Homework 2</span>
        <div aria-label="Email message">
          <div role="document" aria-label="Message body">On Sep 11, 2026, 1:52 PM, Vergara, Mateo &lt;mverg@uic.edu&gt; wrote:\nPlease see the attached work.</div>
        </div>
      </div></main>
    `, 'https://outlook.cloud.microsoft/mail/inbox/id/example');

    const context = extractOutlookCurrentContext(document);
    expect(context?.messages[0]?.sender).toContain('mverg@uic.edu');
    expect(context?.messages[0]?.sender).toContain('Vergara, Mateo');
    expect(context?.messages[0]?.date).toContain('Sep 11, 2026');
    expect(context?.participants).toContain('mverg@uic.edu');
  });

  it('returns no reading-pane context when message bodies are not structured', () => {
    installDom(`
      <main id="ReadingPaneContainerId">From: chrome@outlook Whole pane dump email@example.com</main>
      ${outlookComposeShell}
    `, 'https://outlook.office.com/mail/');

    const editor = findOutlookComposeEditors(document)[0];
    expect(extractOutlookCurrentContext(document, editor)).toBeNull();
  });

  it('does not treat the compose subject input as a reading-pane subject', () => {
    installDom(`
      <main id="ReadingPaneContainerId"></main>
      ${outlookComposeShell}
    `, 'https://outlook.live.com/mail/compose/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(extractOutlookCurrentContext(document, editor)).toBeNull();
  });

  it('keeps the quoted reply when replacing the assistant-managed draft block', () => {
    installDom(`<section><div aria-label="Message body" contenteditable="true"><div data-email-assist-draft="true">Old assistant draft</div><div>From: ois@uic.edu</div><div>Original quoted reply body.</div></div></section>`, 'https://outlook.live.com/mail/inbox/id/example');
    const editor = findOutlookComposeEditors(document)[0];
    insertPlainTextIntoOutlook(editor, 'Thanks for the update.');
    expect(readPlainTextFromOutlookEditor(editor)).toContain('Thanks for the update.');
    expect(editor.textContent).toContain('Original quoted reply body.');
    expect(editor.querySelector('[data-email-assist-draft="true"]')?.textContent).toContain('Thanks');
  });

  it('does not treat Outlook quoted reply content as the current draft', () => {
    installDom(`<div><div aria-label="Message body" contenteditable="true">
      <div></div><hr><div id="divRplyFwdMsg">From: ois@uic.edu\nSubject: Campus update</div>
      <div>Quoted body should not become the draft.</div>
    </div></div>`, 'https://outlook.live.com/mail/compose/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(readPlainTextFromOutlookEditor(editor)).toBe('');
  });

  it('extracts quoted reply context from the Outlook compose surface', () => {
    installDom(`
      <div data-app-section="MailReadCompose">
        <input aria-label="Subject" value="Re: Campus update">
        <div aria-label="Message body" contenteditable="true">
          <div></div>
          <div id="divRplyFwdMsg">From: ois@uic.edu &lt;ois@uic.edu&gt;<br>Sent: Tuesday, August 26, 2025 10:19 AM<br>To: yhao24@uic.edu &lt;yhao24@uic.edu&gt;<br>Subject: Campus update</div>
          <div>Please confirm whether Tuesday still works.</div>
        </div>
      </div>
    `, 'https://outlook.live.com/mail/inbox/id/example');

    const context = extractOutlookCurrentContext(document);
    expect(context?.subject).toBe('Campus update');
    expect(context?.messages[0]?.body).toContain('Tuesday still works');
    expect(context?.participants).toEqual(expect.arrayContaining(['ois@uic.edu', 'yhao24@uic.edu']));
  });

  it('extracts and preserves a quoted reply marker outside the editor', () => {
    installDom(`
      <div data-app-section="MailReadCompose">
        <div aria-label="Message body" contenteditable="true"><div data-email-assist-draft="true">Old draft</div></div>
        <div id="divRplyFwdMsg">From: ois@uic.edu &lt;ois@uic.edu&gt;<br>Subject: Campus update</div>
        <div>Original quoted reply body.</div>
      </div>
    `, 'https://outlook.live.com/mail/inbox/id/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(getOutlookComposeKind(editor)).toBe('reply');
    expect(extractOutlookCurrentContext(document, editor)?.messages[0]?.body).toContain('Original quoted reply body');
    insertPlainTextIntoOutlook(editor, 'New reply.');
    expect(editor.textContent).toContain('New reply.');
    expect(editor.textContent).not.toContain('Old draft');
    expect(document.body.textContent).toContain('Original quoted reply body.');
  });

  it('preserves a nested Outlook quote inside the editor when replacing the draft', () => {
    installDom(`
      <div aria-label="Message body" contenteditable="true">
        <div class="editor-surface"><div data-email-assist-draft="true">Old draft</div><div id="divRplyFwdMsg">From: ois@uic.edu<br>Subject: Campus update</div><div>Original quoted reply body.</div></div>
      </div>
    `, 'https://outlook.live.com/mail/inbox/id/example');

    const editor = findOutlookComposeEditors(document)[0];
    insertPlainTextIntoOutlook(editor, 'New reply.');
    expect(editor.textContent).toContain('New reply.');
    expect(editor.textContent).toContain('Original quoted reply body.');
    expect(readPlainTextFromOutlookEditor(editor)).toContain('New reply.');
  });

  it('classifies an Outlook reply from its quoted reply marker', () => {
    installDom(`
      <div data-app-section="MailReadCompose">
        <input aria-label="Subject" value="Re: Campus update">
        <div aria-label="Message body" contenteditable="true"><div id="divRplyFwdMsg">From: ois@uic.edu<br>Subject: Campus update</div></div>
      </div>
    `, 'https://outlook.live.com/mail/compose/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(getOutlookComposeKind(editor)).toBe('reply');
  });

  it('ignores the compose metadata header before an inline blockquote', () => {
    installDom(`
      <div data-app-section="MailReadCompose">
        <input aria-label="Subject" value="Re: Campus update">
        <div aria-label="Message body" contenteditable="true">
          <div>From: me@example.com<br>Subject: Re: Campus update</div>
          <div>My current reply.</div>
          <blockquote>On Tuesday, Alice &lt;alice@example.com&gt; wrote:<br>Quoted body.</blockquote>
        </div>
      </div>
    `, 'https://outlook.live.com/mail/inbox/id/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(getOutlookComposeKind(editor)).toBe('reply');
    expect(extractOutlookCurrentContext(document, editor)?.subject).toBe('Campus update');
    expect(extractOutlookCurrentContext(document, editor)?.messages[0]?.body).toContain('Quoted body');
    expect(extractOutlookCurrentContext(document, editor)?.messages[0]?.body).not.toContain('My current reply');
    expect(readPlainTextFromOutlookEditor(editor)).toContain('My current reply');
    expect(readPlainTextFromOutlookEditor(editor)).not.toContain('me@example.com');
  });

  it('mounts the strip after the Send row, not inside the sticky action bar', () => {
    installDom(outlookComposeShell, 'https://outlook.office.com/mail/');
    const editor = findOutlookComposeEditors(document)[0];
    const mount = getOutlookComposeMountForAssistant(editor);
    expect(mount.kind).toBe('flow');
    if (mount.kind !== 'flow') return;
    expect(mount.host.className).toBe('surface');
    expect(mount.before?.className).toBe('fields');
    expect(mount.host.querySelector('.action-row') === mount.host).toBe(false);
    expect(mount.before?.getAttribute('aria-label')).not.toBe('Send');
  });

  it('returns a popover mount when Outlook has no Send control', () => {
    installDom(`<div aria-label="Message body" contenteditable="true"></div>`, 'https://outlook.live.com/mail/compose/example');
    const editor = findOutlookComposeEditors(document)[0];
    expect(getOutlookComposeMountForAssistant(editor)).toEqual({ kind: 'popover', anchor: editor });
  });
});

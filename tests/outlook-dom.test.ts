import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractOutlookCurrentContext,
  findOutlookComposeEditors,
  getOutlookComposeKind,
  getOutlookComposeMountForAssistant,
  insertPlainTextIntoOutlook,
  insertOutlookSubject,
  readOutlookSubject,
  readPlainTextFromOutlookEditor,
} from '../src/outlook-dom';

function installDom(html: string, url: string): void {
  const dom = new JSDOM(html, { url });
  vi.stubGlobal('window', dom.window);
  vi.stubGlobal('document', dom.window.document);
  vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
  vi.stubGlobal('InputEvent', dom.window.InputEvent);
  vi.stubGlobal('Event', dom.window.Event);
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

  it('targets the Outlook subject input instead of the assistant subject field', () => {
    installDom(`
      <div data-app-section="MailReadCompose">
        <section data-email-assist="true">
          <input aria-label="Subject" placeholder="If available" value="Suggested subject">
        </section>
        <input aria-label="Subject" placeholder="Add a subject" id="MSG_2_SUBJECT" value="">
        <div aria-label="Message body" contenteditable="true"></div>
      </div>
    `, 'https://outlook.cloud.microsoft/mail/');

    const editor = findOutlookComposeEditors(document)[0];
    const hostSubject = document.querySelector<HTMLInputElement>('#MSG_2_SUBJECT')!;
    expect(readOutlookSubject(editor)).toBe('');

    insertOutlookSubject(editor, 'Test email');

    expect(hostSubject.value).toBe('Test email');
    expect(document.querySelector<HTMLInputElement>('[data-email-assist="true"] input')?.value).toBe('Suggested subject');
  });

  it('prefers compose quote over reading-pane cards when both exist', () => {
    installDom(`
      <main id="ReadingPaneContainerId"><div id="ConversationReadingPaneContainer">
        <span id="CONV_123_SUBJECT">Quarterly update</span>
        <div aria-label="1 messages">
          <div class="card">
            <button aria-label="From: pane@example.com"></button>
            <h3>Mon 09/14/2026 05:00 PM</h3>
            <div role="document" aria-label="Message body">Reading pane only body.</div>
          </div>
        </div>
      </div></main>
      <div data-app-section="MailReadCompose">
        <input aria-label="Subject" value="Re: Campus update">
        <div aria-label="Message body" contenteditable="true">
          <div id="divRplyFwdMsg">From: ois@uic.edu &lt;ois@uic.edu&gt;<br>Subject: Campus update</div>
          <div>Please confirm whether Tuesday still works.</div>
        </div>
      </div>
    `, 'https://outlook.office.com/mail/inbox/id/example');

    const editor = findOutlookComposeEditors(document)[0];
    const context = extractOutlookCurrentContext(document, editor);
    expect(context?.messages).toHaveLength(1);
    expect(context?.messages[0]?.body).toContain('Tuesday still works');
    expect(context?.messages[0]?.body).not.toContain('Reading pane only body');
  });

  it('reads reading-pane cards when the inline reply has no compose quote', () => {
    installDom(`
      <main id="ReadingPaneContainerId" aria-label="Reading Pane" data-app-section="MailReadCompose">
        <div id="ConversationReadingPaneContainer">
          <span id="CONV_1_SUBJECT">Stat 385 HW1</span>
          <div aria-label="2 messages">
            <div class="card">
              <span role="button" aria-label="From: Hao, Yuncheng">You</span>
              <div role="heading" aria-level="3">Fri 09/11/2026 10:07 PM</div>
              <div>Dear Prof. Zhang, grading for HW1 is done.</div>
            </div>
            <div class="card">
              <span role="button" aria-label="From: Zhong, Ping-Shou">Zhong, Ping-Shou</span>
              <div role="heading" aria-level="3">Sat 09/19/2026 09:51 AM</div>
              <div role="document" aria-label="Message body">Good morning Yuncheng, the rubrics look good.</div>
            </div>
            <div class="card">
              <div role="heading" aria-level="3">[Draft]</div>
              <div>This message hasn't been sent.</div>
              <div id="docking_InitVisiblePart_1">
                <div aria-label="Message body" contenteditable="true"></div>
              </div>
            </div>
          </div>
        </div>
      </main>
    `, 'https://outlook.cloud.microsoft/mail/inbox/id/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(getOutlookComposeKind(editor)).toBe('reply');
    const context = extractOutlookCurrentContext(document, editor);
    expect(context?.subject).toBe('Stat 385 HW1');
    expect(context?.messages.map((message) => message.body)).toEqual([
      'Dear Prof. Zhang, grading for HW1 is done.',
      'Good morning Yuncheng, the rubrics look good.',
    ]);
    expect(context?.messages[0]?.sender).toContain('Hao, Yuncheng');
    expect(context?.messages[1]?.sender).toContain('Zhong, Ping-Shou');
  });

  it('returns null for unstructured reading-pane dumps beside a new compose', () => {
    installDom(`
      <main id="ReadingPaneContainerId">From: chrome@outlook Whole pane dump email@example.com</main>
      ${outlookComposeShell}
    `, 'https://outlook.office.com/mail/');

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

  it('preserves line breaks when reading an existing Outlook draft', () => {
    installDom(`<div><div aria-label="Message body" contenteditable="true">
      <div class="elementToProof">This is a test email.</div>
      <div class="elementToProof"><br></div>
      <div class="elementToProof">Best regards,</div>
      <div class="elementToProof">Yuncheng</div>
    </div></div>`, 'https://outlook.live.com/mail/compose/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(readPlainTextFromOutlookEditor(editor)).toBe('This is a test email.\n\nBest regards,\nYuncheng');
  });

  it('does not treat Outlook quoted reply content as the current draft', () => {
    installDom(`<div><div aria-label="Message body" contenteditable="true">
      <div></div><hr><div id="divRplyFwdMsg">From: ois@uic.edu\nSubject: Campus update</div>
      <div>Quoted body should not become the draft.</div>
    </div></div>`, 'https://outlook.live.com/mail/compose/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(readPlainTextFromOutlookEditor(editor)).toBe('');
  });

  it('cuts the draft at divRplyFwdMsg even when a later blockquote exists', () => {
    installDom(`
      <div aria-label="Message body" contenteditable="true">
        <div>My reply draft.</div>
        <hr>
        <div id="divRplyFwdMsg">From: Zhong, Ping-Shou &lt;pszhong@uic.edu&gt;<br>Subject: Re: Homework</div>
        <div>Good morning Yuncheng,</div>
        <blockquote>On Sep 18, Hao &lt;yhao24@uic.edu&gt; wrote:<br>Older quoted body.</blockquote>
      </div>
    `, 'https://outlook.live.com/mail/inbox/id/example');

    const editor = findOutlookComposeEditors(document)[0];
    expect(readPlainTextFromOutlookEditor(editor)).toBe('My reply draft.');
    expect(readPlainTextFromOutlookEditor(editor)).not.toContain('Good morning Yuncheng');
    expect(readPlainTextFromOutlookEditor(editor)).not.toContain('Older quoted body');
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
    expect(context?.messages).toHaveLength(1);
    expect(context?.messages[0]?.body).toContain('Tuesday still works');
    expect(context?.messages[0]?.sender).toContain('ois@uic.edu');
    expect(context?.participants).toEqual(expect.arrayContaining(['ois@uic.edu', 'yhao24@uic.edu']));
  });

  it('peels a nested reply chain by blockquote and HR + RplyFwdMsg boundaries', () => {
    installDom(`
      <div data-app-section="MailReadCompose">
        <input aria-label="Subject" value="Re: Stat 385 HW1">
        <div aria-label="Message body" contenteditable="true">
          <hr>
          <div id="divRplyFwdMsg">From: Zhong, Ping-Shou &lt;pszhong@uic.edu&gt;<br>Sent: Saturday, September 19, 2026 09:51 AM<br>To: Hao, Yuncheng &lt;yhao24@uic.edu&gt;<br>Subject: Re: Stat 385 HW1</div>
          <div>Good morning Yuncheng, the rubrics look good.</div>
          <div>&lt;sol_hw2_q2b.R&gt;&lt;sol_hw2_q2c.R&gt;</div>
          <blockquote>
            <div>On Sep 18, 2026, at 5:33 PM, Hao, Yuncheng &lt;yhao24@uic.edu&gt; wrote:</div>
            <div>Dear Professor Zhong, I finished grading HW 2.</div>
            <hr>
            <div id="x_divRplyFwdMsg">From: Zhong, Ping-Shou &lt;pszhong@uic.edu&gt;<br>Sent: Friday, September 18, 2026 01:03 PM<br>To: Hao, Yuncheng &lt;yhao24@uic.edu&gt;</div>
            <div>Hi Yuncheng, I will update the solution.</div>
            <blockquote>
              <div>On Sep 18, 2026, at 12:43 PM, Hao, Yuncheng &lt;yhao24@uic.edu&gt; wrote:</div>
              <div>Hi Professor Zhong, thank you for the clarification.</div>
            </blockquote>
          </blockquote>
        </div>
      </div>
    `, 'https://outlook.cloud.microsoft/mail/inbox/id/example');

    const context = extractOutlookCurrentContext(document);
    expect(context?.messages.map((message) => message.body)).toEqual([
      'Hi Professor Zhong, thank you for the clarification.',
      'Hi Yuncheng, I will update the solution.',
      'Dear Professor Zhong, I finished grading HW 2.',
      'Good morning Yuncheng, the rubrics look good.',
    ]);
    expect(context?.messages.some((message) => message.body.includes('sol_hw2'))).toBe(false);
    expect(context?.messages[0]?.sender).toContain('yhao24@uic.edu');
    expect(context?.messages[0]?.sender).toContain('Hao, Yuncheng');
    expect(context?.messages[0]?.date).toBe('Sep 18, 2026, at 12:43 PM');
    expect(context?.messages[2]?.sender).toContain('yhao24@uic.edu');
    expect(context?.messages[2]?.date).toBe('Sep 18, 2026, at 5:33 PM');
    expect(context?.messages[3]?.sender).toContain('Zhong, Ping-Shou');
    expect(context?.messages[3]?.date).toContain('September 19, 2026');
    expect(context?.subject).toBe('Re: Stat 385 HW1');
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

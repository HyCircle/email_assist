import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  extractOutlookThreadContext,
  findOutlookComposeEditors,
  insertPlainTextIntoOutlook,
  readPlainTextFromOutlookEditor,
} from '../src/outlook-dom';

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

describe('outlook-dom', () => {
  it('finds compose editors and extracts reading pane content in reply mode', () => {
    installDom(
      `
        <div role="heading" class="screenReaderOnly">Navigation pane</div>
        <section>
          <div aria-label="Message body" role="textbox" contenteditable="true">Draft body</div>
        </section>
        <div>
          From: ois@uic.edu &lt;ois@uic.edu&gt;
          Sent: Tuesday, August 26, 2025 10:19 AM
          To: yhao24@uic.edu &lt;yhao24@uic.edu&gt;
          Subject: Quarterly update
          <table>
            <tr>
              <td>
                <h1>Office of International Services</h1>
                <h1>Quarterly update</h1>
                <p>Please confirm whether Tuesday still works.</p>
              </td>
            </tr>
          </table>
        </div>
      `,
      'https://outlook.live.com/mail/inbox/id/example',
    );

    const editors = findOutlookComposeEditors(document);
    const thread = extractOutlookThreadContext(document);

    expect(editors).toHaveLength(1);
    expect(readPlainTextFromOutlookEditor(editors[0])).toContain('Draft body');
    expect(thread.subject).toBe('Quarterly update');
    expect(thread.messages[0]?.body).toContain('Tuesday still works');
    expect(thread.messages[0]?.sender).toContain('ois@uic.edu');
    expect(thread.participants).toContain('ois@uic.edu');
    expect(thread.participants).toContain('yhao24@uic.edu');
  });

  it('does not treat the Outlook page title as a thread subject for a brand new compose', () => {
    installDom(
      `
        <section>
          <input aria-label="Subject" value="" />
          <div aria-label="Message body" role="textbox" contenteditable="true"></div>
        </section>
      `,
      'https://outlook.live.com/mail/',
    );

    document.title = 'Mail - User Name - Outlook';

    const thread = extractOutlookThreadContext(document);

    expect(thread.subject).toBe('');
    expect(thread.messages).toEqual([]);
  });

  it('preserves quoted reply content when inserting a generated draft', () => {
    installDom(
      `
        <section>
          <div aria-label="Message body" role="textbox" contenteditable="true">
            <div class="elementToProof"><br></div>
            <div class="_Entity _EType_OWA_VirtualEdit_Placeholder"><br></div>
            <div>From: ois@uic.edu &lt;ois@uic.edu&gt;</div>
            <div>Sent: Tuesday, August 26, 2025 10:19 AM</div>
            <div>Original quoted reply body.</div>
          </div>
        </section>
      `,
      'https://outlook.live.com/mail/inbox/id/example',
    );

    const editor = findOutlookComposeEditors(document)[0];
    insertPlainTextIntoOutlook(editor, 'Thanks for the update.\n\nBest regards,');

    expect(editor.textContent).toContain('Thanks for the update.');
    expect(editor.textContent).toContain('Original quoted reply body.');
    expect(editor.querySelector('[data-email-assist-draft="true"]')?.textContent).toContain('Best regards');
  });
});
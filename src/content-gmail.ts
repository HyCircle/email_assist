import './panel.css';

import {
	extractGmailThreadContext,
	findGmailComposeEditors,
	getGmailAssistantAnchor,
	getGmailComposeMount,
	insertGmailSubject,
	insertPlainTextIntoGmail,
	readGmailSubject,
	readPlainTextFromGmailEditor,
} from './gmail-dom';
import { attachAssistantPanel } from './panel';

const instances = new Map<HTMLElement, ReturnType<typeof attachAssistantPanel>>();

function scanComposeSurfaces(): void {
	for (const [editor, instance] of instances.entries()) {
		if (!editor.isConnected) {
			instance.cleanup();
			instances.delete(editor);
		}
	}

	for (const editor of findGmailComposeEditors()) {
		if (instances.has(editor)) {
			instances.get(editor)?.refreshPosition();
			continue;
		}

		const instance = attachAssistantPanel({
			provider: 'gmail',
			editor,
			getComposeMount: getGmailComposeMount,
			getTriggerAnchor: getGmailAssistantAnchor,
			getThreadContext: () => extractGmailThreadContext(document),
			panelDirection: 'auto',
			readDraft: readPlainTextFromGmailEditor,
			readSubject: readGmailSubject,
			insertDraft: insertPlainTextIntoGmail,
			insertSubject: insertGmailSubject,
		});

		instances.set(editor, instance);
	}
}

const observer = new MutationObserver(() => {
	scanComposeSurfaces();
});

observer.observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener('hashchange', scanComposeSurfaces);
window.setInterval(scanComposeSurfaces, 1500);

scanComposeSurfaces();
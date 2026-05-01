import './panel.css';

import {
	extractOutlookThreadContext,
	findOutlookComposeEditors,
	getOutlookAssistantAnchor,
	getOutlookComposeMount,
	insertOutlookSubject,
	insertPlainTextIntoOutlook,
	readOutlookSubject,
	readPlainTextFromOutlookEditor,
} from './outlook-dom';
import { attachAssistantPanel } from './panel';

const instances = new Map<HTMLElement, ReturnType<typeof attachAssistantPanel>>();

function scanComposeSurfaces(): void {
	for (const [editor, instance] of instances.entries()) {
		if (!editor.isConnected) {
			instance.cleanup();
			instances.delete(editor);
		}
	}

	for (const editor of findOutlookComposeEditors()) {
		if (instances.has(editor)) {
			instances.get(editor)?.refreshPosition();
			continue;
		}

		const instance = attachAssistantPanel({
			provider: 'outlook',
			editor,
			getComposeMount: getOutlookComposeMount,
			getTriggerAnchor: getOutlookAssistantAnchor,
			getThreadContext: () => extractOutlookThreadContext(document),
			panelDirection: 'down',
			readDraft: readPlainTextFromOutlookEditor,
			readSubject: readOutlookSubject,
			insertDraft: insertPlainTextIntoOutlook,
			insertSubject: insertOutlookSubject,
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
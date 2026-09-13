import type { ComposeKind, ContextItem, DraftPhase, DraftSession } from './types';

export function createDraftSession(
  composeKind: ComposeKind,
  contexts: ContextItem[],
  initialDraft = '',
  initialSubject = '',
): DraftSession {
  const draft = initialDraft.trim();
  return {
    composeKind,
    contexts: [...contexts],
    draft,
    suggestedSubject: composeKind === 'new' ? initialSubject.trim() : '',
    phase: draft ? 'ready' : 'idle',
    error: '',
  };
}

export function startDraftRequest(session: DraftSession): DraftSession {
  return {
    ...session,
    phase: session.draft ? 'improving' : 'drafting',
    error: '',
  };
}

export function finishDraftRequest(session: DraftSession, draft: string, suggestedSubject?: string): DraftSession {
  return {
    ...session,
    draft: draft.trim(),
    suggestedSubject: suggestedSubject === undefined ? session.suggestedSubject : suggestedSubject.trim(),
    phase: 'ready',
    error: '',
  };
}

export function failDraftRequest(session: DraftSession, error: string): DraftSession {
  return {
    ...session,
    phase: 'error',
    error: error.trim(),
  };
}

export function setSessionContexts(session: DraftSession, contexts: ContextItem[]): DraftSession {
  return { ...session, contexts: [...contexts] };
}

export function setSessionDraft(session: DraftSession, draft: string): DraftSession {
  return {
    ...session,
    draft,
    suggestedSubject: draft.trim() ? session.suggestedSubject : '',
    phase: draft.trim() ? 'ready' : 'idle',
    error: '',
  };
}

export function startOver(session: DraftSession): DraftSession {
  return {
    ...session,
    draft: '',
    suggestedSubject: '',
    phase: 'idle',
    error: '',
  };
}

export function getPrimaryActionLabel(phase: DraftPhase, hasDraft: boolean): string {
  if (phase === 'drafting' || phase === 'improving') {
    return 'Working…';
  }

  return hasDraft ? 'Improve' : 'Draft';
}

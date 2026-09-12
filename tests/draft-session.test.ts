import { describe, expect, it } from 'vitest';

import { createDraftSession, finishDraftRequest, setSessionDraft, startDraftRequest, startOver } from '../src/draft-session';

describe('draft session', () => {
  it('passes the current draft from Draft into repeated Improve requests', () => {
    const session = createDraftSession('reply', []);
    const drafting = startDraftRequest(session);
    const ready = finishDraftRequest(drafting, 'Thanks for the update.');
    const improving = startDraftRequest(ready);

    expect(drafting.phase).toBe('drafting');
    expect(ready.phase).toBe('ready');
    expect(improving.phase).toBe('improving');
    expect(improving.draft).toBe('Thanks for the update.');
    expect(startOver(improving).draft).toBe('');
  });

  it('clears a stale subject when the current draft is manually cleared', () => {
    const session = finishDraftRequest(startDraftRequest(createDraftSession('new', [])), 'Hello.', 'Meeting update');
    expect(setSessionDraft(session, '').suggestedSubject).toBe('');
  });
});

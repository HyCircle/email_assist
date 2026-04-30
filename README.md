# Email Assistant

Local-first Chrome extension for drafting and refining emails inside Gmail and Outlook Web.

## What It Is

Email Assistant adds a small assistant surface to webmail compose and reply flows.

The page already provides the main UI. The extension only adds the missing pieces:

- an assistant trigger near compose or reply
- a small prompt or refine input
- a result area for generated text
- a settings page for endpoint and model configuration

The assistant reads the current open thread from the page, accepts a short instruction, calls a configured LLM endpoint, and returns a draft that the user can insert or copy.

The assistant never sends email automatically.

## Product Principles

- Human in the loop at all times
- Thread-aware, not inbox-aware
- Local-first by default
- Minimal UI on top of existing webmail
- Readability over architecture

## Primary User Flow

1. Open a thread in Gmail or Outlook Web.
2. Open a reply or compose surface.
3. Click the assistant button.
4. Enter a short instruction such as `reply politely and propose Friday` or `rewrite shorter and firmer`.
5. Review the generated result.
6. Insert it into the compose box or copy it.

## Supported Providers

- Gmail web
- Outlook Web

Provider support is DOM-based in v1. The extension reads the currently open thread from the page and writes back into the current compose surface only when the user explicitly asks for insertion.

## Scope For V1

- Gmail and Outlook Web only
- Current open thread only
- Reply, compose assist, and rewrite
- Manual trigger only
- Manual insert or copy only
- Configurable local or remote LLM endpoint
- Plain text output first
- Minimal settings page

## Non-Goals For V1

- Mailbox-wide search
- Gmail API integration
- Outlook API integration
- OAuth login flow
- Auto-send
- Streaming token output
- Multi-profile identity management
- Provider plugin system
- Agent frameworks or orchestration runtimes

## UI Approach

This project should not build a full custom app inside the browser.

The webmail page is the main product surface. The extension should add only:

- a compact entry point near reply or compose
- a lightweight panel or drawer for prompt and result
- a settings page for endpoint, model, temperature, and user style notes

Keep the UI small enough that it feels like a writing tool, not a second mailbox.

## Privacy Model

- The extension should send data only to the LLM endpoint configured by the user.
- Local LLM endpoints are the default and recommended setup.
- Thread content is taken from the current page, not from mailbox APIs.
- The extension should request the smallest possible permissions.
- Model output should be inserted as plain text by default.

## State Model

This product is a simple UI workflow, not an agent workflow.

Use explicit local state such as:

- `idle`
- `ready`
- `loading`
- `showing-result`
- `error`

If refinement is supported, treat it as another user-triggered request over the current draft.

Do not use LangGraph for v1.

## Architecture Shape

Use Manifest V3 and keep the codebase small.

- `content-gmail.ts`: Gmail DOM integration only
- `content-outlook.ts`: Outlook Web DOM integration only
- `gmail-dom.ts`: Gmail selectors and thread extraction helpers
- `outlook-dom.ts`: Outlook selectors and thread extraction helpers
- `panel.ts`: injected panel behavior only
- `panel.css`: panel styling only
- `background.ts`: storage access, request coordination, and extension lifecycle
- `prompt.ts`: prompt assembly only
- `llm.ts`: LLM HTTP client only
- `storage.ts`: settings persistence only
- `types.ts`: shared types only
- `constants.ts`: fixed defaults only

Two providers justify two DOM modules. They do not justify a generic provider framework.

## Suggested Repo Layout

```text
.
|- AGENTS.md
|- README.md
|- manifest.json
|- package.json
|- tsconfig.json
|- vite.config.ts
|- src/
|  |- background.ts
|  |- content-gmail.ts
|  |- content-outlook.ts
|  |- gmail-dom.ts
|  |- outlook-dom.ts
|  |- panel.ts
|  |- panel.css
|  |- prompt.ts
|  |- llm.ts
|  |- storage.ts
|  |- types.ts
|  |- constants.ts
|- tests/
|  |- prompt.test.ts
|  |- gmail-dom.test.ts
|  |- outlook-dom.test.ts
```

## Recommended Stack

- TypeScript
- Vite
- `@crxjs/vite-plugin`
- Vitest
- Plain DOM APIs first

React is optional, not the default.

## Provider Rules

- Support only the currently open thread.
- Use stable attributes and structural selectors where possible.
- Isolate brittle selectors in provider-specific modules.
- Share code only after thread extraction.
- If a feature needs Gmail API or Outlook API access, treat it as a later phase.

## Milestones

### Milestone 0

- inject a Gmail assistant trigger
- extract visible Gmail thread content
- open a minimal panel
- send a request to a local LLM endpoint
- return a usable draft

### Milestone 1

- insert generated text into Gmail compose reliably
- persist endpoint and basic settings
- support refine over the current draft

### Milestone 2

- repeat the same flow for Outlook Web
- add Outlook Web insertion support
- align shared prompt and storage behavior

### Milestone 3

- add rewrite helpers such as shorten, soften, clarify, and translate
- improve long-thread extraction where cheap and safe

## Definition Of Done

The project is useful when opening a real email thread, clicking one button, entering one instruction, and getting a usable result is faster than manual copy and paste.

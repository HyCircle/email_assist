# AGENTS.md

## Mission

Build a small, readable Chrome extension that helps draft and refine emails inside Gmail and Outlook Web.

The product is a human-in-the-loop writing assistant. It is not an autonomous email agent.

## Product Boundaries

- Gmail and Outlook Web only in v1
- Thread-aware, not inbox-aware
- No auto-send
- No OAuth in v1
- No mailbox API integration in v1
- No provider plugin system in v1
- No streaming output in v1
- No LangGraph in v1

If a task pushes beyond these boundaries, reduce scope before adding architecture.

## Core User Flow

1. User opens a Gmail or Outlook Web thread.
2. Extension extracts the visible thread context.
3. User opens the assistant near compose or reply.
4. User enters a prompt or refine instruction.
5. Extension generates a draft.
6. User reviews it.
7. User inserts it into compose or copies it.

Every code change should improve the speed, clarity, or reliability of this loop.

## UX Rules

- The host page is the main UI.
- The extension adds only a small trigger, a small panel, and a settings page.
- Do not build a full app inside the page.
- Keep the assistant visually secondary to the actual email editor.
- Default to explicit user actions for generate, refine, insert, and copy.

## Architecture Rules

- Keep the repo flat.
- Prefer a single `src/` directory with small files.
- Do not create subdirectories unless readability clearly improves.
- Do not introduce abstractions for implementations that do not exist yet.
- Do not add event buses, store libraries, or custom orchestration layers by default.
- Prefer plain TypeScript, DOM APIs, and direct message passing.
- Support the two providers with two explicit DOM modules.
- Duplicate small provider-specific DOM code before abstracting it.

## File Ownership

- `content-gmail.ts`: Gmail page integration only
- `content-outlook.ts`: Outlook Web page integration only
- `gmail-dom.ts`: Gmail selectors and extraction helpers only
- `outlook-dom.ts`: Outlook selectors and extraction helpers only
- `panel.ts`: panel behavior only
- `panel.css`: panel styling only
- `background.ts`: extension lifecycle, storage access, and request coordination only
- `prompt.ts`: prompt assembly only
- `llm.ts`: HTTP client only
- `storage.ts`: settings persistence and import/export normalization only
- `settings.ts`: settings page behavior only
- `settings.css`: settings page styling only
- `draft-session.ts`: draft session transitions only
- `media.ts`: attachment image compression and same-origin reads only
- `icon.svg`: in-page Assist trigger and source artwork
- `icon-128.png`: Chrome toolbar icon; Chrome does not accept SVG here
- `types.ts`: shared types only

If a file starts doing two jobs, split it by responsibility, not by pattern.

## Documentation Rules

- Keep `README.md` user-facing: what the extension does, how to build it, how to load it, and how to configure it.
- Keep the living architecture in `docs/architecture.md`.
- Keep agent working rules, anti-goals, and file ownership in `AGENTS.md`.
- If README starts reading like an internal design memo, move that content to the architecture doc or here.

## State Rules

- Model UI state with explicit plain TypeScript data.
- Prefer request lifecycle states such as `idle`, `loading`, `success`, and `error`.
- Treat refinement as another user-triggered request on the current draft.
- Do not use LangGraph or any agent framework for button-click UI flows.
- Add a larger state model only if a concrete bug or complexity requires it.

## Provider Rules

- Support only the currently open thread.
- Prefer stable attributes and structural selectors over obfuscated class names.
- Expect selectors to break and isolate them in `gmail-dom.ts` and `outlook-dom.ts`.
- Shared logic should start after thread extraction.
- Do not promise mailbox-wide search from DOM scraping.
- If a feature needs Gmail API or Outlook API access, mark it as a later phase.

## Security Rules

- Request the smallest possible permissions.
- Treat content script input as untrusted.
- Validate messages from content scripts before privileged actions.
- Never inject model output as raw HTML.
- Default to plain text insertion into compose.
- Never send email automatically.
- Never send thread content anywhere except the user-configured LLM endpoint.

## Settings Rules

- Runtime settings live in `chrome.storage.sync`.
- Defaults live in code. Do not use `.env` for settings.
- Keep settings import/export versioned and backward-compatible with plain settings JSON when practical.
- Request endpoint permission during save or import before relying on the imported endpoint.

## Asset Rules

- Keep a single source icon asset and reuse it for the extension manifest and the in-page trigger.
- Do not introduce duplicate icon variants unless browser compatibility or a concrete UX need requires them.

## Simplicity Rules

- Favor plain functions over classes.
- Favor explicit parameters over hidden global state.
- Keep settings limited to concrete user needs such as endpoint, model, temperature, language, presets, sign-offs, signature, style notes, API key, and transfer helpers.
- Keep prompt logic in code until prompt iteration becomes painful.
- Add comments only for genuinely tricky DOM behavior.

## Testing Rules

- Test pure logic first.
- Add tests for prompt assembly.
- Add tests for Gmail and Outlook DOM parsing helpers where practical.
- Do not start with browser E2E automation.
- Add short manual verification notes for DOM-sensitive changes.

## Build Rules

- Prefer TypeScript with Vite.
- Keep build configuration minimal.
- Keep npm scripts obvious: `dev`, `build`, `test`, `lint`.
- Avoid meta-frameworks unless plain setup becomes clearly worse.

## Anti-Goals

Avoid rebuilding unnecessary structure.

Specifically avoid:

- profile managers
- layered orchestrators
- plugin systems
- provider-agnostic frameworks
- strategy hierarchies
- oversized settings UIs
- streaming pipelines before the non-streaming flow is solid
- agent runtimes for simple generate and refine behavior

## Preferred Development Order

1. Gmail assistant trigger and panel rendering
2. Gmail thread extraction
3. Gmail insertion into compose
4. Basic settings persistence
5. Refine flow on current draft
6. Outlook Web assistant trigger and panel rendering
7. Outlook Web thread extraction
8. Outlook Web insertion into compose
9. Rewrite helpers and polish

Do not optimize later steps before earlier steps are stable.

## Final Principle

When in doubt, cut scope, remove code, and return to the core reply loop.

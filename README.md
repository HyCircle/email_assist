# Email Assistant

Email Assistant is a small Chrome extension for drafting and improving emails inside Gmail and Outlook Web. It keeps the host compose editor in charge: the user reviews the draft and decides when to apply, copy, or send it.

## Flow

1. Open a new email or reply in Gmail or Outlook Web.
2. Open the inline `Assist` strip inside the compose area.
3. For a reply, the visible thread is added automatically. For a new email, add context only with `Context +`.
4. Describe the message and choose `Draft`.
5. Edit the draft or choose an Improve instruction as many times as needed.
6. Review it, then use `Apply` or `Copy`. Sending remains a provider action.

The extension does not send email, search the mailbox, use OAuth, call Gmail/Microsoft APIs, or scan the inbox in the background.

## Configuration

Settings are stored in `chrome.storage.sync`. There is no `.env` file.

- Base URL defaults to `http://pc-yh:8070/v1`; custom HTTP or HTTPS endpoints are supported.
- Saving or importing a custom endpoint requests access to that endpoint origin through Chrome's optional host permission flow.
- Requests use the OpenAI-compatible `/chat/completions` endpoint with `stream: false` and structured `{ subject, body }` output, so a new email's subject and body are generated together on every Draft or Improve.
- Choose `llama.cpp` for the local default; choose `OpenAI-compatible` for providers that accept the standard Chat Completions fields. An optional API key is sent as a Bearer token.
- Reasoning effort, model thinking, and the maximum output token budget are configurable. The endpoint must support structured JSON output with `response_format.json_schema`.
- The base system prompt is editable in Settings and is prefilled with the built-in prompt. Language, style, sign-off, and signature preferences remain separate writing defaults.
- Common models are `Qwen3.8-27B-Q4` and `gemma-4-26B-A4B-QAT`; a custom model is also supported.
- Writing defaults include language, style notes, sign-offs, signature, Draft presets, and Improve presets.
- Visible attached images from the Gmail/Outlook attachment well are resized and compressed before being sent when the mail page can safely read their bytes. Decorative images in the message body are ignored. File attachments contribute metadata only; reading an attachment's contents is reserved for a future explicit Add context action.
- Settings can be exported and imported as versioned JSON.

The manifest declares the local llama.cpp host and the supported Gmail/Outlook hosts. Custom endpoints use optional host permissions and are only requested when the user saves or imports that endpoint.

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

Load the unpacked extension from `dist/` in `chrome://extensions` after each build. Do not generate or commit `.crx` or `.pem` files.

## Tests

Tests cover:

- Draft → Improve session transitions;
- strict background message and sender validation;
- base URL and OpenAI-compatible request assembly;
- prompt context separation and current-draft passing;
- Gmail and Outlook compose/context extraction;
- plain-text insertion with signatures and quoted replies;
- prompt and draft history preview and restore;
- settings normalization and transfer payloads.

DOM-sensitive changes should also be checked manually in Gmail, personal Outlook, and campus Outlook with a new compose, a reply, repeated Improve, Context +, Apply, Copy, and reopening the compose surface.

# Email Assistant

Email Assistant is a Chrome extension that helps you draft and improve emails **inside Gmail and Outlook Web**. It sits next to the compose editor, generates a candidate, and waits for you to review it.

You stay in control of send. The extension never sends mail, never talks to Gmail or Microsoft APIs, and never scans your inbox in the background.

Current version: **0.2.4**.

## What you get

- An **Assist** strip inside the compose or reply window
- A first **Draft**, then as many **Improve** passes as you want
- **Apply** into the provider editor, or **Copy** to the clipboard
- Thread context on replies, plus optional pasted reference emails
- A settings page for the model endpoint and writing defaults

It works on:

- Gmail (`mail.google.com`)
- Outlook Web (`outlook.live.com`, `outlook.office.com`, and `outlook.cloud.microsoft` `/mail/` pages)

## Install

You load this as an unpacked extension. There is no store package and no `.crx` to download.

1. Install Node.js, then from this repo:

   ```bash
   npm install
   npm run build
   ```

2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `dist/` folder produced by the build.

After you change code, run `npm run build` again, then click **Reload** on the extension card. Do not generate or commit `.crx` or `.pem` files.

## Configure the model

The extension does not ship a hosted model. It calls the OpenAI-compatible Chat Completions API at a URL you provide.

Open settings from the gear in the Assist strip, or from the extension’s options page.

### Connection

| Setting | Default | Notes |
| --- | --- | --- |
| Base URL | `http://pc-yh:8070/v1` | Stored without a trailing slash. Requests go to `{baseUrl}/chat/completions`. |
| Model | `Qwen3.8-27B-Q4-OCR` | Also listed: `gemma-4-26B-A4B-QAT`, plus a custom name. |
| Compatibility | `llama.cpp` | Use `llama.cpp` for the local default. Use `OpenAI-compatible` for providers that expect the usual Chat Completions fields. |
| API key | empty | Optional. Sent as `Authorization: Bearer …`. |
| Temperature | `0.2` | |
| Max output tokens | `2048` | Range 128–8192. |
| Reasoning effort | `low` | `none`, `low`, `medium`, or `high`. Omitted from the request when set to `none`. |
| Thinking | on | llama.cpp only: sent as `chat_template_kwargs.enable_thinking`. |

Use **Test connection** to call `GET {baseUrl}/models` with the same optional API key. Use **Save settings** when you are done.

Saving or importing a custom HTTP/HTTPS endpoint asks Chrome for access to that origin. The local llama.cpp host above is already declared in the manifest. Gmail and Outlook hosts are declared too.

Your endpoint must accept:

- `POST {baseUrl}/chat/completions`
- `stream: false`
- structured JSON via `response_format.json_schema`, returning `{ "subject": string \| null, "body": string }`

`llama.cpp` mode sends `max_tokens`. `OpenAI-compatible` mode sends `max_completion_tokens` instead.

### Writing defaults

These are appended to the request separately from the system prompt:

- **Default language:** English or Chinese
- **Style notes:** optional tone guidance
- **Sign-off options:** one per line; the model is asked to pick one
- **Signature block:** optional fixed text after the sign-off

### System prompt and presets

The base system prompt is editable and starts as the built-in default. Language, style, sign-off, and signature are still added on top, so you do not need to bake those into the prompt.

**Draft presets** appear before the first draft. **Improve presets** appear after a draft exists. One instruction per line.

### Transfer

Under **Advanced** you can export, import, or restore defaults. Export is versioned JSON (`version: 2`). Import also accepts a plain settings object when practical. Importing a new endpoint requests permission for that origin before the settings are saved.

Runtime settings live in `chrome.storage.sync`. There is no `.env` file.

## Use it

1. Open a **new email** or a **reply** in Gmail or Outlook Web.
2. Click **Assist** in the compose area. The strip expands in place; it is not a side panel.
3. Add context if needed:
   - **Reply:** the visible thread is attached automatically as a chip. You can remove it. Click the chip once to read the parsed reply chain, then click it again to return to Prompt / Draft.
   - **New email:** nothing is guessed from the rest of the page. Use **Context +** to paste a labeled reference email (up to 6 items).
4. Describe the message, or pick a preset.
5. Click **Draft** (`Ctrl`/`Cmd`+`Enter` also works).
6. Edit the draft in the strip, or click **Improve** with a new instruction. Repeat as needed.
7. Review, then **Apply** into compose or **Copy**. Sending is still Gmail’s or Outlook’s Send button.

**Esc** collapses an open strip. In Outlook it also stops Esc from discarding the draft.

If the compose box already has text when you open Assist, that text is treated as the current draft and the main button starts as **Improve**.

### New email vs reply

- **New email:** each Draft or Improve returns both a subject and a body. Apply writes both into the native compose fields.
- **Reply:** the model returns `subject: null`. The strip hides the subject field and does not change the existing subject. Apply inserts the body only, leaving the quoted thread and (in Gmail) the signature in place.

Apply inserts **plain text**, never HTML. A later Apply replaces the previous Assist block instead of stacking copies.

### History and start over

Click **Prompt** or **Draft** in the strip to switch that column between the editor and its history.

- Prompt history lists the instructions you already submitted.
- Draft history lists Assist-generated versions (`V1`, `V2`, …), newest first. Restore puts that version back into the editor. Text that was already in compose when you opened Assist is not stored as V1.

**↺ Start over** clears this compose session’s draft, subject, prompt history, and draft history. It does not send anything.

Closing the compose window, leaving the page, or closing the tab cancels an in-flight request. Switching to another tab does not.

### Attachments

Images in the Gmail or Outlook **attachment well** (and files you attach in compose) can be sent with the request when the mail page can safely read their bytes. Those images are resized to a 1600px long edge and compressed as JPEG.

Ordinary file attachments contribute **name, type, and size only**. Decorative images inside the message body are ignored. Reading a file’s contents is not supported yet.

## Limits worth knowing

| Limit | Value |
| --- | --- |
| Context chips | 6 |
| One pasted/thread context | 7,000 characters |
| All context in one prompt | 24,000 characters |
| Instruction | 4,000 characters |
| Draft body | 6,000 characters |
| Thread messages kept | last 12 |
| Request timeout | 45 seconds |

Longer thread text is truncated from the older end.

## Privacy and trust

- Thread content is sent only to the endpoint you configured, and only when you click Draft or Improve.
- Model output is treated as untrusted text and inserted as plain text.
- The extension does not auto-send, search the mailbox, use OAuth, or call Gmail / Microsoft Graph.
- Draft requests are accepted only from the supported mail pages.

## Development

```bash
npm install
npm run lint    # TypeScript check
npm test        # Vitest, no browser E2E
npm run build
npm run dev     # Vite watch, then reload the unpacked extension
```

Tests cover session transitions, message validation, request assembly, prompt context, Gmail/Outlook DOM helpers, insertion around signatures and quoted replies, history restore, and settings import/export.

After DOM-sensitive changes, also try this by hand in Gmail, personal Outlook, and campus Outlook:

- new compose and reply
- Assist open / collapse
- Draft, repeated Improve, Context +, Apply, Copy
- reopen an existing compose that already has text

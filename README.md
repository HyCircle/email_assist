# Email Assistant

Email Assistant is a small Chrome extension for drafting and refining emails inside Gmail and Outlook Web.

It stays inside the existing compose experience: you open a compose or reply box, click the assistant icon, enter an instruction, review the result, and then insert or copy it yourself.

## Features

- Gmail and Outlook Web support
- Generate and refine flows for the current compose surface
- New-mail subject suggestions when the subject is empty
- Plain-text insertion and clipboard copy
- Runtime settings stored in Chrome sync storage
- Export and import for extension settings
- Optional build-time defaults through `.env.local`

## How It Works

1. Open Gmail or Outlook Web.
2. Start a new message or reply.
3. Click the assistant icon next to the compose controls.
4. Enter an instruction such as `reply politely and propose Friday`.
5. Review the generated draft.
6. Insert it into the compose box or copy it.

The extension never sends email automatically.

## Configuration

There are two configuration layers:

- Runtime settings: saved by the extension in `chrome.storage.sync` through the Settings page.
- Build-time defaults: optional values loaded from `.env.local` when you build the extension from source.

Runtime settings include the endpoint, model, temperature, language, presets, sign-off options, signature block, style notes, and API key. They can be exported to a JSON file and imported on another machine.

If you are sharing a built extension with someone else, they do not need a `.env.local` file. They can install the extension and configure everything from the Settings page.

If you are building from source and want prefilled defaults, copy `.env.example` to `.env.local` and edit it.

## Development

```bash
npm install
npm run lint
npm run test
npm run build
```

## Load The Unpacked Extension

1. Run `npm run build`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `dist/` directory.

## Permissions

- Gmail and Outlook Web access is declared up front.
- `localhost` and `127.0.0.1` are predeclared for local-first LLM usage.
- Other LLM endpoints are requested as optional host permissions when saved in Settings.

## Testing

- `prompt.test.ts` covers prompt assembly.
- `gmail-dom.test.ts` and `outlook-dom.test.ts` cover provider DOM helpers.
- `storage.test.ts` covers settings normalization and import/export payloads.

Manual browser verification is still useful for DOM-sensitive provider changes.

## Notes

- The extension currently targets Gmail and Outlook Web only.
- It works on the currently open thread or compose surface only.
- Internal architecture and implementation rules live in [AGENTS.md](AGENTS.md).

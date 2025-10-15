# AI Mate for Thunderbird

AI Mate adds OpenAI powered assistance to Thunderbird. It can draft replies directly in the compose window and summarize messages from both compose and reader toolbars. Everything runs locally in your Thunderbird profile; the add-on never stores data on remote servers.

## Features
- **Compose reply** button that generates a first draft using the message currently open in the composer.
- **Reader summary popup** that can summarize the selected message thread (requires an explicit opt-in in the options page).
- **Custom instructions and tone controls** including temperature, top-p, penalties, and preferred summary style or language.
- **Per-user settings** stored with `browser.storage.local`, so nothing is synced or shared across devices.

## Requirements
- Thunderbird 115 or newer.
- An active OpenAI API key (create one at <https://platform.openai.com/api-keys>).

## Installation (temporary testing)
1. Open Thunderbird and navigate to Tools > Developer Tools > Debug Add-ons (or visit `about:debugging#/runtime/this-thunderbird`).
2. Click **Load Temporary Add-on** and choose the `manifest.json` file inside this repository.
3. The add-on will be available until Thunderbird is closed.

## Initial Setup
1. Go to Thunderbird > Add-ons and Themes > Extensions > AI Mate > Preferences (or use the add-on gear menu to open options).
2. Enter your OpenAI API key, pick a model, and adjust any optional parameters.
3. (Optional) Enable **message display summaries** if you want the reader toolbar button to send currently viewed messages to OpenAI. You can also opt in to start summarizing automatically when the window opens.

## Using AI Mate

### Generate Replies
1. Open a message reply or compose window with the original email quoted.
2. Click the **AI Mate Reply** button (add it via toolbar customization if hidden).
3. Optionally type extra guidance in the popup prompt field.
4. Click **Generate Reply**. The add-on inserts the AI draft at the top of the compose body while leaving the quoted message beneath it.

### Summarize in the Composer
1. Open the AI Mate popup from the compose toolbar.
2. Click **Summarize Email** to send the current draft and quoted content to OpenAI.
3. The summary appears in the popup; use **Clear summary** to remove it.

### Summarize in the Message Reader
1. Enable **message display summaries** in the options page.
2. Select any message and click the AI Mate button in the message display toolbar.
3. The reader popup shows the summary once OpenAI responds. Copy it with **Copy Summary** if needed.

## Data Use and Privacy
- No email content is sent to OpenAI until you provide a valid API key and trigger an AI feature.
- When triggered, the add-on sends the message text, subject, sender, recipient list, and any custom instruction to the OpenAI API.
- Responses from OpenAI are sanitized with DOMPurify before they are inserted into Thunderbird.
- All configuration data remains in `browser.storage.local` within your Thunderbird profile.

## Packaging for Release
- **Windows (PowerShell):** `./pack.ps1` (outputs `dist/ai-mate-<version>.xpi`)
- **macOS/Linux:** `zip -r ai-mate-<version>.xpi . -x "*.git*" -x "*.xpi" -x "tmp_unpack/*"`

## Support
- Questions or feedback: <https://github.com/EnriqueITE/AI-Mate>
- X (Twitter): <https://x.com/EnriqueITE>
- Buy Me a Coffee: <https://buymeacoffee.com/enriqueite>



AI Mate - Thunderbird Add-on

 █████╗ ██╗    ███╗   ███╗ █████╗ ████████╗███████╗
██╔══██╗██║    ████╗ ████║██╔══██╗╚══██╔══╝██╔════╝
███████║██║    ██╔████╔██║███████║   ██║   █████╗  
██╔══██║██║    ██║╚██╔╝██║██╔══██║   ██║   ██╔══╝  
██║  ██║██║    ██║ ╚═╝ ██║██║  ██║   ██║   ███████╗
╚═╝  ╚═╝╚═╝    ╚═╝     ╚═╝╚═╝  ╚═╝   ╚═╝   ╚══════╝
                                                   
Repository: https://github.com/EnriqueITE/AI-Mate
Author: Enrique Serrano Aparicio (https://x.com/EnriqueITE | https://buymeacoffee.com/enriqueite)

Overview
- Adds a button in the compose window to generate a reply using OpenAI.
- Optional prompt in a popup to steer the reply.
- Settings page to store your OpenAI API key and choose the model.

Model Configuration
- Where: Thunderbird > Add-ons > Extensions > AI Mate > Preferences.
- Models: Choose among `gpt-5`, `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`, `gpt-3.5-turbo`.
- Defaults: Click "Use model defaults" to apply recommended parameters per model.
  - gpt-5 → temperature 1, top_p 1, presence 0, frequency 0, max_tokens empty
  - gpt-4o(-mini) → temperature 0.4, top_p 1, presence 0, frequency 0, max_tokens empty
  - gpt-4.1(-mini) → temperature 0.5, top_p 1, presence 0, frequency 0, max_tokens empty
  - gpt-3.5-turbo → temperature 0.7, top_p 1, presence 0, frequency 0, max_tokens empty
- Advanced parameters (optional):
  - Temperature (0–2): Creativity. Higher = more diverse replies.
  - Top P (0–1): Nucleus sampling. Usually keep at 1.
  - Max tokens: Hard cap for reply length. Leave empty to let the API decide.
  - Presence/Frequency penalty (-2–2): Reduce repetition, encourage new topics.
- gpt-5 constraints: For `gpt-5`, advanced fields are disabled. The add-on only sends supported fields (e.g., omits temperature/top_p/penalties) and includes a fallback to strip unsupported params if the API returns `unsupported_value`.
- Storage: Your selection (API key, model, and parameters) is saved locally via `browser.storage.local`.
- Apply at generation: The background script builds the OpenAI Chat Completions payload using your saved model and parameters. `max_tokens` is only sent if you set a number.

Files
- manifest.json
- background.js
- popup.html, popup.js, popup.css
- options.html, options.js, options.css
- Logo.png, PRIVACY.md, pack.ps1

Install (Temporary)
1. Open Thunderbird.
2. Go to Tools > Developer Tools > Debug Add-ons (or open about:debugging#/runtime/this-firefox and switch to "This Thunderbird").
3. Click "Load Temporary Add-on" and select this folder's manifest.json.
4. Open Add-ons Manager > Extensions > AI Mate > Preferences to set your OpenAI API key and model.

Usage
- Compose a reply to any message so the editor contains the quoted original.
- Click the "Generate AI Reply" button in the compose toolbar (enable it via toolbar customization if hidden).
- Optionally enter an instruction (prompt) in the popup, then click "Generate Reply".
- The add-on inserts the generated text at the top and keeps the quoted original below.

Notes
- The API key is stored locally via browser.storage.local (not synced).
- The add-on only reads the current compose content; it does not fetch messages from the account.
- If the compose body is HTML, the reply is inserted as simple HTML; otherwise plain text.

Packaging
- Windows (PowerShell): `./pack.ps1` (outputs `dist/ai-mate-<version>.xpi`)
- macOS/Linux: `zip -r ai-mate-<version>.xpi . -x "*.git*" -x "*.xpi" -x "tmp_unpack/*"`

Release Checklist
- Bump `manifest.json` version
- Verify `icons` render (16/24/32 toolbar, 48/96/128 listing)
- Verify API key prompt and generation flow
- Validate on Thunderbird 115+ via temporary install

Release Notes
- 1.0.14 (2025-10-13)
  - Improved summary rendering with richer Markdown support while avoiding unsafe HTML injection.
  - Prevented summary requests when no OpenAI API key is configured and guided users to the settings page.
  - Refined packaging workflow to emit clean release bundles under `dist/` and keep build artefacts out of version control.

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
- Windows (PowerShell): `./pack.ps1` (outputs `ai-mate-<version>.xpi`)
- macOS/Linux: `zip -r ai-mate-<version>.xpi . -x "*.git*" -x "*.xpi" -x "tmp_unpack/*"`

Release Checklist
- Bump `manifest.json` version
- Verify `icons` render (16/24/32 toolbar, 48/96/128 listing)
- Verify API key prompt and generation flow
- Validate on Thunderbird 115+ via temporary install


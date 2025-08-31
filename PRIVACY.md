AI Mate – Privacy Policy

Summary
- No account or telemetry is collected by this add‑on.
- Your OpenAI API key is stored locally using `browser.storage.local` and never leaves your device unless Thunderbird sync is enabled (this add‑on does not request sync).
- When you click generate, the current compose content and your optional instruction are sent to OpenAI’s API to produce a reply. Nothing is sent automatically.

Data We Process
- Input: The text of your draft (quoted original and your prompt) is sent to OpenAI to generate a reply.
- Storage: API key, chosen model and last prompt are stored locally.

Third Parties
- OpenAI API (`api.openai.com`) is contacted for generation. Their processing is governed by OpenAI’s terms and privacy policy.

Permissions Justification
- `compose`: Read/modify the open compose window to insert the reply.
- `storage`: Save API key, model and last prompt locally.
- `tabs`: Locate the active compose tab.
- `notifications`: Provide user feedback when generating or on errors.
- `https://api.openai.com/*`: Call the OpenAI API.

Contact
- For questions or removal requests, disable or remove the add‑on from Thunderbird Add‑ons Manager.


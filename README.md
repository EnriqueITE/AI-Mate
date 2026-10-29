# AI Mate for Thunderbird

AI Mate adds OpenAI powered assistance to Thunderbird. It drafts replies directly in the compose window and summarizes messages from the compose and reader toolbars. Settings are stored in your Thunderbird profile; the selected email content is sent to OpenAI when you use an AI feature.

## Features
- **Compose reply** button with **Natural**, **Formal**, and **Friendly** styles. Natural is the default, and the add-on remembers your choice.
- **Reply length** choices: **Short**, **Normal**, and **Detailed**. Normal is the default. Length guides how much the reply develops the available information; it does not cut text to a fixed size.
- **Structured replies** with a greeting, readable paragraphs, and an appropriate closing, while preserving the existing signature and quoted message.
- **Regenerate a reply** within the same compose session without accumulating copies of an unchanged AI draft. Edited or unrecognizable previous replies are left in place with an explanation.
- **Improve Draft** rewrites the current authored text, including manually edited AI text, while retaining its meaning, data, and link destinations. Recognizable signatures and quotes stay in place.
- **Writing preferences** save reusable guidance separately from the last instruction. Explicit instructions for the current operation take priority.
- **Undo last change** reverses the most recent insertion, regeneration, or improvement in that compose window, provided its result is still intact.
- **Reader summary popup** for the selected message, including any quoted conversation in its body (requires an explicit opt-in in the options page).
- **Custom instructions and model settings**, plus preferred summary style and language.
- **Expanded model selection** with nine listed models and **Other model** for a custom ID. Saved model choices are preserved when upgrading.
- **Test model** checks whether the selected model responds using the key entered in settings, without sending email content or saved writing instructions.
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
2. Enter your OpenAI API key, pick a model, and adjust any optional parameters. New installations use `gpt-4o-mini`; upgrading keeps your current model.
3. (Optional) Click **Test model** before saving. It uses the key and model currently entered, including unsaved changes, and makes a small paid API request with a fixed short diagnostic instruction. A successful result confirms that the model responded to that request; it does not evaluate email-writing quality. Testing does not save your settings.
4. (Optional) Add **Writing preferences** for reusable guidance, such as preferred wording or how to address the reader. These apply to generation and improvement, not summaries.
5. (Optional) Enable **message display summaries** if you want the reader toolbar button to send currently viewed messages to OpenAI. You can separately opt in to start summarizing automatically when the summary popup opens.
6. Click **Save** to persist your key, selected model, and other settings. Test model alone does not save them.

### Models and Parameters

The selector includes `gpt-6-luna`, `gpt-6.1-sol`, and `gpt-6-astra` alongside the existing `gpt-5`, `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini`, `gpt-4.1`, and `gpt-3.5-turbo` entries. Choose **Other model** to enter an exact model ID, including an ID already stored by an earlier installation. A listed model is a selectable option, not a guarantee of access for your API account or a writing-quality recommendation. OpenAI documents the added model IDs at [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), and [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra).

Generation, draft improvement, and both summary actions share the same model and parameter handling. AI Mate disables sampling controls it cannot safely apply to the selected model and omits those parameters from requests. The **Max tokens** control remains available. For modern models this cap uses `max_completion_tokens`, which includes hidden reasoning tokens as well as visible output; a small cap may therefore leave little or no visible text. See the [Chat Completions API reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

The add-on keeps the model ID you selected. An API failure does not silently select another model or remove a configured token cap. Test model can help identify access or configuration failures without sending a draft; generating an email still requires review of the resulting text.

## Using AI Mate

### Generate Replies
1. Open a message reply or compose window with the original email quoted.
2. Click the **AI Mate Reply** button (add it via toolbar customization if hidden).
3. Choose a style and **Short**, **Normal**, or **Detailed** length, and optionally type extra guidance in the prompt field. Both selections are remembered.
4. Click **Generate Reply**. The add-on inserts the reply directly into the composer, preserving manual draft text, the existing signature, and quoted content.
5. To try another version in the same compose session, open the popup again and generate another reply. An unchanged AI reply is replaced instead of duplicated. If the previous reply has been edited or cannot be identified safely, the add-on explains why it cannot replace it.

AI Mate separates draft text, quoted content, and the signature when building reply context, and includes the subject and To/Cc recipients. The reply language continues to follow the message and your instructions automatically. The interface remains in English.

Your current instruction takes priority over saved writing preferences. The style and length selectors control those choices unless the current instruction explicitly overrides them. Existing installations start with Normal length and empty writing preferences; the saved last instruction is not converted into a permanent preference.

### Improve a Draft
1. Write notes or a complete draft in the compose window.
2. Open AI Mate, choose style and length, and optionally enter instructions for this revision.
3. Click **Improve Draft**. AI Mate rewrites all of your current draft text, including earlier AI text you have edited, into plain paragraphs. The result replaces that authored text and the popup closes.

Improvement supports one continuous draft region. It preserves recognizable signatures and quoted messages, and checks that link destinations from the draft are retained before writing. An empty draft does not trigger a request. Tables, images, text interleaved with quoted messages, or ambiguous draft boundaries prevent improvement and produce an explanation. This restriction applies to the draft being rewritten, not images or tables inside a preserved signature or quote. Formatting such as bold text and lists becomes text with paragraphs.

In plain-text messages, AI Mate also uses Thunderbird's HTML representation where available to identify signatures and quotes, requiring a reliable correspondence with the plain text. A signature typed without recognizable markers is treated as part of the draft.

### Undo the Last Change
1. Reopen the AI Mate popup in the same compose window after an insertion, regeneration, or improvement.
2. Click **Undo last change**. The original affected fragment and its formatting are restored, while later edits outside the result are kept. The popup stays open to show the outcome.

Undo refuses to overwrite a result that has been edited, removed, become ambiguous, or changed format. There is one undo level per compose window, held only in memory. A successful new operation replaces it; a failed operation retains the previous undo. Successful undo consumes it. Closing the compose window or restarting the add-on clears it.

Generating, improving, and undoing share a lock per compose window. AI Mate checks the composer again immediately before writing; if it changed during the operation, the current text remains in place and the popup explains what happened. Review generated or improved text before sending the email.

### Summarize in the Composer
1. Open the AI Mate popup from the compose toolbar.
2. Click **Summarize Email** to send the current draft and quoted content to OpenAI.
3. The summary appears in the popup; use **Clear summary** to remove it.

### Summarize in the Message Reader
1. Enable **message display summaries** in the options page.
2. Select any message and click the AI Mate button in the message display toolbar.
3. Click **Summarize** in the reader popup. If you enabled automatic summaries on open, opening this popup starts the request instead.
4. The popup shows the summary once OpenAI responds. Copy it with **Copy Summary** if needed.

## Data Use and Privacy
- Reply generation and draft improvement send draft text, quoted content, signature context, subject, To/Cc recipients, selected style and length, saved writing preferences, and the current custom instruction to the OpenAI API. Draft improvement also includes link destinations from the draft. Composer summaries send the compose body; reader summaries send the selected message text and available subject, sender, and recipients.
- Reader summaries are disabled by default. Automatic requests when the reader summary popup opens require the separate automatic-summary setting.
- Your saved API key is kept in `browser.storage.local` and sent to OpenAI in the authorization header for API requests. **Test model** uses the currently entered key and model, which may be unsaved, with a fixed short diagnostic instruction. It sends no email content, last instruction, or writing preferences, does not save the entered values, and may incur a small API charge. The add-on does not use browser sync.
- Settings, selected reply style (`replyStyle`), length (`replyLength`), saved writing preferences (`writingPreferences`), and the last custom instruction (`lastPrompt`) are stored locally. Reply tracking and the original/result fragments needed for one undo exist only in memory for the open compose session. The add-on does not save an email or reply history in extension storage, apart from text you put in saved instructions or preferences. Thunderbird can still save drafts normally.
- Undo and action-availability checks do not contact OpenAI.
- Generated replies are inserted as text; summary markup is sanitized with the bundled DOMPurify library.
- See [PRIVACY.md](PRIVACY.md) for details, including the distinction between locally stored settings and data sent to OpenAI.

## Packaging for Release
- Run `./pack.ps1` in PowerShell. The script uses its own directory as the source and outputs `dist/ai-mate-<version>.xpi` there, regardless of the current working directory.
- Use `./pack.ps1 -OutDir <directory>` to choose another destination. Relative destinations are resolved from the script directory; absolute destinations are used directly.
- The XPI contains an explicit list of 25 runtime files, icons, the bundled DOMPurify library, licenses, and distribution notices, including the shared `model-config.js` module. Tests, development tools, release notes, and repository metadata are excluded. A completed archive replaces an existing package only after packaging succeeds.
- Version 1.0.21 produces `dist/ai-mate-1.0.21.xpi`; the previous 1.0.20 and 1.0.19 XPIs are retained.
- [RELEASE_NOTES.md](RELEASE_NOTES.md) contains the release description for the Thunderbird add-on listing. Packaging creates the file locally; it does not upload or publish it.

## Development checks
- Use Node.js 24 or newer for the development tools, then run `npm ci` and `npm test`.
- Tests use simulated OpenAI responses and compose APIs; no API key or network request is needed. Development dependencies are not included in the XPI.
- See [TESTING.md](TESTING.md) for the release checks and remaining manual Thunderbird verification.

## Support
- Questions or feedback: <https://github.com/EnriqueITE/AI-Mate>
- X (Twitter): <https://x.com/EnriqueITE>
- Buy Me a Coffee: <https://buymeacoffee.com/enriqueite>

## License
AI Mate is free software licensed under the GNU General Public License v3.0 or later. See [LICENSE](LICENSE) for the standard GPL terms and [NOTICE](NOTICE) for the project copyright notice.

The bundled DOMPurify 3.2.7 library retains its upstream Apache 2.0 or MPL 2.0 license. The complete upstream license is included in [lib/DOMPurify.LICENSE](lib/DOMPurify.LICENSE); [VENDOR](VENDOR) records the distribution and license sources.

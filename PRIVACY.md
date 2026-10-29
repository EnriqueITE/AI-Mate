AI Mate – Privacy Policy

Summary
- AI Mate does not collect telemetry or require an account with the add-on developer.
- AI features send relevant email content to the OpenAI API using your own API key. The add-on does not operate an intermediary server.
- Settings are stored locally in your Thunderbird profile with `browser.storage.local`; the add-on does not use browser sync.
- Reader summaries require opt-in. A separate setting can start a request automatically when you open the reader summary popup.

Data Sent to OpenAI
- Reply generation and draft improvement: your current custom instruction, saved writing preferences, selected reply style and length, draft text, quoted email content, signature context, subject, and To/Cc recipients are sent to generate or improve a reply. Improvement also includes the draft's link destinations so they can be preserved.
- Composer summaries: the current compose body, including draft text, quoted content, and any signature present, is sent to generate a summary.
- Reader summaries: the selected message body and available subject, sender, and recipient information are sent to generate a summary. Quoted conversation text already in that body may be included.
- Your API key is sent to OpenAI in the authorization header for each API request.
- Test model: the key and model currently entered in settings, including unsaved values, are used for a small diagnostic inference request. The request contains a fixed short test instruction and an output allowance, without email content, the last instruction, or writing preferences. It may incur a small API charge. Testing does not save the entered key or model. A successful response confirms access for that request, not email-writing quality. The backwards-compatible key-validation action also contacts OpenAI without sending email content.
- Requests start when you generate a reply, improve a draft, request a summary, or test a model. If you enable both message display summaries and automatic summaries on open, opening the reader summary popup also starts a request. Undo and checks for available compose actions are local and do not contact OpenAI.

Local Storage and Temporary Processing
- Saved API key, model ID (including a custom ID) and generation parameters, last custom instruction (`lastPrompt`), reply style (`replyStyle`), reply length (`replyLength`), writing preferences (`writingPreferences`), summary preferences, and summary opt-in settings are stored locally.
- The last custom instruction and writing preferences are separate saved fields. Any personal information or email text you put into either field is stored with it. Writing preferences apply to generation and improvement, not summaries. Existing saved instructions are not copied into writing preferences during upgrade.
- Reply context, tracking of the previous AI reply, and one reversible operation per compose window are held temporarily in memory. Undo retains the affected original fragment, the inserted result's identity, added separators, and previous reply-tracking state. This information is discarded when the compose window closes or the add-on restarts; successful undo consumes that window's undo record.
- The add-on does not save email bodies, generated replies, or a conversation history in persistent extension storage, apart from text you include in saved instructions or writing preferences. Generated and improved replies are inserted into Thunderbird's compose editor, where Thunderbird's normal draft-saving and sending behavior applies.

Third Parties
- OpenAI API (`api.openai.com`) is contacted for generation, summaries, model testing, and backwards-compatible key validation. Data sent there is processed under the terms and policies applicable to your OpenAI API account.

Permissions Justification
- `compose`: Read the open compose window and insert, improve, replace, or undo an AI reply.
- `messagesRead`: Read a selected message to produce a reader summary when enabled.
- `storage`: Save settings, writing preferences, and the last custom instruction locally.
- `tabs`: Locate compose and message display tabs.
- `notifications`: Provide generation status and error feedback.
- `https://api.openai.com/*`: Make authenticated requests to the OpenAI API.

Contact
- Email: hello@enriqueite.com
- You can change summary settings, clear your API key in the options page, or disable or remove the add-on from Thunderbird Add-ons Manager.

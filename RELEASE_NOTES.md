# AI Mate 1.0.23

- Fix the compose toolbar popup collapsing to a narrow strip. Let Thunderbird measure intrinsic content height, with a 400 px width and a fixed 600 px scrolling limit instead of a viewport-dependent inner container.
- Keep Open Settings in the header, including while reviewing a rewrite. Compact selection controls and collapse the optional rewrite instruction so Generate Reply remains visible.
- Restore Summarize Email availability when leaving a rewrite preview. Preserve generation, improvement, undo and writing preferences.
- Reject selections inside recognizable plain-text quotes and signatures, including partial selections that omit their delimiters.
- Add native toolbar-popup regression checks, including actual Generate Reply and Open Settings button actions in HTML and plain-text compose windows. Responses are simulated; no live model calls or publication.

## AI Mate 1.0.22

- Rewrite a selection from the compose widget using Paraphrase, Formal, Direct, Friendly, Shorter or More detailed. Review the original and result before replacing; regenerate, copy, cancel or undo without rewriting the whole draft.
- Use actual editor ranges, reject stale or unsupported selections, preserve outside text and formatting, and retain a reversible in-memory DOM journal. Restore neighbouring whitespace affected by Thunderbird's native editor cleanup.
- Send only selection text, its link destinations and the specific rewrite instruction for this action. Save only the rewrite style. Preview generation does not modify the email.
- Default new installs to GPT-6 Luna, add GPT-6.1 Terra, identify deprecated models, and remove retired GPT-3.5 Turbo from new choices while preserving saved IDs and parameters. Keep Chat Completions with explicit `store: false`.
- Update bundled DOMPurify to 3.4.17 and test-only undici to its patched release. Refuse unsanitized rendering, validate extension message senders and compose targets, and exclude attachments/raw MIME from summary extraction.
- Keep existing whole-draft generation, improvement, summaries, writing preferences and undo. Keep Thunderbird 115 as the declared minimum; native verification uses Thunderbird 159.0.

This package is local and has not been published. Validation uses simulated OpenAI responses, not real credentials or paid requests. See TESTING.md for the actual checks and limits.

## AI Mate 1.0.21

- Add `gpt-6-luna`, `gpt-6.1-sol`, and `gpt-6-astra` to the model selector while retaining the six existing choices. The default remains `gpt-4o-mini`, and upgrading preserves your selected model.
- Choose Other model to enter an exact custom model ID. Previously saved IDs outside the catalog remain available instead of being replaced.
- Replace the settings key-test button with Test model. It tests the currently entered key and model using a fixed short API request, without sending email content, your last instruction, or writing preferences. It may incur a small API charge and does not save your settings.
- Use consistent model and parameter handling for reply generation, draft improvement, and summaries. Disable incompatible sampling controls while keeping the output-token cap available, including hidden reasoning tokens for modern models.
- Keep the requested model and configured output cap on API errors; no silent model substitution or retry that drops those limits.
- Explain key, model-access, quota and compatibility failures without exposing raw API error bodies. Reject incomplete responses and recover from requests that time out.
- Preserve the existing compose workflow, language behavior, content protection, and undo. Retain Thunderbird 115 compatibility and DOMPurify 3.2.7 with its complete upstream license.

Model availability depends on your API account. A successful model test confirms that the selected model responded to that request; it does not certify writing quality. No real-account availability or live model-quality evaluation was performed for this release.

## AI Mate 1.0.20

- Choose Short, Normal, or Detailed reply length next to the style selector. Normal is the default, and your choice is remembered.
- Use Improve Draft to rewrite notes or a complete draft into clear paragraphs, including earlier AI text you have edited. The revision preserves meaning, data, and link destinations while keeping recognizable signatures and quoted messages in place.
- Save reusable Writing preferences in settings, separately from the last instruction. The current instruction takes priority, and style and length selectors control those choices unless that instruction overrides them.
- Reopen the compose popup to Undo last change. One undo level per window can restore the original affected fragment while preserving later edits outside the result. Edited or ambiguous results are kept with an explanation.
- Protect draft content by checking the composer again before writing and preventing overlapping generation, improvement, and undo operations. Unsupported or empty drafts do not trigger improvement requests; failed operations retain the previous undo record.
- Leave the draft unchanged when the API reports a response truncated by its output limit.
- Keep direct insertion, automatic popup closing after generation or improvement, and the existing automatic language behavior. Undo leaves the popup open. The interface remains in English.
- Store undo information only in memory for the compose session. Clarify which instructions, preferences, and email context are sent to OpenAI.
- Retain DOMPurify 3.2.7 and Thunderbird 115 compatibility. Include the complete upstream DOMPurify license in the runtime-only release package.

Requires Thunderbird 115 or newer and your own OpenAI API key. Improvement supports one continuous authored region; complex layouts or unclear boundaries are preserved with an explanation. Replies are inserted into the composer for review; the add-on does not send the email.

## AI Mate 1.0.19

- Choose Natural, Formal, or Friendly reply styles directly in the compose popup. Natural is the default, and your choice is remembered.
- Generate replies with clearer greetings, paragraph spacing, and closings while keeping the existing signature and quoted email intact.
- Use draft text, quoted email content, signature context, the subject, and To/Cc recipients as distinct context when drafting a reply.
- Regenerate an unchanged AI reply in the same compose session without adding duplicate copies. Edited or unrecognizable previous AI replies are preserved with an explanatory message.
- Detect changes made to the compose message while a reply is being generated and leave those changes in place. Prevent overlapping reply generations in the same compose window.
- Clarify which data is stored locally and which data is sent to OpenAI, including API key authorization and optional automatic reader summaries.
- Include DOMPurify 3.2.7 and package only runtime files and distribution notices.

Requires Thunderbird 115 or newer and your own OpenAI API key. Replies are inserted into the composer for review; the add-on does not send the email.

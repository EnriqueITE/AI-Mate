# AI Mate 1.0.21 validation

## Status

Version 1.0.21 passed 122 automated tests, browser UI checks, and 20 targeted native Thunderbird stages. OpenAI responses were simulated throughout; account availability and real-model writing quality have not been evaluated. The previous release's validation is retained separately below.

## Automated and browser checks

The final `npm test` run passed **122/122 tests**, retaining the previous 90 and adding 32 cases across model configuration, background integration and settings. Syntax checks passed for `model-config.js`, `background.js`, `options.js`, `popup.js`, `reader-popup.js`, and `reply-core.js`; `git diff --check` passed. These tests use simulated OpenAI responses without real API credentials or requests.

New coverage checks all nine catalog entries, custom and previously stored unknown model IDs, unchanged defaults, model-specific request parameters, output caps, consistent behavior across generation/improvement/summaries, and API errors without silent model substitutions or retries that remove caps. Test model uses the currently entered key/model without saving them or including draft data, last instructions, or writing preferences. Tests cover concurrent requests, failure and timeout recovery, and preservation of existing undo. Missing, truncated, refused, malformed or non-text completions are rejected. Numeric limits are preserved correctly (`1e4` becomes 10000); fractional, non-positive and unsafe integers are rejected before saving.

Headless Microsoft Edge UI checks passed with all outbound requests blocked and extension APIs simulated. They exercised catalog and custom selection, disabled sampling controls with an active token cap, custom-ID validation, unsaved test inputs, double-click blocking, success/error status and token-limit validation. Screenshots were inspected: `dist/qa-options-default-1.0.21.png`, `dist/qa-options-reasoning-1.0.21.png`, and `dist/qa-options-custom-1.0.21.png`. The model-test cost notice is visible beside the settings actions.

## Native Thunderbird checks

The 1.0.21 native run passed all **20 stages** in Thunderbird 153.3.1 (build `20260917204311`) on 2026-10-02. It used headless Thunderbird with a fresh fixture-only profile and temporary QA add-on. All OpenAI responses were simulated, with 29 intercepted Chat Completions requests; no real API key, account access, or email sending was involved. The compose API, storage, and editor were native. The report is `dist/qa121-native/report.json`.

- The previous 14 native regression stages passed again: HTML/plain-text generation, improvement and undo, preservation of links/signatures/quotes and later outside edits, rejection of edited undo results and complex drafts, and protection of forwarded HTML.
- Each of `gpt-6-luna`, `gpt-6.1-sol`, `gpt-6-astra`, and a custom model ID was used for generation, improvement, and a compose summary. All three operations kept that exact model ID, the configured 330-token cap, and omission of unsupported sampling parameters. Summarizing did not change the composer.
- Test model was exercised with `gpt-4o-mini` and `gpt-6-astra`, using unsaved fixture keys and model choices. Tests verified the fixed instruction, exactly one request, the 64-token or 2048-token diagnostic budget respectively, unchanged saved settings, exclusion of email and saved instruction/preference data, and unchanged working undo/regeneration state.

Native screenshots of HTML and plain-text composers (`dist/qa121-native/window-2.png` and `window-3.png`), popup (`window-6.png`), and settings (`window-7.png`) were inspected. Paragraph spacing, signatures, quotes, the selected new model, disabled sampling fields, and the active token limit were visible as expected. Native extension-page button clicks were not automated; the report explicitly records this limitation. Browser UI interaction tests are recorded separately. Thunderbird 115 has not been run; the declared minimum and existing permissions are unchanged.

## Official API documentation and live evaluation

The additional IDs and Chat Completions endpoint were checked against the official OpenAI model pages for [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), and [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra). The [Chat Completions reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create) describes `max_completion_tokens` as including visible output and reasoning tokens. These documentation checks do not establish availability for any particular account.

Real-account availability, paid model-test requests, and real-model email quality: **not evaluated**. The model catalog is not a quality ranking. A successful Test model response confirms a response to that diagnostic request, not adherence to every email instruction or access under every account condition.

## Release package

`dist/ai-mate-1.0.21.xpi` was built and verified: **282488 bytes**, SHA-256 `53BD11485AD55CA46C596E6E0970D2D09DC86102823C7B601CF2D07BF2555B9A`. All 25 decompressed entries match their source files exactly, with no duplicate or unexpected paths. Version 1.0.21, the production extension ID, existing permissions, Thunderbird minimum 115.0, background script order, `model-config.js`, and the complete DOMPurify license were checked. Tests, fixtures, tools and repository metadata are excluded. Previous 1.0.19 and 1.0.20 XPIs retain their original hashes recorded below. The package was created locally and has not been uploaded to the Thunderbird catalog.

## Previous release: AI Mate 1.0.20 validation

### Status

Version 1.0.20 passed the automated suite, browser UI checks, and targeted native Thunderbird checks described below. Model responses were simulated; real-model evaluation and native Thunderbird 115 testing were not performed. Release archive verification is recorded separately.

### Automated checks with simulated responses

Run `npm ci` and `npm test` with Node.js 24 or newer. Tests use simulated OpenAI responses and compose APIs; they do not use an API key or contact OpenAI.

The 1.0.19 baseline has 39 passing tests covering the popup, context and prompt preparation, HTML and plain-text insertion, and background request handling. The user has also confirmed that version works in their normal use. Baseline regressions include paragraph spacing, HTML escaping, document styles and direction, manual text, signatures and quotes, intact reply replacement, edited or ambiguous blocks, quoted AI-Mate markers, concurrent editor changes, independent windows, closed windows, and API failures.

The 1.0.20 suite retains that coverage and adds:

- Style and length defaults and persistence; permanent writing preferences separated from `lastPrompt`; instruction precedence; backwards-compatible generation messages.
- Improvement of notes, complete drafts, and manually edited AI text in HTML and plain text; signature and quote boundaries; preservation of link destinations; rejection of empty, ambiguous, interleaved, or complex authored content.
- Undo of insertion, regeneration, and improvement; restoration of original formatting and separators; later edits inside and outside the result; missing/ambiguous results; failed writes; per-window state; shared locking and snapshot checks.

The final 1.0.20 integration run passed all **90 tests**. JavaScript syntax checks for the four changed runtime scripts and `git diff --check` also passed. Final regression coverage includes forwarded-message protection, refusing plain-text regeneration inside a signature or quote, preservation of `www` and FTP links, and refusing API responses reported as truncated.

### Browser rendering and interaction checks

The 1.0.20 popup and settings checks passed in headless Microsoft Edge with outbound requests blocked and extension APIs simulated. Checks cover the style and length controls, Improve Draft, Undo last change, saved Writing preferences, disabled-action explanations, and status messages. Screenshots are available locally as `dist/qa-popup-1.0.20.png`, `dist/qa-popup-undo-1.0.20.png`, and `dist/qa-options-1.0.20.png`.

The 1.0.19 popup and sample HTML body were rendered and inspected in a browser. Browser checks exercise the extension UI with simulated APIs and do not establish native Thunderbird behavior or live model quality.

### Native Thunderbird checks

The final 1.0.20 native run passed all **14 stages** in Thunderbird 153.3.1 (build `20260917204311`) on 2026-10-02, following earlier successful runs. It used headless Thunderbird, a new isolated test profile, a temporary QA extension, and simulated OpenAI responses. The compose API and editor were real; model responses were not. No email was sent. The local report is `dist/qa120-native/report.json`.

Completed native checks, in both HTML and plain-text compose windows:

- Initial generation and undo; regeneration and undo.
- Improvement of manually edited AI text while preserving the link destination, signature, and quote.
- Undo after adding text outside the result, preserving the later text.
- Disabling undo after editing inside the result.
- Final composed sample and popup action state.

Additional native checks confirmed that complex HTML draft content is rejected before a model request, and forwarded HTML remains protected during improvement and undo. Final native screenshots of the HTML composer (`dist/qa120-native/window-2.png`), plain-text composer (`window-3.png`), and dark popup (`window-6.png`) were inspected. Typography, spacing, signatures, and quotes were retained.

Clicking the popup's Undo button through native automation was not completed: Marionette could not access the extension page's content handles. The native report records `nativePopupInteraction: not-run`. Native generation, improvement, and undo were exercised through the extension and real compose API; popup button interaction was checked separately in Edge with simulated extension APIs. Native popup rendering and action availability were inspected, but these do not establish a native button-click result.

The native checks are targeted cases, not every combination of language, style, length, and signature. Concurrent editing, failures, duplicate clicks, and independent windows have automated simulated-API coverage. Thunderbird 115 has not been run. The extension retains its declared minimum of 115 and uses the existing compose/storage/tabs APIs.

The [official compose API documentation](https://webextension-api.thunderbird.net/en/mv2/compose.html) places `getComposeDetails` and `setComposeDetails` in Thunderbird 74, `plainTextBody` and `isPlainText` in 75, `type` in 88, and `relatedMessageId` in 95. These APIs predate the declared minimum. The new action messages are internal to AI Mate and require no additional Thunderbird API or permission. This documentation check is not a native Thunderbird 115 test.

Thunderbird's compose API does not offer an atomic compare-and-set operation. AI Mate compares the latest compose snapshot immediately before writing; a small read/write interval remains.

### Real-model evaluation

1.0.20 real-model evaluation: **not performed**. No real API credentials are required for the automated or simulated-response browser checks.

Before publication, assess Spanish and English generation and improvement with all three styles and lengths, with and without signatures. Compare the result with the original facts and link destinations. Check that current instructions override permanent preferences and selector defaults, and that the response does not invent details. Response quality and instruction adherence require this separate evaluation.

### Release package checks

`dist/ai-mate-1.0.20.xpi` was generated and verified. Its manifest reports version `1.0.20`, the production add-on ID, unchanged permissions, and minimum Thunderbird version `115.0`. The archive passes the ZIP integrity check and contains exactly the 24 allowlisted runtime/distribution files. Every extracted entry matches the corresponding source bytes. Tests, development dependencies, QA tooling, and repository metadata are absent.

- Size: `278320` bytes.
- SHA-256: `353FF50B75291B5363DCD1D7AA43F3D9310F2195CA97034B3F50A2ED89161688`.

The allowlist includes `lib/DOMPurify.LICENSE`, downloaded unchanged from the [official DOMPurify 3.2.7 tag](https://raw.githubusercontent.com/cure53/DOMPurify/3.2.7/LICENSE). Its SHA-256 is `1B02E03C3FB4F87D476C128F0EB9DEF1F5A1709D28B180465228BD41574623B7`. The DOMPurify 3.2.7 JavaScript and its source notice are retained.

The previous `dist/ai-mate-1.0.19.xpi` was verified unchanged. Its SHA-256 is `992A0BD81222BD94DC92AF7EABB62B6E656270992EAC38E21A6CB77BA507C3A4`.

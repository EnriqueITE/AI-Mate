# AI Mate 1.0.23 security maintenance

Review scope: the GitHub 1.0.21 base, selection feature boundaries, model request construction, HTML rendering, summary input extraction and locked development dependencies. This is targeted maintenance, not a claim that the extension is vulnerability-free.

| Finding | Severity / applicability | Resolution |
| --- | --- | --- |
| S1: undici 7.30.0 advisories | npm reports high severity; development/test dependency only, absent from XPI | Updated lockfile to 7.30.2; final npm audit reports zero advisories. |
| S2: sanitizer failure returns unsanitized output | Defence-in-depth weakness in `background.js` and `reader-popup.js`; exploitability depends on downstream formatting | Rendering now fails closed, including the compose summary. Bundled DOMPurify updated to official 3.4.17 with its license and provenance. |
| S3: summary extraction traverses attachments / falls back to raw MIME | Privacy risk: text attachment contents could be included in a requested summary | Reject named/disposition attachments and attached messages, prefer plain alternatives, remove raw MIME and getBody fallbacks. |
| S4: extension requests did not validate sender/page and target type | Defence-in-depth gap, not evidence that arbitrary websites could reach the listener | Restrict requests to exact extension pages and validate compose tab IDs/types; restrict model tests to Settings. |
| S5: selection replacement and asynchronous output could target changed content | New feature integrity boundary | Bind previews to an editor range/token and snapshot; validate again before apply; per-window locks; cancel on popup disconnect/window close; store applied text in background memory rather than trusting a client-supplied replacement. |
| S6: plain-text quotes/signatures lacked protective DOM elements | Selection eligibility gap found during pre-publication review | Map line boundaries to DOM positions; reject partial selections within quoted lines, recognizable quote introductions and signature suffixes. Automated and native tests verify rejection without a request and preserve authored selections outside them. |

Generated replacements are inserted as plain text via the native editor transaction. Selection prompts send only selected text, its destinations and the requested rewrite instruction. Preview output is rendered with textContent. Original DOM nodes used by Undo come from the editor, never model HTML. All Chat Completions requests set store:false; this is not a Zero Data Retention claim.

Residual limits: saved keys retain the existing local-profile storage behavior; compatibility with Thunderbird 115 is API-based rather than a native test result. Provider/account security and live model behavior were not tested. Built-in native Undo and the extension's conservative one-level Undo can invalidate one another's records; stale records are refused rather than applied.

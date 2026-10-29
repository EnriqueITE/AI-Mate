const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
global.DOMParser = new JSDOM("").window.DOMParser;
const core = require("../reply-core.js");
const html = (body = "", more = {}) => ({ isPlainText: false, body, ...more });
const plain = (plainTextBody = "", more = {}) => ({ isPlainText: true, plainTextBody, ...more });
const parse = (body) => new DOMParser().parseFromString(body, "text/html");
const canonicalHtml = (body) => parse(body).documentElement.innerHTML;
const apply = (details, update) => ({ ...details, ...update });
const rewritten = "Hello,\n\nPlease review the proposal.\n\nThank you,";

test("length defaults, writing preferences, and improve instructions are separate from email context", () => {
  assert.equal(core.normalizeLength("invalid"), "normal");
  assert.equal(core.normalizeLength("toString"), "normal");
  for (const length of ["short", "normal", "detailed"]) {
    assert.equal(core.normalizeLength(length), length);
    const messages = core.buildMessages(core.buildImproveContext(plain("A draft")), "Use a friendly greeting", "formal", length, "Avoid exclamation marks", "improve");
    assert.match(messages[0].content, /Rewrite the entire current draft/);
    assert.match(messages[0].content, /current draft's language/);
    assert.match(messages[0].content, /meaning, facts, names, figures, and commitments/);
    assert.match(messages[0].content, /current user instruction or selected style and length/);
    assert.ok(!messages[0].content.includes("Write a coherent continuation"));
    assert.match(messages[1].content, /Permanent writing preferences:\nAvoid exclamation marks/);
    assert.match(messages[1].content, /User instruction:\nUse a friendly greeting/);
  }
});

test("improve consumes the complete edited draft and replaces legacy or edited AI markers", () => {
  const original = html('<p>Manual introduction</p><span data-ai-reply="legacy">An edited earlier AI response.</span><p>Manual conclusion</p><div class="moz-signature">Ada</div><blockquote type="cite">Original message</blockquote>');
  const context = core.buildImproveContext(original);
  assert.equal(context.draft, "Manual introduction\n\nAn edited earlier AI response.\n\nManual conclusion");
  assert.equal(context.previousReply, "");
  assert.equal(context.signature, "Ada");
  assert.equal(context.quoted, "Original message");
  const result = core.prepareImprovement(original, rewritten, "improved");
  const doc = parse(result.update.body);
  assert.equal(doc.querySelectorAll("[data-ai-reply]").length, 1);
  assert.equal(doc.querySelector(".moz-signature").outerHTML, '<div class="moz-signature">Ada</div>');
  assert.equal(doc.querySelector("blockquote").textContent, "Original message");
  assert.ok(!doc.body.textContent.includes("Manual introduction"));
  assert.equal(canonicalHtml(core.prepareUndo(apply(original, result.update), result.undo).body), canonicalHtml(original.body));
});

test("nested signatures, quoted old AI markers, editor styles, and exact draft formatting survive improve plus undo", () => {
  const original = html('<head><style>p { color: navy; }</style></head><body dir="rtl" style="font-family: Georgia"><section><b>Original</b><br>With emphasis <span><span class="moz-signature"><img src="cid:sig">Signature</span><blockquote><span data-ai-reply="old">Quoted</span></blockquote></span></section></body>');
  const result = core.prepareImprovement(original, rewritten, "new");
  const doc = parse(result.update.body);
  assert.equal(doc.body.getAttribute("dir"), "rtl");
  assert.equal(doc.body.style.fontFamily, "Georgia");
  assert.equal(doc.querySelector("style").textContent, "p { color: navy; }");
  assert.equal(doc.querySelector(".moz-signature img").getAttribute("src"), "cid:sig");
  const restored = core.prepareUndo(apply(original, result.update), result.undo);
  assert.equal(canonicalHtml(restored.body), canonicalHtml(original.body));
});

test("empty drafts, inline replies, mixed ancestor ranges, and non-text draft objects fail safely", () => {
  for (const body of ["", '<div class="moz-signature">Only signature</div>', '<blockquote>Only quoted text</blockquote>', '<p>Above</p><blockquote>Quote</blockquote><p>Inline reply</p>', '<p>First parent</p><section>Second parent<span class="moz-signature">Signature</span></section>', '<p>Look here <img src="cid:photo"></p>', '<p>Data</p><table><tr><td>123</td></tr></table>']) {
    assert.throws(() => core.buildImproveContext(html(body)));
    assert.throws(() => core.prepareImprovement(html(body), rewritten, "new"));
  }
  assert.throws(() => core.buildImproveContext(plain("Draft\n\n> Quote\n\nInline reply")), /separated safely/);
});

test("HTML source disambiguates an unmarked plain-text signature without touching its bytes", () => {
  const original = plain("Need your feedback\r\n\r\nKind regards,\r\nAda\r\n", {
    body: '<body>Need your feedback<br><br><span class="moz-signature">Kind regards,<br>Ada</span><br></body>'
  });
  const context = core.buildImproveContext(original);
  assert.equal(context.draft, "Need your feedback");
  assert.equal(context.signature, "Kind regards,\nAda");
  const result = core.prepareImprovement(original, rewritten);
  assert.equal(result.update.plainTextBody, rewritten.replace(/\n/g, "\r\n") + "\r\n\r\nKind regards,\r\nAda\r\n");
  const current = { ...apply(original, result.update), body: original.body.replace("Need your feedback", rewritten.replace(/\n/g, "<br>")) };
  assert.equal(core.prepareUndo(current, result.undo).plainTextBody, original.plainTextBody);
});

test("plain mapping rejects missing, duplicated, or inexact protected boundaries", () => {
  const body = '<p>Draft</p><span class="moz-signature">Signature<br>Ada</span>';
  for (const content of ["Draft\n\nUnknown signature", "Draft\n\nSignature\nAda\n\nSignature\nAda", "Draft\n\nSignature\n Ada"]) {
    assert.throws(() => core.buildImproveContext(plain(content, { body })), /separated safely/);
  }
  const shortSignature = '<p>Notes</p><span class="moz-signature">Bob</span>';
  assert.throws(() => core.buildImproveContext(plain("Notes\nBob\nmanual after", { body: shortSignature })), /separated safely/);
  assert.throws(() => core.buildImproveContext(plain("Different notes\nBob", { body: shortSignature })), /separated safely/);
  assert.throws(() => core.buildImproveContext(plain("Notes\n> Quoted\nInline answer", { body: "Notes<br>&gt; Quoted<br>Inline answer" })), /separated safely/);
});

test("plain quoted HTML without a cite prefix maps only when the entire authored prefix agrees", () => {
  const original = plain("Draft\n\n> First quoted line\n> Second quoted line", { body: '<p>Draft</p><blockquote>First quoted line<br>Second quoted line</blockquote>' });
  assert.equal(core.buildImproveContext(original).draft, "Draft");
  const result = core.prepareImprovement(original, rewritten);
  assert.ok(result.update.plainTextBody.endsWith("> First quoted line\n> Second quoted line"));
  assert.throws(() => core.buildImproveContext({ ...original, plainTextBody: "Different draft\n\n> First quoted line\n> Second quoted line" }), /separated safely/);
});

test("plain drafting supports standard delimiters, no signature, and literal whitespace/EOL restoration", () => {
  for (const body of ["A draft", "A draft  \n\n-- \nSignature\n\n> Quote", " A draft \r\n\r\n-- \r\nSignature\r\n", "Manual\n\nEdited previous AI answer\n\n> Quote"]) {
    const original = plain(body);
    const result = core.prepareImprovement(original, rewritten);
    assert.equal(core.prepareUndo(apply(original, result.update), result.undo).plainTextBody, body);
    assert.ok(core.buildContext(apply(original, result.update), result.state).previousReply);
  }
});

test("native plain editor HTML without semantic markers keeps plain signature and quote context separate", () => {
  const original = plain("Draft https://example.test/draft\n\n-- \nSignature https://example.test/signature\n\n> Quoted https://example.test/quoted", {
    body: '<body style="white-space: pre-wrap">Draft https://example.test/draft<br><br>-- <br>Signature https://example.test/signature<br><br><span style="display: block">&gt; Quoted https://example.test/quoted</span><br></body>'
  });
  const context = core.buildImproveContext(original);
  assert.equal(context.draft, "Draft https://example.test/draft");
  assert.equal(context.signature, "--\nSignature https://example.test/signature");
  assert.equal(context.quoted, "> Quoted https://example.test/quoted");
  assert.deepEqual(context.links, ["https://example.test/draft"]);
  const result = core.prepareImprovement(original, "Improved https://example.test/draft");
  assert.ok(result.update.plainTextBody.endsWith("-- \nSignature https://example.test/signature\n\n> Quoted https://example.test/quoted"));
});

test("unidentified plain signatures are treated as part of the draft without guessing", () => {
  assert.equal(core.buildImproveContext(plain("Draft\nRegards, Ada")).draft, "Draft\nRegards, Ada");
});

test("hidden HTML link destinations are sent explicitly and must survive improvement literally", () => {
  const original = html('<p>Please read <a href="https://example.test/proposal?a=1&amp;b=2">the proposal</a>.</p>');
  const context = core.buildImproveContext(original);
  assert.deepEqual(context.links, ["https://example.test/proposal?a=1&b=2"]);
  const content = "Please review the proposal: https://example.test/proposal?a=1&b=2";
  const result = core.prepareImprovement(original, content, "one");
  assert.equal(core.htmlToText(result.update.body), content);
  for (const changed of ["Please review the proposal.", "See https://example.test/proposal?a=1&b=200", "See https://example.test/proposal?a=1&b=2/changed", "See https://example.test/proposal?a=1&b=2?evil=1"]) {
    assert.throws(() => core.prepareImprovement(original, changed, "one"), /link destination/);
  }
});

test("visible plain URLs and email links are preserved without swallowing surrounding punctuation", () => {
  const original = plain("See https://example.test/a_(b). Contact mailto:ada@example.test.");
  const context = core.buildImproveContext(original);
  assert.deepEqual(context.links, ["https://example.test/a_(b)", "mailto:ada@example.test"]);
  assert.ok(core.prepareImprovement(original, "Details: https://example.test/a_(b).\n\nContact: mailto:ada@example.test."));
  assert.throws(() => core.prepareImprovement(original, "Details: https://example.test/a_(b)-different.\n\nContact: mailto:ada@example.test."), /link destination/);
});

test("undo initial plain insert removes exactly the separators added by AI-Mate", () => {
  for (const body of ["", "Manual", "Manual\n", "Manual\n\n", "Manual\n-- \nSignature", "-- \nSignature", "Manual\r\n\r\n> Quote\r\n"]) {
    const original = plain(body);
    const result = core.prepareInsertion(original, rewritten);
    const restored = core.prepareUndo(apply(original, result.update), JSON.parse(JSON.stringify(result.undo)));
    assert.equal(restored.plainTextBody, body);
  }
});

test("undo HTML insertion and regeneration restore the previous block, including its old marker", () => {
  const original = html('<p>Manual</p><div class="moz-signature">Signature</div>');
  const first = core.prepareInsertion(original, rewritten, null, "first");
  assert.equal(canonicalHtml(core.prepareUndo(apply(original, first.update), first.undo).body), canonicalHtml(original.body));
  const second = core.prepareInsertion(apply(original, first.update), "Replacement", first.state, "second");
  const restored = core.prepareUndo(apply(original, second.update), second.undo);
  assert.equal(canonicalHtml(restored.body), canonicalHtml(first.update.body));
  assert.equal(core.buildContext(apply(original, restored), first.state).previousReply, rewritten);
});

test("undo preserves later edits outside the generated block, including signatures and metadata", () => {
  const original = html('<p>Original draft</p><div class="moz-signature">Signature</div><blockquote>Quoted</blockquote>');
  const result = core.prepareImprovement(original, rewritten, "one");
  const current = result.update.body.replace("Signature", "Updated signature").replace("Quoted", "Updated quote").replace("</body>", "<p>Later manual addition</p></body>");
  const restored = core.prepareUndo(html(current, { subject: "New subject" }), result.undo);
  const doc = parse(restored.body);
  assert.equal(doc.querySelector("p").textContent, "Original draft");
  assert.equal(doc.querySelector(".moz-signature").textContent, "Updated signature");
  assert.equal(doc.querySelector("blockquote").textContent, "Updated quote");
  assert.equal(doc.body.lastElementChild.textContent, "Later manual addition");
  assert.deepEqual(Object.keys(restored), ["body"]);
  const plainOriginal = plain("Original draft\n\n-- \nSignature");
  const plainResult = core.prepareImprovement(plainOriginal, rewritten);
  const plainCurrent = "Later manual paragraph\n\n" + plainResult.update.plainTextBody.replace("Signature", "Updated signature");
  assert.equal(core.prepareUndo(plain(plainCurrent), plainResult.undo).plainTextBody, "Later manual paragraph\n\nOriginal draft\n\n-- \nUpdated signature");
});

test("undo rejects edited, deleted, duplicated, reformatted, or unidentifiable results", () => {
  const first = core.prepareImprovement(html("<p>Original draft</p>"), rewritten, "one");
  for (const current of [first.update.body.replace("review", "edit"), first.update.body.replace("display: block", "display: inline"), first.update.body.replace('data-ai-reply="one"', 'data-ai-reply="other"'), first.update.body.replace(rewritten.split("\n")[0], ""), "<p>Deleted</p>"]) {
    assert.throws(() => core.prepareUndo(html(current), first.undo), /Nothing has been undone/);
  }
  const doc = parse(first.update.body);
  doc.body.appendChild(doc.querySelector("[data-ai-reply]").cloneNode(true));
  assert.throws(() => core.prepareUndo(html(doc.documentElement.innerHTML), first.undo), /Nothing has been undone/);
  assert.throws(() => core.prepareUndo(plain(rewritten), first.undo), /Nothing has been undone/);
  const simple = core.prepareImprovement(plain("Original draft"), rewritten);
  for (const body of [rewritten.replace("review", "edit"), "Deleted", rewritten + "\n\n" + rewritten, "Prefix " + rewritten, rewritten + "Append"]) {
    assert.throws(() => core.prepareUndo(plain(body), simple.undo), /Nothing has been undone/);
  }
  assert.throws(() => core.prepareUndo(plain("Manual\n\n-- \nSignature\n\n" + rewritten), simple.undo), /Nothing has been undone/);
  assert.throws(() => core.prepareUndo(plain("Manual\n\n> Quote\n\n" + rewritten), simple.undo), /Nothing has been undone/);
  assert.throws(() => core.prepareUndo(plain(), null), /no AI-Mate change/);
});

test("snapshots include plain editor HTML boundaries as well as visible plain text", () => {
  const original = plain("Same text", { body: '<span class="moz-signature">Same text</span>' });
  assert.notEqual(core.snapshot(original), core.snapshot({ ...original, body: "<p>Same text</p>" }));
});

test("forwarded message containers are quoted context and remain untouched through improve and undo", () => {
  const forwarded = '<div class="moz-forward-container"><p>Forwarded message</p><p>Original author content</p><span data-ai-reply="sent">Earlier sent reply</span></div>';
  const original = html(`<p>My forward introduction</p>${forwarded}`);
  const context = core.buildImproveContext(original);
  assert.equal(context.draft, "My forward introduction");
  assert.match(context.quoted, /Original author content/);
  assert.equal(core.buildContext(original).draft, "My forward introduction");
  const result = core.prepareImprovement(original, rewritten, "forward");
  assert.equal(parse(result.update.body).querySelector(".moz-forward-container").outerHTML, forwarded);
  assert.equal(canonicalHtml(core.prepareUndo(apply(original, result.update), result.undo).body), canonicalHtml(original.body));
  assert.throws(() => core.buildImproveContext(html(forwarded)), /Write a draft/);
});

test("plain forwarded HTML maps the protected suffix literally or refuses improvement", () => {
  const source = '<p>My introduction</p><div class="moz-forward-container">Forwarded message<br>Original author content</div>';
  const original = plain("My introduction\n\nForwarded message\nOriginal author content", { body: source });
  const context = core.buildImproveContext(original);
  assert.equal(context.draft, "My introduction");
  assert.match(context.quoted, /Original author content/);
  const result = core.prepareImprovement(original, rewritten);
  assert.ok(result.update.plainTextBody.endsWith("Forwarded message\nOriginal author content"));
  assert.throws(() => core.buildImproveContext(plain("My introduction\n\nForwarded message\nChanged unmatched content", { body: source })), /separated safely/);
});

test("plain regeneration refuses a result moved into signatures, quotes, or a marked forwarded body", () => {
  const first = core.prepareInsertion(plain(), rewritten);
  const protectedBodies = [
    plain("-- \nSignature\n\n" + rewritten),
    plain("> Quoted message\n\n" + rewritten),
    plain("Manual\n\nSignature\n\n" + rewritten, { body: '<p>Manual</p><div class="moz-signature">Signature<br><br>' + rewritten.replace(/\n/g, "<br>") + "</div>" }),
    plain("Manual\n\nForwarded\n\n" + rewritten, { body: '<p>Manual</p><div class="moz-forward-container">Forwarded<br><br>' + rewritten.replace(/\n/g, "<br>") + "</div>" })
  ];
  for (const current of protectedBodies) {
    assert.throws(() => core.buildContext(current, first.state), /cannot be identified safely/);
    assert.throws(() => core.prepareInsertion(current, "Replacement", first.state), /cannot be identified safely/);
    assert.throws(() => core.prepareUndo(current, first.undo), /Nothing has been undone/);
  }
});

test("plain regeneration permits a literal, fully mapped HTML signature after the intact reply", () => {
  const first = core.prepareInsertion(plain(), rewritten);
  const current = plain(rewritten + "\n\nSignature\nAda", { body: '<span>' + rewritten.replace(/\n/g, "<br>") + '</span><br><br><span class="moz-signature">Signature<br>Ada</span>' });
  assert.ok(core.buildContext(current, first.state));
  const next = core.prepareInsertion(current, "Replacement", first.state);
  assert.equal(next.update.plainTextBody, "Replacement\n\nSignature\nAda");
  const ambiguous = { ...current, body: current.body.replace("Signature<br>Ada", "Signature<br>Different name") };
  assert.throws(() => core.prepareInsertion(ambiguous, "Replacement", first.state), /cannot be identified safely/);
});

test("plain URL preservation covers www addresses and non-HTTP URI schemes", () => {
  const original = plain("Visit www.example.test/info and download ftp://files.example.test/archive.zip.");
  assert.deepEqual(core.buildImproveContext(original).links, ["www.example.test/info", "ftp://files.example.test/archive.zip"]);
  assert.ok(core.prepareImprovement(original, "Details: www.example.test/info.\n\nDownload: ftp://files.example.test/archive.zip."));
  for (const text of ["The details and download are available.", "See www.example.test/info and download ftp://files.example.test/archive.zip-extra", "See www.example.test/info?other=1 and download ftp://files.example.test/archive.zip"]) {
    assert.throws(() => core.prepareImprovement(original, text), /link destination/);
  }
});

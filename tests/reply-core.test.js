const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
global.DOMParser = new JSDOM("").window.DOMParser;
const core = require("../reply-core.js");

const plain = (body = "", extra = {}) => ({ isPlainText: true, plainTextBody: body, ...extra });
const html = (body = "", extra = {}) => ({ isPlainText: false, body, ...extra });
const parse = (body) => new DOMParser().parseFromString(body, "text/html");
const reply = "Hola,\n\nGracias por la información.\n\nUn saludo,";

test("style defaults and explicit user preferences are represented in the prompt", () => {
  assert.equal(core.normalizeStyle("unknown"), "natural");
  assert.equal(core.normalizeStyle("toString"), "natural");
  for (const style of ["natural", "formal", "friendly"]) {
    assert.equal(core.normalizeStyle(style), style);
    const messages = core.buildMessages(core.buildContext(plain()), "Write in English, no greeting.", style);
    assert.match(messages[0].content, /Explicit user instructions.*take precedence/);
    assert.match(messages[0].content, /blank line/);
    assert.match(messages[0].content, /Never invent/);
    assert.match(messages[1].content, /Write in English, no greeting/);
  }
});

test("HTML context keeps paragraphs and separates the draft, quote, and signature", () => {
  const context = core.buildContext(html('<div>Mi borrador<br>Continúa</div><p>Otro párrafo</p><div class="moz-signature">-- <br>Ana</div><div class="moz-cite-prefix">El martes escribió:</div><blockquote type="cite"><p>Hello!</p><p>Are you available?</p><div class="moz-signature">Quoted signature</div></blockquote>', { subject: "Meeting", to: ["Ada <ada@example.test>"], cc: ["Team <team@example.test>"] }));
  assert.equal(context.draft, "Mi borrador\nContinúa\n\nOtro párrafo");
  assert.equal(context.signature, "--\nAna");
  assert.equal(context.quoted, "El martes escribió:\n\nHello!\n\nAre you available?\n\nQuoted signature");
  assert.equal(context.subject, "Meeting");
  assert.equal(context.to, "Ada <ada@example.test>");
  assert.equal(context.cc, "Team <team@example.test>");
});

test("plain text recognizes standard signatures and Spanish/English quote introductions", () => {
  for (const prefix of ["On Tuesday Ada wrote:", "El martes Ada escribió:"]) {
    const context = core.buildContext(plain(`Manual\n\n-- \nMy name\n\n${prefix}\n> First paragraph\n>\n> Second paragraph`));
    assert.equal(context.draft, "Manual");
    assert.equal(context.signature, "--\nMy name");
    assert.match(context.quoted, /^On Tuesday|^El martes/);
    assert.match(context.quoted, /First paragraph\n>\n> Second paragraph/);
  }
});

test("unidentifiable plain signatures stay in the draft without guessed deletion", () => {
  const context = core.buildContext(plain("Manually written text\nRegards, Ada"));
  assert.equal(context.draft, "Manually written text\nRegards, Ada");
  assert.equal(context.signature, "");
});

test("htmlToText retains paragraph and line boundaries and ignores executable content", () => {
  assert.equal(core.htmlToText("<p>One<br>Two</p><p>Three &amp; four</p><script>bad()</script><style>x{}</style>"), "One\nTwo\n\nThree & four");
});

test("new plain emails and replies get blank paragraphs without changing existing text", () => {
  assert.equal(core.prepareInsertion(plain(), reply).update.plainTextBody, reply);
  for (const existing of ["Manual text", "Manual text\n", "Manual text\n\n"]) {
    const inserted = core.prepareInsertion(plain(existing), reply).update.plainTextBody;
    assert.ok(inserted.startsWith(existing));
    assert.equal(inserted, `Manual text\n\n${reply}`);
  }
  const existing = "Manual\n\n-- \nSignature\n\n> Quoted content\n";
  assert.equal(core.prepareInsertion(plain(existing), reply).update.plainTextBody, `Manual\n\n${reply}\n\n-- \nSignature\n\n> Quoted content\n`);
});

test("plain insertion preserves CRLF and all original trailing whitespace", () => {
  const existing = "Manual  \r\n\r\n-- \r\nSignature \r\n";
  const result = core.prepareInsertion(plain(existing), reply);
  assert.equal(result.update.plainTextBody, "Manual  \r\n\r\n" + reply.replace(/\n/g, "\r\n") + "\r\n\r\n-- \r\nSignature \r\n");
  assert.ok(!/(?<!\r)\n/.test(result.update.plainTextBody));
});

test("plain regeneration replaces only a unique intact paragraph segment", () => {
  const first = core.prepareInsertion(plain("Manual\n\n-- \nAda\n> Original"), reply);
  const editedOutside = "New manual paragraph\n\n" + first.update.plainTextBody;
  const second = core.prepareInsertion(plain(editedOutside), "Hello,\n\nThank you.\n\nBest,", first.state);
  assert.equal(second.update.plainTextBody, "New manual paragraph\n\nManual\n\nHello,\n\nThank you.\n\nBest,\n\n-- \nAda\n> Original");
  const context = core.buildContext(plain(editedOutside), first.state);
  assert.equal(context.previousReply, reply);
  assert.equal(context.draft, "New manual paragraph\n\nManual");
});

test("plain edited, duplicated, missing, or joined blocks refuse replacement", () => {
  const first = core.prepareInsertion(plain(), reply);
  const unsafe = [reply.replace("Gracias", "Muchísimas gracias"), `${reply}\n\n${reply}`, "", `Prefix ${reply}`, `${reply}Edited`];
  for (const body of unsafe) assert.throws(() => core.prepareInsertion(plain(body), "New", first.state), /cannot be identified safely/);
});

test("HTML output escapes model markup and inherits typography", () => {
  const content = "Hola,\n\n<script>alert(1)</script> & <b>literal</b>\n\nUn saludo,";
  const result = core.prepareInsertion(html(), content, null, "one");
  const doc = parse(result.update.body);
  const block = doc.querySelector("[data-ai-reply]");
  assert.equal(block.tagName, "SPAN");
  assert.equal(block.style.fontFamily, "");
  assert.equal(block.style.fontSize, "");
  assert.equal(block.style.color, "");
  assert.equal(block.querySelectorAll("script,b").length, 0);
  assert.equal(block.querySelectorAll("br").length, 4);
  assert.equal(core.htmlToText(result.update.body), content);
  assert.ok(core.prepareInsertion(html(result.update.body), reply, result.state, "two"));
});

test("HTML inserts after manual text, before signature/quote, including nested boundaries", () => {
  for (const boundary of ['<span class="moz-signature">Signature</span>', '<span class="moz-cite-prefix">On Tuesday:</span>', '<blockquote type="cite">Quoted</blockquote>']) {
    const original = `<div><p>Manual draft</p><section>${boundary}</section></div>`;
    const result = core.prepareInsertion(html(original), reply, null, "one");
    const doc = parse(result.update.body);
    assert.equal(doc.querySelector("p").textContent, "Manual draft");
    assert.equal(doc.querySelector("section").firstElementChild.getAttribute("data-ai-reply"), "one");
    assert.equal(doc.querySelector("section").lastElementChild.outerHTML, parse(boundary).body.firstElementChild.outerHTML);
  }
  const original = '<p>Manual<br><span><span class="moz-signature">Signature</span></span></p>';
  const result = core.prepareInsertion(html(original), reply, null, "nested");
  assert.equal(parse(result.update.body).querySelectorAll("p").length, 1);
  assert.ok(core.prepareInsertion(html(result.update.body), "Updated", result.state, "next"));
});

test("HTML keeps headless manual formatting, empty nodes, separators, and signature intact", () => {
  const original = '<div><b>Manual</b></div><hr><br><p>&nbsp;</p><div class="moz-signature"><img src="cid:signature"><br>Ada</div><blockquote>Original</blockquote>';
  const first = core.prepareInsertion(html(original), reply, null, "one");
  const doc = parse(first.update.body);
  doc.querySelector("[data-ai-reply]").remove();
  assert.equal(doc.body.innerHTML, original);
  const noBoundary = core.prepareInsertion(html("<p>Manual</p>"), reply, null, "two");
  assert.equal(parse(noBoundary.update.body).body.firstElementChild.tagName, "P");
});

test("HTML regeneration permits manual changes outside the block and keeps quotes/signatures", () => {
  const first = core.prepareInsertion(html('<p>Manual</p><div class="moz-signature">Ada</div><blockquote>Original</blockquote>'), reply, null, "one");
  const current = first.update.body.replace("Manual", "Manual edited");
  const second = core.prepareInsertion(html(current), "Hello,\n\nThank you.\n\nBest,", first.state, "two");
  const doc = parse(second.update.body);
  assert.equal(doc.querySelectorAll("[data-ai-reply]").length, 1);
  assert.equal(doc.querySelector("p").textContent, "Manual edited");
  assert.equal(doc.querySelector(".moz-signature").textContent, "Ada");
  assert.equal(doc.querySelector("blockquote").textContent, "Original");
  const context = core.buildContext(html(current), first.state);
  assert.equal(context.draft, "Manual edited");
  assert.equal(context.previousReply, reply);
});

test("HTML edited text, formatting, marker, duplicate, and unknown legacy blocks are protected", () => {
  const first = core.prepareInsertion(html(), reply, null, "one");
  for (const body of [first.update.body.replace("Gracias", "Muchas gracias"), first.update.body.replace("display: block", "display: inline"), first.update.body.replace('data-ai-reply="one"', 'data-ai-reply="two"'), first.update.body + first.update.body, "<p>Deleted</p>"]) {
    assert.throws(() => core.prepareInsertion(html(body), "New", first.state, "next"), /cannot be identified safely/);
  }
  assert.throws(() => core.buildContext(html('<div data-ai-reply="true">Old version</div>')), /cannot be identified safely/);
});

test("HTML fingerprint allows attribute and CSS order serialization changes", () => {
  const first = core.prepareInsertion(html(), reply, null, "one");
  const reordered = first.update.body.replace('data-ai-reply="one" style="display: block; margin: 0px 0px 1em; padding: 0px;"', 'style="padding: 0px; margin: 0px 0px 1em; display: block;" data-ai-reply="one"');
  assert.ok(core.prepareInsertion(html(reordered), "Updated", first.state, "next"));
});

test("switching compose format after an insertion is never treated as a fresh generation", () => {
  const first = core.prepareInsertion(plain(), reply);
  assert.throws(() => core.prepareInsertion(html("<p>Hello</p>"), reply, first.state, "next"), /cannot be identified safely/);
});

test("compose snapshots detect body, format, identity, subject, and recipient changes", () => {
  const details = plain("Manual", { subject: "Hi", to: ["one@example.test"], cc: [], bcc: [], identityId: "id1" });
  for (const change of [{ plainTextBody: "Changed" }, { isPlainText: false }, { identityId: "id2" }, { subject: "Changed" }, { to: ["two@example.test"] }, { cc: ["cc@example.test"] }, { bcc: ["secret@example.test"] }]) {
    assert.notEqual(core.snapshot(details), core.snapshot({ ...details, ...change }));
  }
  assert.equal(core.snapshot(details), core.snapshot({ ...details, unrelatedDisplayField: 123 }));
});

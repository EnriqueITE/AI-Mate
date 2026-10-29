const assert = require("node:assert/strict");
const test = require("node:test");
const { JSDOM } = require("jsdom");

global.DOMParser = new JSDOM().window.DOMParser;
const ReplyCore = require("../reply-core.js");
const parse = (html) => new DOMParser().parseFromString(html, "text/html");

test("HTML insertion preserves the existing editor body attributes and head styles", () => {
  const details = {
    isPlainText: false,
    body: '<html><head><style>p { font-family: Georgia; }</style></head><body style="color: red" dir="rtl"><p>My formatted draft</p><div class="moz-signature">Configured signature</div></body></html>'
  };
  const result = ReplyCore.prepareInsertion(details, "A new paragraph.", null, "new-reply");
  // Thunderbird assigns update.body to editor.document.documentElement.innerHTML.
  const editor = parse(details.body);
  editor.documentElement.innerHTML = result.update.body;
  assert.equal(editor.body.getAttribute("style"), "color: red");
  assert.equal(editor.body.getAttribute("dir"), "rtl");
  assert.equal(editor.head.querySelector("style")?.textContent, "p { font-family: Georgia; }");
  assert.equal(editor.querySelector("p").textContent, "My formatted draft");
  assert.equal(editor.querySelector(".moz-signature").textContent, "Configured signature");
});

test("AI-Mate markers inside quoted emails do not block a new reply", () => {
  const details = {
    isPlainText: false,
    body: '<p>My draft</p><blockquote type="cite"><span data-ai-reply="sent-reply">An earlier AI-Mate email.</span></blockquote>'
  };
  const context = ReplyCore.buildContext(details);
  assert.equal(context.draft, "My draft");
  assert.equal(context.quoted, "An earlier AI-Mate email.");
  const result = ReplyCore.prepareInsertion(details, "New reply.", null, "new-reply");
  const doc = parse(result.update.body);
  assert.equal(doc.querySelector('blockquote [data-ai-reply="sent-reply"]').textContent, "An earlier AI-Mate email.");
  assert.equal(doc.querySelector('[data-ai-reply="new-reply"]').textContent, "New reply.");
});

test("regeneration replaces only the current reply when an older marker is quoted", () => {
  const original = {
    isPlainText: false,
    body: '<p>Manual opening</p><blockquote type="cite"><span data-ai-reply="sent-reply">An earlier AI-Mate email.</span></blockquote>'
  };
  const first = ReplyCore.prepareInsertion(original, "First generated reply.", null, "current-reply");
  const current = { ...original, body: first.update.body };
  const regenerated = ReplyCore.prepareInsertion(current, "Replacement reply.", first.state, "next-reply");
  const doc = parse(regenerated.update.body);
  assert.equal(doc.querySelector("p").textContent, "Manual opening");
  assert.equal(doc.querySelector('blockquote [data-ai-reply="sent-reply"]').textContent, "An earlier AI-Mate email.");
  assert.equal(doc.querySelector('[data-ai-reply="next-reply"]').textContent, "Replacement reply.");
  assert.equal(doc.querySelector('[data-ai-reply="current-reply"]'), null);
});

const test = require("node:test");
const assert = require("node:assert/strict");
const { JSDOM } = require("jsdom");
const core = require("../rewrite-core.js");
const { createSelectionEditor } = require("../selection-editor.js");

function editor(html) {
  const dom = new JSDOM(`<html><body contenteditable="true">${html}</body></html>`);
  const doc = dom.window.document;
  let focused = true, sequence = 0;
  doc.hasFocus = () => focused;
  doc.execCommand = (command, _, text) => {
    assert.equal(command, "insertText");
    const range = dom.window.getSelection().getRangeAt(0);
    range.deleteContents();
    const node = doc.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node); range.collapse(true);
    return true;
  };
  const api = createSelectionEditor(doc, () => `selection-${++sequence}`);
  function select(start, offset = 0, end = start, endOffset = end.length) {
    const range = doc.createRange(); range.setStart(start, offset); range.setEnd(end, endOffset);
    const selection = dom.window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return api.state();
  }
  return { doc, api, select, blur() { focused = false; }, focus() { focused = true; }, close() { api.destroy(); dom.window.close(); } };
}

test("six rewrite styles use only the selected text and supplied instructions", () => {
  assert.equal(Object.keys(core.STYLES).length, 6);
  for (const style of Object.keys(core.STYLES)) {
    const messages = core.buildMessages({ text: "Selected only", links: [], subject: "Secret subject", to: "private@example.test", body: "Unselected secret" }, style, "Keep it kind");
    const payload = JSON.stringify(messages);
    assert.match(payload, /Selected only/); assert.match(payload, /Keep it kind/);
    assert.ok(messages[0].content.includes(core.STYLES[style]));
    assert.doesNotMatch(payload, /Secret subject|private@example|Unselected secret/);
    assert.match(payload, /untrusted source data/);
  }
  assert.throws(() => core.buildMessages({ text: "x", links: [] }, "formal", "x".repeat(4001)));
});

test("actual ranges distinguish repeated text; popup blur preserves the captured range", () => {
  const e = editor("<p>Same text. Same text.</p><p>Outside</p>");
  const before = e.doc.body.innerHTML;
  const state = e.select(e.doc.querySelector("p").firstChild, 11, undefined, 20);
  assert.equal(state.text, "Same text");
  e.blur(); e.doc.defaultView.getSelection().removeAllRanges();
  assert.equal(e.api.state().token, state.token);
  const result = e.api.apply(state.token, "New wording");
  assert.equal(e.doc.querySelector("p").textContent, "Same text. New wording.");
  e.api.restore(result.undoToken);
  assert.equal(e.doc.body.innerHTML, before);
  e.close();
});

test("formatting, links, paragraph boundaries and outside edits survive selection undo", () => {
  for (const span of [false, true]) {
    const e = editor('<p>Before <b>selected first</b> tail</p><p>second ending</p><p id="outside">Outside</p><div class="moz-signature">Signature</div>');
    const before = e.doc.body.innerHTML;
    const start = e.doc.querySelector("b").firstChild;
    const end = span ? e.doc.querySelectorAll("p")[1].firstChild : start;
    const state = e.select(start, 0, end, span ? 6 : start.length);
    const result = e.api.apply(state.token, "Rewritten\n\nTwo paragraphs");
    e.doc.getElementById("outside").textContent = "Later outside edit";
    assert.equal(e.api.undoState(result.undoToken).canUndo, true);
    e.api.restore(result.undoToken);
    assert.equal(e.doc.body.innerHTML, before.replace("Outside", "Later outside edit"));
    assert.equal(e.api.undoState(result.undoToken).canUndo, false);
    e.close();
  }
});

test("changed body or detached range refuses replacement without touching anything", () => {
  for (const change of [(e) => { e.doc.querySelector("p").firstChild.data = "Edited"; }, (e) => { e.doc.body.style.color = "red"; }, (e) => { e.doc.querySelector("p").remove(); }]) {
    const e = editor("<p>Selection</p>");
    const state = e.select(e.doc.querySelector("p").firstChild);
    change(e); const before = e.doc.body.innerHTML;
    assert.throws(() => e.api.apply(state.token, "New wording"), /email changed/);
    assert.equal(e.doc.body.innerHTML, before); e.close();
  }
});

test("undo rejects edits inside the result and stale tokens without partial restoration", () => {
  const e = editor("<p>Before <b>selection</b> after</p>");
  const state = e.select(e.doc.querySelector("b").firstChild);
  const result = e.api.apply(state.token, "New wording");
  e.doc.querySelector("b").textContent = "Manual edit";
  const before = e.doc.body.innerHTML;
  assert.throws(() => e.api.restore(result.undoToken), /Nothing has been undone/);
  assert.equal(e.doc.body.innerHTML, before);
  assert.throws(() => e.api.apply("forged", "Text")); e.close();
});

test("empty, large, non-text, signature and quoted selections fail locally", () => {
  for (const html of ["<p> </p>", `<p>${"a".repeat(60001)}</p>`, '<div class="moz-signature">Signature</div>', '<blockquote>Quoted</blockquote>', '<p>Text<img src="cid:test"></p>', '<table><tr><td>Data</td></tr></table>']) {
    const e = editor(html);
    const range = e.doc.createRange(); range.selectNodeContents(e.doc.body);
    e.doc.defaultView.getSelection().addRange(range);
    const state = e.api.state(); assert.equal(state.canRewrite, false, html.slice(0, 50)); assert.ok(state.rewriteReason);
    e.close();
  }
});

test("hidden hyperlink destinations must survive literally and model HTML remains text", () => {
  const e = editor('<p>Read <a href="https://example.test/proposal?a=1&amp;b=2">the proposal</a>.</p>');
  const state = e.select(e.doc.querySelector("a").firstChild);
  assert.deepEqual(state.links, ["https://example.test/proposal?a=1&b=2"]);
  assert.throws(() => e.api.apply(state.token, "Missing destination"), /link destination/);
  e.api.apply(state.token, '<script>alert(1)</script> https://example.test/proposal?a=1&b=2');
  assert.equal(e.doc.querySelector("script"), null);
  assert.match(e.doc.body.textContent, /<script>/); e.close();
});

test("plain-text quoted lines and signature suffixes are blocked even for partial selections", () => {
  for (const html of [
    "Draft<br>&gt; Quoted words<br>",
    "Draft\n> Quoted words\n",
    "Draft<br>-- <br>Signature words",
    "Draft\n-- \r\nSignature words",
    "<div>Draft</div><div>&gt; <b>Quoted words</b></div>",
    "<div>Draft</div><div>--&nbsp;</div><div><b>Signature words</b></div>"
  ]) {
    const e = editor(html);
    const walker = e.doc.createTreeWalker(e.doc.body, e.doc.defaultView.NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && !node.data.includes("words")) {}
    const offset = node.data.indexOf("words");
    const before = e.doc.body.innerHTML;
    const state = e.select(node, offset, node, offset + 5);
    assert.equal(state.canRewrite, false, html);
    assert.match(state.rewriteReason, /signatures and quoted messages/);
    assert.throws(() => e.api.apply(state.token, "Replacement"), /selection is no longer available/);
    assert.equal(e.doc.body.innerHTML, before);
    e.close();
  }
});

test("text quote detection preserves authored selections and uses positions for repeated text", () => {
  const e = editor("<p>Same words</p><p>&gt; Same words</p><p>Another authored paragraph</p><p>-- </p><p>Same words</p>");
  const paragraphs = e.doc.querySelectorAll("p");
  assert.equal(e.select(paragraphs[0].firstChild).canRewrite, true);
  assert.equal(e.select(paragraphs[1].firstChild, 2).canRewrite, false);
  assert.equal(e.select(paragraphs[2].firstChild).canRewrite, true);
  assert.equal(e.select(paragraphs[4].firstChild).canRewrite, false);
  assert.equal(e.select(paragraphs[0].firstChild, 0, paragraphs[1].firstChild, 4).canRewrite, false);
  const state = e.select(paragraphs[0].firstChild);
  const before = e.doc.body.innerHTML;
  const applied = e.api.apply(state.token, "New words");
  assert.equal(paragraphs[1].textContent, "> Same words");
  assert.equal(paragraphs[4].textContent, "Same words");
  e.api.restore(applied.undoToken);
  assert.equal(e.doc.body.innerHTML, before);
  e.close();
});

test("recognizable textual quote introductions are protected without blocking authored text before them", () => {
  const e = editor("<p>My response</p><p>El lunes Ana escribió:</p><br><p>&gt; Original email</p>");
  const paragraphs = e.doc.querySelectorAll("p");
  assert.equal(e.select(paragraphs[0].firstChild).canRewrite, true);
  assert.equal(e.select(paragraphs[1].firstChild, 3, undefined, 8).canRewrite, false);
  e.close();
});

test("selection tokens and undo records are independent between editors", () => {
  const first = editor("<p>One</p>"), second = editor("<p>Two</p>");
  const a = first.select(first.doc.querySelector("p").firstChild);
  const b = second.select(second.doc.querySelector("p").firstChild);
  first.api.apply(a.token, "Changed");
  assert.equal(second.api.verify(b.token).text, "Two");
  first.close(); second.close();
});

test("native whitespace cleanup cannot change unselected neighbouring text", () => {
  const e = editor("<p>Before <b>selection</b> after.</p>");
  const before = e.doc.body.innerHTML;
  const insert = e.doc.execCommand;
  e.doc.execCommand = (...args) => { const result = insert(...args); e.doc.querySelector("b").nextSibling.data = "after."; return result; };
  const state = e.select(e.doc.querySelector("b").firstChild);
  const result = e.api.apply(state.token, "New text");
  assert.equal(e.doc.querySelector("b").nextSibling.data, " after.");
  e.api.restore(result.undoToken); assert.equal(e.doc.body.innerHTML, before); e.close();
});

test("rewriting still records undo after compose replaces the body element", () => {
  const e = editor("<p>Old body</p>");
  const replacement = e.doc.createElement("body"); replacement.innerHTML = "<p>New body selection</p>";
  e.doc.body.replaceWith(replacement);
  const state = e.select(e.doc.querySelector("p").firstChild);
  const result = e.api.apply(state.token, "Rewritten");
  assert.equal(e.api.undoState(result.undoToken).canUndo, true);
  e.api.restore(result.undoToken); assert.equal(e.doc.body.textContent, "New body selection"); e.close();
});

test("undo refuses changed ancestor formatting and moving the result into a signature", () => {
  for (const change of [(e) => { e.doc.querySelector("b").style.color = "red"; }, (e) => { e.doc.querySelector(".moz-signature").appendChild(e.doc.querySelector("b")); }]) {
    const e = editor('<p>Before <b>selection</b> after</p><div class="moz-signature">Signature</div>');
    const state = e.select(e.doc.querySelector("b").firstChild);
    const result = e.api.apply(state.token, "New text"); change(e);
    const before = e.doc.body.innerHTML;
    assert.throws(() => e.api.restore(result.undoToken), /Nothing has been undone/);
    assert.equal(e.doc.body.innerHTML, before); e.close();
  }
});

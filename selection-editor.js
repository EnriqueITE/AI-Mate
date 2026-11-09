/* Runs only in Thunderbird compose editors. Captures actual DOM ranges, not text matches. */
(function (root) {
  "use strict";
  function createSelectionEditor(doc, uuid) {
    const win = doc.defaultView;
    const blocked = ".moz-signature, #moz-signature, .moz-cite-prefix, blockquote, .moz-forward-container, img, table, svg, math, video, audio, canvas, iframe, object, embed, hr, form, input, button, select, textarea, script, style, [hidden], [aria-hidden='true'], [contenteditable='false']";
    const stale = "The email changed or the selection is no longer available. Select the text again; nothing was replaced.";
    const undoError = "The rewritten fragment changed or can no longer be identified safely. Nothing has been undone.";
    let capture = null, lastReason = "Select some text in the email body first.", undo = null;
    const observer = new win.MutationObserver(() => {});
    // setComposeDetails replaces the body element. Observe its stable parent so
    // rewriting still works after any existing generate/improve/undo operation.
    observer.observe(doc.documentElement, { subtree: true, childList: true, characterData: true, characterDataOldValue: true, attributes: true, attributeOldValue: true });
    const snapshot = () => doc.documentElement.innerHTML;
    const fingerprint = (node) => node.nodeType === 1 ? node.outerHTML : node.nodeValue;
    const isInside = (node) => node === doc.body || doc.body.contains(node);
    function readable(node) {
      if (node.nodeType === 3) return node.nodeValue;
      if (node.nodeName === "BR") return "\n";
      const text = Array.from(node.childNodes).map(readable).join("");
      return /^(P|DIV|LI|PRE|H[1-6])$/.test(node.nodeName) ? text + "\n" : text;
    }
    function intersectsTextProtection(range) {
      // Plain-text compose documents may represent quotes and signatures with
      // text/BR nodes instead of semantic elements. Keep line boundaries tied
      // to DOM positions so selecting only part of such a line is also blocked.
      const lines = [];
      let text = "", start = null;
      const finish = (end) => {
        lines.push({ text: text.replace(/\r$/, ""), start: start || end, end });
        text = ""; start = null;
      };
      const visit = (node, parent, index) => {
        if (node.nodeType === 3) {
          let offset = 0, newline;
          while ((newline = node.data.indexOf("\n", offset)) >= 0) {
            start ||= [node, offset];
            text += node.data.slice(offset, newline);
            finish([node, newline + 1]);
            offset = newline + 1;
          }
          if (offset < node.length) {
            start ||= [node, offset];
            text += node.data.slice(offset);
          }
          return;
        }
        if (node.nodeType !== 1) return;
        if (node.nodeName === "BR" || node.matches(blocked)) {
          finish([parent, index + 1]);
          return;
        }
        const block = /^(P|DIV|LI|PRE|H[1-6]|SECTION|ARTICLE|UL|OL)$/.test(node.nodeName);
        if (block && start) finish([parent, index]);
        Array.from(node.childNodes).forEach((child, childIndex) => visit(child, node, childIndex));
        if (block) finish([node, node.childNodes.length]);
      };
      Array.from(doc.body.childNodes).forEach((node, index) => visit(node, doc.body, index));
      if (start) finish([doc.body, doc.body.childNodes.length]);
      const intersects = (from, to) => {
        const protectedRange = doc.createRange();
        protectedRange.setStart(...from); protectedRange.setEnd(...to);
        // End of selection > start of protected range, and start < end.
        return range.compareBoundaryPoints(win.Range.START_TO_END, protectedRange) > 0
          && range.compareBoundaryPoints(win.Range.END_TO_START, protectedRange) < 0;
      };
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        if (/^--[ \u00a0]$/.test(line.text)) {
          if (intersects(line.start, [doc.body, doc.body.childNodes.length])) return true;
        }
        if (/^\s*>/.test(line.text)) {
          if (intersects(line.start, line.end)) return true;
          let preceding = index - 1;
          while (preceding >= 0 && !lines[preceding].text.trim()) preceding--;
          if (preceding >= 0 && /^(?:On .+wrote:|El .+escribi[oó]:|Le .+[ée]crit\s*:|Am .+schrieb .+:)\s*$/i.test(lines[preceding].text)
              && intersects(lines[preceding].start, lines[preceding].end)) return true;
        }
      }
      return false;
    }
    function remember() {
      const selection = win.getSelection();
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        // Opening an extension popup may collapse the visual selection on blur.
        if (doc.hasFocus()) capture = null;
        return;
      }
      const range = selection.getRangeAt(0);
      if (!isInside(range.startContainer) || !isInside(range.endContainer)) { capture = null; return; }
      try {
        for (const node of doc.body.querySelectorAll(blocked)) {
          if (range.intersectsNode(node)) throw new Error("Select plain text outside images, tables, signatures and quoted messages.");
        }
        if (intersectsTextProtection(range)) throw new Error("Select text outside signatures and quoted messages. Nothing has been sent.");
        const fragment = range.cloneContents();
        const text = readable(fragment).replace(/\n$/, "");
        const links = new Set(Array.from(text.matchAll(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.|mailto:|tel:)[^\s<>"']+/gi), (match) => match[0].replace(/[.,;!]+$/, "")));
        for (const anchor of doc.body.querySelectorAll("a[href]")) {
          if (range.intersectsNode(anchor)) links.add(anchor.getAttribute("href"));
        }
        const value = { text, links: [...links] };
        root.RewriteCore.validateSelection(value);
        const baseline = snapshot();
        if (!capture || capture.baseline !== baseline || capture.range.startContainer !== range.startContainer || capture.range.startOffset !== range.startOffset || capture.range.endContainer !== range.endContainer || capture.range.endOffset !== range.endOffset) {
          capture = { ...value, token: uuid(), range: range.cloneRange(), baseline };
        }
        lastReason = "";
      } catch (error) { capture = null; lastReason = error.message; }
    }
    function verify(token) {
      if (!capture || capture.token !== token || capture.baseline !== snapshot() || !isInside(capture.range.startContainer) || !isInside(capture.range.endContainer)) throw new Error(stale);
      return capture;
    }
    function state() {
      remember();
      if (!capture) return { canRewrite: false, rewriteReason: lastReason || "Select some text in the email body first." };
      try { verify(capture.token); }
      catch { return { canRewrite: false, rewriteReason: stale }; }
      return { canRewrite: true, rewriteReason: "", token: capture.token, text: capture.text, links: capture.links };
    }
    // A reversible journal keeps the original DOM nodes and formatting. Validate
    // the entire inverse in memory before touching the editor during Undo.
    function inverse(record) {
      if (!record || record.format !== doc.body.getAttribute("style")) throw new Error(undoError);
      for (const [node, parent, attributes] of record.ancestors) {
        if (node.parentNode !== parent || JSON.stringify(Array.from(node.attributes, (attr) => [attr.name, attr.value])) !== attributes) throw new Error(undoError);
      }
      for (const [node, value] of record.fingerprints) if (fingerprint(node) !== value) throw new Error(undoError);
      const children = new Map(), values = new Map();
      const actions = [];
      const list = (node) => { if (!children.has(node)) children.set(node, Array.from(node.childNodes)); return children.get(node); };
      for (const patch of [...record.patches].reverse()) {
        if (patch.type === "characterData") {
          const current = values.has(patch.target) ? values.get(patch.target) : patch.target.data;
          if (current !== patch.after) throw new Error(undoError);
          values.set(patch.target, patch.oldValue);
          actions.push(() => { patch.target.data = patch.oldValue; });
        } else if (patch.type === "childList") {
          const nodes = list(patch.target);
          let index;
          if (patch.added.length) {
            index = nodes.indexOf(patch.added[0]);
            if (index < 0 || patch.added.some((node, offset) => nodes[index + offset] !== node)) throw new Error(undoError);
          } else {
            index = patch.next ? nodes.indexOf(patch.next) : nodes.length;
            if (index < 0 || (patch.previous && nodes.indexOf(patch.previous) !== index - 1)) throw new Error(undoError);
          }
          nodes.splice(index, patch.added.length, ...patch.removed);
          actions.push(() => {
            const reference = patch.added[0] || patch.next;
            for (const node of patch.removed) patch.target.insertBefore(node, reference);
            for (const node of patch.added) patch.target.removeChild(node);
          });
        } else { throw new Error(undoError); }
      }
      return actions;
    }
    function undoState(token) {
      try {
        if (!undo || undo.token !== token || !undo.roots.every(isInside)) throw new Error(undoError);
        inverse(undo);
        return { canUndo: true, undoReason: "" };
      } catch { return { canUndo: false, undoReason: undoError }; }
    }
    function apply(token, text) {
      const saved = verify(token);
      text = root.RewriteCore.validateResult(text, saved.links);
      text = (saved.text.match(/^\s*/)?.[0] || "") + text + (saved.text.match(/\s*$/)?.[0] || "");
      const untouchedText = [];
      const walker = doc.createTreeWalker(doc.body, win.NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (!saved.range.intersectsNode(node)) untouchedText.push([node, node.data]);
      }
      const selection = win.getSelection();
      selection.removeAllRanges(); selection.addRange(saved.range);
      observer.takeRecords();
      // Thunderbird's native editor transaction marks the draft dirty, preserving
      // its own input/autosave behavior. Never insert model HTML.
      if (!doc.execCommand("insertText", false, text)) throw new Error("Thunderbird could not replace this selection. Your preview is still available.");
      // Gecko's native HTML whitespace cleanup can trim a neighbouring text
      // node (for example the space after </b>). It is outside the selected
      // range, so restore its original characters in this same synchronous edit.
      for (const [outside, original] of untouchedText) {
        if (isInside(outside) && outside.data !== original) outside.data = original;
      }
      const records = observer.takeRecords();
      if (!records.length) throw new Error("Thunderbird did not replace the selected text.");
      const patches = records.map((record) => ({ type: record.type, target: record.target, oldValue: record.oldValue, added: Array.from(record.addedNodes), removed: Array.from(record.removedNodes), next: record.nextSibling, previous: record.previousSibling }));
      patches.forEach((patch, index) => {
        if (patch.type === "characterData") patch.after = patches.slice(index + 1).find((next) => next.type === "characterData" && next.target === patch.target)?.oldValue ?? patch.target.data;
      });
      const added = new Set(patches.flatMap((patch) => patch.added));
      const fingerprints = [...added].filter(isInside).map((node) => [node, fingerprint(node)]);
      const roots = [...new Set(patches.map((patch) => patch.target).filter(isInside))];
      const ancestors = new Map();
      for (const target of roots) {
        for (let element = target.nodeType === 1 ? target : target.parentElement; element && isInside(element); element = element.parentElement) {
          ancestors.set(element, [element, element.parentNode, JSON.stringify(Array.from(element.attributes, (attr) => [attr.name, attr.value]))]);
        }
      }
      undo = { token: uuid(), patches, fingerprints, roots, ancestors: [...ancestors.values()], format: doc.body.getAttribute("style") };
      capture = null;
      return { undoToken: undo.token };
    }
    function restore(token) {
      if (!undoState(token).canUndo) throw new Error(undoError);
      inverse(undo).forEach((action) => action());
      undo = null; capture = null;
      doc.body.dispatchEvent(new win.InputEvent("input", { bubbles: true, inputType: "historyUndo" }));
    }
    function discard(token) { if (capture?.token === token) capture = null; }
    const changed = () => remember();
    doc.addEventListener("selectionchange", changed);
    return { state, verify, apply, restore, undoState, discard, clearUndo() { undo = null; }, destroy() { observer.disconnect(); doc.removeEventListener("selectionchange", changed); capture = undo = null; } };
  }
  if (typeof module !== "undefined" && module.exports) { module.exports = { createSelectionEditor }; return; }
  if (root.__aiMateSelectionEditor) return;
  // Compose documents are not secure contexts on all supported Thunderbird
  // versions, so randomUUID may be absent even though getRandomValues works.
  const controller = createSelectionEditor(document, () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join(""));
  root.__aiMateSelectionEditor = controller;
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(browser.runtime.getURL("")) || message?.channel !== "ai-mate-selection") return undefined;
    try {
      switch (message.command) {
        case "state": return Promise.resolve({ ok: true, ...controller.state() });
        case "verify": { const value = controller.verify(message.token); return Promise.resolve({ ok: true, token: value.token, text: value.text, links: value.links }); }
        case "apply": return Promise.resolve({ ok: true, ...controller.apply(message.token, message.text) });
        case "undoState": return Promise.resolve({ ok: true, ...controller.undoState(message.token) });
        case "undo": controller.restore(message.token); break;
        case "discard": controller.discard(message.token); break;
        case "clearUndo": controller.clearUndo(); break;
        default: throw new Error("Unknown selection operation.");
      }
      return Promise.resolve({ ok: true });
    } catch (error) { return Promise.resolve({ ok: false, error: error.message }); }
  });
})(typeof globalThis !== "undefined" ? globalThis : this);

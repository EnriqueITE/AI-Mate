const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const popupSource = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8");

function makeElement(value = "") {
  const classes = new Set();
  return {
    value,
    disabled: false,
    hidden: false,
    textContent: "",
    style: {},
    listeners: {},
    classList: {
      add(name) { classes.add(name); },
      remove(name) { classes.delete(name); },
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      contains(name) { return classes.has(name); }
    },
    addEventListener(event, listener) { this.listeners[event] = listener; },
    replaceChildren() { this.textContent = ""; }
  };
}

async function createPopup({ stored = {}, sendMessage = async () => ({ ok: true }), failStorage = false, href = "moz-extension://test/popup.html?tabId=42", queryTabs = async () => [], getState = async () => ({ ok: true, busy: false, canImprove: true, canUndo: false, undoReason: "No change is available to undo in this window." }) } = {}) {
  const ids = ["summarySection", "summary", "summarize", "sumSpinner", "clearSummary", "generate", "prompt", "replyStyle", "replyLength", "status", "genSpinner", "improve", "improveSpinner", "improveReason", "undo", "undoSpinner", "undoReason", "openOptions", "warning"];
  const elements = Object.fromEntries(ids.map((id) => [id, makeElement(id === "replyStyle" ? "natural" : "")]));
  const writes = [];
  const messages = [];
  const stateMessages = [];
  const tabQueries = [];
  const timers = [];
  const cancelledTimers = new Set();
  let initialize;
  let closed = false;
  const context = vm.createContext({
    URL,
    window: { location: { href }, close() { closed = true; } },
    document: {
      body: makeElement(),
      documentElement: { setAttribute() {} },
      getElementById(id) { return elements[id]; },
      addEventListener(event, listener) { if (event === "DOMContentLoaded") initialize = listener; }
    },
    browser: {
      tabs: { async query(query) {
        tabQueries.push(JSON.parse(JSON.stringify(query)));
        return queryTabs(query);
      } },
      storage: { local: {
        async get(defaults) { return { ...defaults, openaiApiKey: "configured", ...stored }; },
        async set(value) {
          if (failStorage) throw new Error("Storage unavailable");
          writes.push(JSON.parse(JSON.stringify(value)));
        }
      } },
      runtime: { async sendMessage(payload) {
        if (payload.type === "GET_COMPOSE_ACTION_STATE") {
          stateMessages.push(JSON.parse(JSON.stringify(payload)));
          return getState(payload);
        }
        messages.push(JSON.parse(JSON.stringify(payload)));
        return sendMessage(payload);
      } }
    },
    setTimeout(callback) {
      const id = timers.length + 1;
      timers.push(() => { if (!cancelledTimers.has(id)) return callback(); });
      return id;
    },
    clearTimeout(id) { cancelledTimers.add(id); }
  });
  vm.runInContext(popupSource, context, { filename: "popup.js" });
  await initialize();
  return { context, elements, messages, stateMessages, tabQueries, writes, timers, isClosed: () => closed };
}

test("existing installations and invalid stored styles default to natural", async () => {
  for (const stored of [{}, { replyStyle: "unsupported" }, { replyStyle: null }]) {
    const popup = await createPopup({ stored });
    assert.equal(popup.elements.replyStyle.value, "natural");
  }
});

test("all supported styles load and are included with the compose tab and instruction", async () => {
  for (const replyStyle of ["natural", "formal", "friendly"]) {
    const popup = await createPopup({ stored: { replyStyle, lastPrompt: "  Please confirm the meeting.  " } });
    assert.equal(popup.elements.replyStyle.value, replyStyle);
    await popup.context.onGenerate();
    assert.deepEqual(popup.messages, [{ type: "GENERATE_REPLY", operation: "generate", prompt: "Please confirm the meeting.", replyStyle, replyLength: "normal", tabId: 42 }]);
    assert.deepEqual(popup.writes.at(-1), { lastPrompt: "Please confirm the meeting.", replyStyle, replyLength: "normal" });
    assert.equal(popup.elements.status.textContent, "Reply inserted.");
    assert.equal(popup.timers.length, 1);
    popup.timers[0]();
    assert.equal(popup.isClosed(), true);
  }
});

test("changing the selector persists the preference without generating a reply", async () => {
  const popup = await createPopup();
  popup.elements.replyStyle.value = "friendly";
  await popup.elements.replyStyle.listeners.change();
  assert.deepEqual(popup.writes, [{ replyStyle: "friendly" }]);
  assert.equal(popup.messages.length, 0);
});

test("concurrent click and Enter generate only once and lock the inputs", async () => {
  let resolveRequest;
  const request = new Promise((resolve) => { resolveRequest = resolve; });
  const popup = await createPopup({ sendMessage: () => request });
  const first = popup.elements.generate.listeners.click();
  let prevented = false;
  popup.elements.prompt.listeners.keydown({ key: "Enter", shiftKey: false, preventDefault() { prevented = true; } });
  await popup.context.onGenerate();
  assert.equal(prevented, true);
  assert.equal(popup.messages.length, 1);
  for (const id of ["generate", "improve", "undo", "prompt", "replyStyle", "replyLength", "openOptions"]) assert.equal(popup.elements[id].disabled, true);
  assert.equal(popup.elements.genSpinner.style.display, "inline-block");
  resolveRequest({ ok: true });
  await first;
  for (const id of ["generate", "prompt", "replyStyle"]) assert.equal(popup.elements[id].disabled, false);
  assert.equal(popup.elements.genSpinner.style.display, "none");
});

test("API errors preserve the existing summary, enable retry and keep the popup open", async () => {
  const popup = await createPopup({ sendMessage: async () => ({ ok: false, error: "The draft changed. Please generate again." }) });
  popup.elements.summary.textContent = "Existing summary";
  popup.elements.summarySection.hidden = false;
  await popup.context.onGenerate();
  assert.match(popup.elements.status.textContent, /The draft changed/);
  assert.equal(popup.elements.summary.textContent, "Existing summary");
  assert.equal(popup.elements.summarySection.hidden, false);
  for (const id of ["generate", "prompt", "replyStyle"]) assert.equal(popup.elements[id].disabled, false);
  assert.equal(popup.timers.length, 0);
  await popup.context.onGenerate();
  assert.equal(popup.messages.length, 2);
});

test("a storage error after insertion does not report generation failure", async () => {
  const popup = await createPopup({ failStorage: true });
  await popup.context.onGenerate();
  assert.match(popup.elements.status.textContent, /^Reply inserted\./);
  assert.equal(popup.elements.status.classList.contains("error"), false);
  assert.equal(popup.timers.length, 1);
});

test("Shift+Enter keeps newline behavior", async () => {
  const popup = await createPopup();
  let prevented = false;
  popup.elements.prompt.listeners.keydown({ key: "Enter", shiftKey: true, preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(popup.messages.length, 0);
});

test("length defaults to normal without migrating or overwriting old preferences", async () => {
  for (const replyLength of [undefined, null, "unsupported"]) {
    const popup = await createPopup({ stored: { replyLength, lastPrompt: "Keep this instruction", writingPreferences: "Permanent rule" } });
    assert.equal(popup.elements.replyLength.value, "normal");
    assert.equal(popup.elements.prompt.value, "Keep this instruction");
    assert.equal(popup.writes.length, 0);
  }
});

test("each length loads, persists independently and is sent with generation", async () => {
  for (const replyLength of ["short", "normal", "detailed"]) {
    const popup = await createPopup({ stored: { replyLength } });
    assert.equal(popup.elements.replyLength.value, replyLength);
    await popup.elements.replyLength.listeners.change();
    assert.deepEqual(popup.writes, [{ replyLength }]);
    assert.equal(popup.messages.length, 0);
    await popup.context.onGenerate();
    assert.equal(popup.messages[0].replyLength, replyLength);
    assert.equal(popup.writes.at(-1).replyLength, replyLength);
    assert.equal(Object.hasOwn(popup.writes.at(-1), "writingPreferences"), false);
  }
});

test("Improve Draft sends the current instruction, style and length and closes after success", async () => {
  const popup = await createPopup({ stored: { replyStyle: "formal", replyLength: "detailed", lastPrompt: " Preserve the dates. " } });
  assert.equal(popup.elements.improve.disabled, false);
  assert.equal(popup.elements.improveReason.hidden, true);
  await popup.elements.improve.listeners.click();
  assert.deepEqual(popup.messages, [{ type: "GENERATE_REPLY", operation: "improve", prompt: "Preserve the dates.", replyStyle: "formal", replyLength: "detailed", tabId: 42 }]);
  assert.equal(popup.elements.status.textContent, "Draft improved.");
  assert.equal(popup.timers.length, 1);
  popup.timers[0]();
  assert.equal(popup.isClosed(), true);
});

test("reopening a popup queries undo availability and successful undo consumes it without closing", async () => {
  let canUndo = true;
  const popup = await createPopup({
    getState: async () => ({ ok: true, canImprove: true, canUndo, undoReason: "No change is available to undo in this window." }),
    sendMessage: async () => { canUndo = false; return { ok: true }; }
  });
  assert.deepEqual(popup.stateMessages, [{ type: "GET_COMPOSE_ACTION_STATE", tabId: 42 }]);
  assert.equal(popup.elements.undo.disabled, false);
  await popup.elements.undo.listeners.click();
  assert.deepEqual(popup.messages, [{ type: "UNDO_LAST_REPLY", tabId: 42 }]);
  assert.equal(popup.elements.status.textContent, "Last change undone.");
  assert.equal(popup.elements.undo.disabled, true);
  assert.match(popup.elements.undoReason.textContent, /No change/);
  assert.equal(popup.elements.undoReason.hidden, false);
  assert.equal(popup.writes.length, 0);
  assert.equal(popup.timers.length, 0);
  assert.equal(popup.isClosed(), false);
});

test("disabled improvement and undo explain the reason and do not send a mutation", async () => {
  const popup = await createPopup({ getState: async () => ({ ok: true, canImprove: false, improveReason: "The draft contains an image.", canUndo: false, undoReason: "The inserted result was edited." }) });
  assert.equal(popup.elements.improve.disabled, true);
  assert.equal(popup.elements.undo.disabled, true);
  assert.equal(popup.elements.improveReason.textContent, "The draft contains an image.");
  assert.equal(popup.elements.undoReason.textContent, "The inserted result was edited.");
  assert.equal(popup.elements.improveReason.hidden, false);
  await popup.context.onImprove();
  await popup.context.onUndo();
  assert.equal(popup.messages.length, 0);
});

test("improve and undo share the local action lock with generation", async () => {
  for (const action of ["improve", "undo"]) {
    let resolveRequest;
    const request = new Promise((resolve) => { resolveRequest = resolve; });
    const popup = await createPopup({
      getState: async () => ({ ok: true, canImprove: true, canUndo: true }),
      sendMessage: () => request
    });
    const pending = popup.elements[action].listeners.click();
    for (const id of ["generate", "improve", "undo", "prompt", "replyStyle", "replyLength", "openOptions"]) assert.equal(popup.elements[id].disabled, true);
    await popup.context.onGenerate();
    await popup.context.onImprove();
    await popup.context.onUndo();
    assert.equal(popup.messages.length, 1);
    resolveRequest({ ok: true });
    await pending;
    for (const id of ["generate", "improve", "undo", "prompt", "replyStyle", "replyLength", "openOptions"]) assert.equal(popup.elements[id].disabled, false);
  }
});

test("a failed undo keeps the popup open and refreshes the disabled reason", async () => {
  let canUndo = true;
  const popup = await createPopup({
    getState: async () => ({ ok: true, canImprove: true, canUndo, undoReason: "The inserted result was edited." }),
    sendMessage: async () => { canUndo = false; return { ok: false, error: "The inserted result was edited." }; }
  });
  await popup.context.onUndo();
  assert.equal(popup.elements.status.textContent, "Error: The inserted result was edited.");
  assert.equal(popup.elements.undo.disabled, true);
  assert.equal(popup.elements.undoReason.textContent, "The inserted result was edited.");
  assert.equal(popup.elements.generate.disabled, false);
  assert.equal(popup.timers.length, 0);
  assert.equal(popup.writes.length, 0);
});

test("a popup opened during a background request refreshes availability when it finishes", async () => {
  let busy = true;
  const popup = await createPopup({ getState: async () => ({ ok: true, busy, canImprove: !busy, canUndo: !busy }) });
  for (const id of ["generate", "improve", "undo"]) assert.equal(popup.elements[id].disabled, true);
  assert.match(popup.elements.improveReason.textContent, /Wait/);
  await popup.context.onGenerate();
  assert.equal(popup.messages.length, 0);
  assert.equal(popup.timers.length, 1);
  busy = false;
  await popup.timers[0]();
  for (const id of ["generate", "improve", "undo"]) assert.equal(popup.elements[id].disabled, false);
});

test("a state query error leaves safe actions disabled with an explanation", async () => {
  const popup = await createPopup({ getState: async () => { throw new Error("Compose window is unavailable."); } });
  assert.equal(popup.elements.improve.disabled, true);
  assert.equal(popup.elements.undo.disabled, true);
  assert.equal(popup.elements.improveReason.textContent, "Compose window is unavailable.");
  assert.equal(popup.messages.length, 0);
});

test("with two compose windows the popup selects only the current window's active tab", async () => {
  const tabs = [
    { id: 42, windowId: 1, type: "messageCompose", active: true },
    { id: 99, windowId: 2, type: "messageCompose", active: true }
  ];
  const popup = await createPopup({
    href: "moz-extension://test/popup.html",
    queryTabs: async query => tabs.filter(tab => (!query.active || tab.active) && (!query.currentWindow || tab.windowId === 2)),
    getState: async () => ({ ok: true, canImprove: true, canUndo: true })
  });
  assert.deepEqual(popup.tabQueries, [{ active: true, currentWindow: true }]);
  assert.deepEqual(popup.stateMessages, [{ type: "GET_COMPOSE_ACTION_STATE", tabId: 99 }]);
  await popup.context.onGenerate();
  await popup.context.onImprove();
  await popup.context.onUndo();
  assert.deepEqual(popup.messages.map(message => message.tabId), [99, 99, 99]);
});

test("without a current compose tab no action falls back to another compose window", async () => {
  const tabs = [
    { id: 42, windowId: 1, type: "messageCompose", active: true },
    { id: 99, windowId: 2, type: "mail", active: true }
  ];
  const popup = await createPopup({
    href: "moz-extension://test/popup.html",
    queryTabs: async query => tabs.filter(tab => !query.currentWindow || tab.windowId === 2)
  });
  assert.deepEqual(popup.tabQueries, [{ active: true, currentWindow: true }]);
  assert.equal(popup.stateMessages.length, 0);
  for (const id of ["generate", "improve", "undo", "summarize"]) assert.equal(popup.elements[id].disabled, true);
  assert.match(popup.elements.status.textContent, /compose window you want to change/);
  assert.match(popup.elements.improveReason.textContent, /compose window you want to change/);
  await popup.context.onGenerate();
  await popup.context.onImprove();
  await popup.context.onUndo();
  await popup.context.onSummarize();
  assert.equal(popup.messages.length, 0);
  assert.equal(popup.elements.openOptions.disabled, false);
});

test("an invalid explicit tab or failed lookup does not fall back to another window", async () => {
  for (const href of ["moz-extension://test/popup.html?tabId=NaN", "moz-extension://test/popup.html?tabId=0", "moz-extension://test/popup.html"]) {
    const popup = await createPopup({ href, queryTabs: async () => { throw new Error("No current window"); } });
    await popup.context.onGenerate();
    assert.equal(popup.elements.generate.disabled, true);
    assert.equal(popup.messages.length, 0);
    assert.equal(popup.stateMessages.length, 0);
  }
});

test("undo started before generation's close timer cancels the pending close", async () => {
  const popup = await createPopup({ getState: async () => ({ ok: true, canImprove: true, canUndo: true }) });
  await popup.context.onGenerate();
  assert.equal(popup.timers.length, 1);
  await popup.context.onUndo();
  assert.equal(popup.elements.status.textContent, "Last change undone.");
  popup.timers[0]();
  assert.equal(popup.isClosed(), false);
  assert.equal(popup.timers.length, 1);
});

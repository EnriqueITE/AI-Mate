const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { JSDOM } = require("jsdom");
const tick = () => new Promise((resolve) => setImmediate(resolve));

async function popup({ available = true, generate, apply } = {}) {
  const dom = new JSDOM(fs.readFileSync("popup.html", "utf8"), { url: "https://extension.test/popup.html?tabId=42", runScripts: "outside-only" });
  // Let jsdom dispatch its automatic DOMContentLoaded before installing scripts.
  await tick();
  const calls = [], writes = [], copied = [];
  let canUndo = false;
  dom.window.navigator.clipboard = { writeText: async (text) => copied.push(text) };
  dom.window.browser = {
    tabs: { query: async () => [] },
    runtime: {
      connect: () => ({ name: "lease" }),
      sendMessage: async (message) => {
        calls.push(JSON.parse(JSON.stringify(message)));
        if (message.type === "GET_COMPOSE_ACTION_STATE") return { ok: true, canRewrite: available, token: "range", canImprove: true, canUndo, rewriteReason: available ? "" : "Select text first." };
        if (message.type === "REWRITE_SELECTION") return generate ? generate(message) : { ok: true, token: "range", original: "Original fragment", text: "Rewritten fragment" };
        if (message.type === "APPLY_REWRITE") { if (apply) return apply(); available = false; canUndo = true; return { ok: true }; }
        if (message.type === "GENERATE_REPLY") { canUndo = true; return { ok: true }; }
        if (message.type === "SUMMARIZE_EMAIL") return {ok:true,summary:"Summary fixture"};
        return { ok: true };
      }
    },
    storage: { local: { get: async (defaults) => ({ ...defaults, openaiApiKey: "fixture-key", lastPrompt: "PRIVATE saved prompt", rewriteStyle: "formal" }), set: async (values) => writes.push(JSON.parse(JSON.stringify(values))) } }
  };
  for (const file of ["lib/dompurify.min.js", "rewrite-core.js", "popup.js", "rewrite-popup.js"]) vm.runInContext(fs.readFileSync(file, "utf8"), dom.getInternalVMContext(), { filename: file });
  dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  await tick(); await tick();
  const e = (id) => dom.window.document.getElementById(id);
  return { dom, e, calls, writes, copied, close() { dom.window.close(); } };
}

test("rewrite is hidden without a selection; valid selection exposes six styles and no saved prompt", async () => {
  for (const available of [false, true]) {
    const app = await popup({ available });
    assert.equal(app.e("rewriteControls").hidden, !available);
    assert.equal(app.e("rewriteStyle").options.length, 6);
    assert.equal(app.e("rewriteStyle").value, "formal");
    assert.equal(app.e("rewriteInstruction").value, "");
    assert.equal(app.calls.filter((c) => c.type === "REWRITE_SELECTION").length, 0);
    app.close();
  }
});

test("native DOM buttons preview, regenerate, copy, apply and expose undo without saving text", async () => {
  const app = await popup();
  app.e("rewriteInstruction").value = "Make this clear";
  app.e("rewrite").click(); await tick();
  assert.equal(app.e("rewritePreview").hidden, false);
  assert.equal(app.e("draftControls").hidden, true);
  assert.equal(app.e("rewriteOriginal").textContent, "Original fragment");
  assert.equal(app.e("rewriteResult").textContent, "Rewritten fragment");
  assert.equal(app.calls.filter((c) => c.type === "APPLY_REWRITE").length, 0);
  assert.equal(app.e("generate").disabled, true);
  app.e("prompt").dispatchEvent(new app.dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(app.calls.filter((c) => c.type === "GENERATE_REPLY").length, 0);
  app.e("copyRewrite").click(); await tick(); assert.deepEqual(app.copied, ["Rewritten fragment"]);
  app.e("regenerateRewrite").click(); await tick();
  assert.equal(app.calls.filter((c) => c.type === "REWRITE_SELECTION").length, 2);
  app.e("applyRewrite").click(); await tick(); await tick();
  assert.equal(app.e("rewritePreview").hidden, true);
  assert.equal(app.e("undo").disabled, false);
  assert.deepEqual(app.writes, []);
  assert.ok(app.calls.filter((c) => c.type === "REWRITE_SELECTION").every((c) => c.instruction === "Make this clear" && c.token === "range"));
  app.close();
});

test("cancel leaves the original alone; only the rewrite style is persisted", async () => {
  const app = await popup();
  app.e("rewriteStyle").value = "direct";
  app.e("rewriteStyle").dispatchEvent(new app.dom.window.Event("change")); await tick();
  app.e("rewrite").click(); await tick();
  app.e("cancelRewrite").click(); await tick(); await tick();
  assert.equal(app.e("rewritePreview").hidden, true);
  assert.equal(app.calls.filter((c) => c.type === "APPLY_REWRITE").length, 0);
  assert.equal(app.calls.filter((c) => c.type === "DISCARD_REWRITE").length, 1);
  assert.deepEqual(app.writes, [{ rewriteStyle: "direct" }]); app.close();
});

test("original reply, improvement, summary and settings remain accessible with and without a selection", async () => {
  for (const available of [false, true]) {
    const app = await popup({available});
    for (const id of ["generate", "improve", "summarize", "openOptions"]) {
      assert.equal(app.e(id).closest("[hidden]"), null, `${id} is visible`);
      assert.equal(app.e(id).disabled, false, `${id} is enabled`);
    }
    app.e("generate").click(); await tick(); await tick();
    assert.equal(app.e("status").textContent, "Reply inserted.");
    app.e("improve").click(); await tick(); await tick();
    assert.equal(app.e("status").textContent, "Draft improved.");
    app.e("summarize").click(); await tick();
    assert.equal(app.e("summary").textContent, "Summary fixture");
    app.e("openOptions").click(); await tick();
    assert.equal(app.e("status").textContent, "Settings opened.");
    assert.deepEqual(app.calls.filter(c => c.type === "GENERATE_REPLY").map(c => c.operation), ["generate", "improve"]);
    assert.equal(app.calls.filter(c => c.type === "OPEN_OPTIONS").length, 1);
    app.close();
  }
});

test("settings remains visible during rewrite preview and cancel restores original actions", async () => {
  const app = await popup();
  app.e("rewrite").click(); await tick();
  assert.equal(app.e("openOptions").closest("[hidden]"), null);
  assert.equal(app.e("openOptions").disabled, false);
  app.e("cancelRewrite").click(); await tick(); await tick();
  assert.equal(app.e("draftControls").hidden, false);
  assert.equal(app.e("generate").disabled, false);
  assert.equal(app.e("improve").disabled, false);
  assert.equal(app.e("summarize").disabled, false);
  app.close();
});

test("double clicks make one request; failed regeneration cannot apply an obsolete preview", async () => {
  let resolve, count = 0;
  const pending = new Promise((yes) => { resolve = yes; });
  const app = await popup({ generate: () => ++count === 1 ? pending : { ok: false, error: "Selection changed" } });
  app.e("rewrite").click(); app.e("rewrite").click(); await tick();
  assert.equal(count, 1); assert.equal(app.e("applyRewrite").disabled, true);
  resolve({ ok: true, original: "Original", text: "Result" }); await tick();
  app.e("regenerateRewrite").click(); await tick();
  assert.equal(app.e("rewritePreview").hidden, true);
  assert.match(app.e("status").textContent, /Selection changed/);
  await app.dom.window.applyRewrite();
  assert.equal(app.calls.filter((c) => c.type === "APPLY_REWRITE").length, 0); app.close();
});

test("unsafe-looking output is rendered literally and apply errors keep the preview available", async () => {
  const app = await popup({ generate: () => ({ ok: true, original: "Original", text: '<img src=x onerror="alert(1)">' }), apply: () => ({ ok: false, error: "Email changed" }) });
  app.e("rewrite").click(); await tick();
  assert.equal(app.e("rewriteResult").querySelector("img"), null);
  app.e("applyRewrite").click(); await tick();
  assert.equal(app.e("rewritePreview").hidden, false);
  assert.match(app.e("status").textContent, /Email changed/); app.close();
});

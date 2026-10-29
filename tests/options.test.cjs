const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { JSDOM } = require("jsdom");

async function createOptions(stored = {}, failStorage = false, { sendMessage = async ({ model }) => ({ ok: true, model }) } = {}) {
  const root = path.join(__dirname, "..");
  const dom = new JSDOM(fs.readFileSync(path.join(root, "options.html"), "utf8"), { runScripts: "outside-only" });
  const writes = [];
  const data = { ...stored };
  const messages = [];
  const timers = [];
  dom.window.setTimeout = (callback) => { timers.push(callback); };
  dom.window.browser = {
    storage: { local: {
      async get(defaults) { return { ...defaults, ...data }; },
      async set(value) {
        if (failStorage) throw new Error("Storage unavailable");
        const copy = JSON.parse(JSON.stringify(value));
        writes.push(copy);
        Object.assign(data, copy);
      }
    } },
    runtime: { async sendMessage(payload) {
      messages.push(JSON.parse(JSON.stringify(payload)));
      return sendMessage(payload);
    } }
  };
  dom.window.eval(fs.readFileSync(path.join(root, "model-config.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(root, "options.js"), "utf8"));
  await dom.window.initializeOptions();
  const element = (id) => dom.window.document.getElementById(id);
  const changeModel = (value) => {
    element("model").value = value;
    element("model").dispatchEvent(new dom.window.Event("change"));
  };
  const chooseCustom = (value) => {
    const other = Array.from(element("model").options).find(option => option.textContent === "Other model");
    element("customModel").value = value;
    changeModel(other.value);
  };
  return { dom, window: dom.window, element, changeModel, chooseCustom, writes, data, messages, timers };
}

test("writing preferences default to empty and do not inherit the last instruction", async () => {
  const options = await createOptions({ lastPrompt: "Old one-off instruction", replyStyle: "formal", replyLength: "short" });
  try {
    assert.equal(options.element("writingPreferences").value, "");
    assert.equal(options.element("defaultPrompt").value, "Old one-off instruction");
    assert.equal(options.writes.length, 0);
    await options.window.save();
    assert.equal(options.data.writingPreferences, "");
    assert.equal(options.data.lastPrompt, "Old one-off instruction");
    assert.equal(options.data.replyStyle, "formal");
    assert.equal(options.data.replyLength, "short");
  } finally { options.dom.window.close(); }
});

test("writing preferences load and save independently from the last instruction", async () => {
  const options = await createOptions({ lastPrompt: "Reply about Friday", writingPreferences: "Use plain language.\nAvoid clichés." });
  try {
    assert.equal(options.element("writingPreferences").value, "Use plain language.\nAvoid clichés.");
    options.element("writingPreferences").value = "Prefer concise sentences.\nKeep product names unchanged.";
    await options.window.save();
    assert.equal(options.data.writingPreferences, "Prefer concise sentences.\nKeep product names unchanged.");
    assert.equal(options.data.lastPrompt, "Reply about Friday");
    assert.equal(options.element("status").textContent, "Saved.");
    options.element("writingPreferences").value = "";
    await options.window.save();
    assert.equal(options.data.writingPreferences, "");
  } finally { options.dom.window.close(); }
});

test("invalid stored writing preferences are ignored and storage errors are reported", async () => {
  const options = await createOptions({ writingPreferences: { invalid: true } }, true);
  try {
    assert.equal(options.element("writingPreferences").value, "");
    options.element("writingPreferences").value = "Keep this visible after failure.";
    await options.window.save();
    assert.equal(options.element("writingPreferences").value, "Keep this visible after failure.");
    assert.match(options.element("status").textContent, /Save failed: Storage unavailable/);
    assert.equal(options.writes.length, 0);
  } finally { options.dom.window.close(); }
});

test("model options come from the shared catalog and keep the existing default without saving", async () => {
  const options = await createOptions();
  try {
    const ids = Array.from(options.element("model").options).map(option => option.value);
    for (const id of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-5", "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-3.5-turbo"]) assert.ok(ids.includes(id), id);
    assert.equal(ids.length, options.window.ModelConfig.MODELS.length + 1);
    assert.equal(options.element("model").value, options.window.ModelConfig.DEFAULT_MODEL);
    assert.equal(options.element("model").value, "gpt-4o-mini");
    assert.equal(options.element("temperature").value, "0.7");
    assert.equal(options.writes.length, 0);
    assert.equal(options.messages.length, 0);
  } finally { options.dom.window.close(); }
});

test("a saved unknown model ID and its parameter values survive loading and saving", async () => {
  const model = "ft:gpt-4o-mini:team:custom:v1";
  const options = await createOptions({ openaiModel: model, openaiTemperature: 1.2, openaiTopP: 0.35, openaiMaxTokens: 899, openaiPresencePenalty: -0.4, openaiFrequencyPenalty: 0.9 });
  try {
    assert.equal(options.element("model").selectedOptions[0].textContent, "Other model");
    assert.equal(options.element("customModelRow").hidden, false);
    assert.equal(options.element("customModel").value, model);
    assert.equal(options.writes.length, 0);
    await options.window.save();
    assert.equal(options.data.openaiModel, model);
    assert.equal(options.data.openaiTemperature, 1.2);
    assert.equal(options.data.openaiTopP, 0.35);
    assert.equal(options.data.openaiMaxTokens, 899);
    assert.equal(options.data.openaiPresencePenalty, -0.4);
    assert.equal(options.data.openaiFrequencyPenalty, 0.9);
  } finally { options.dom.window.close(); }
});

test("changing model only changes supported controls, preserving values until defaults are explicitly chosen", async () => {
  const options = await createOptions({ openaiTemperature: 1.2, openaiTopP: 0.35, openaiMaxTokens: 899, openaiPresencePenalty: -0.4, openaiFrequencyPenalty: 0.9 });
  try {
    const values = { temperature: "1.2", topP: "0.35", maxTokens: "899", presencePenalty: "-0.4", frequencyPenalty: "0.9" };
    for (const model of options.window.ModelConfig.MODELS) {
      options.changeModel(model.id);
      assert.equal(options.element("customModelRow").hidden, true);
      const profile = options.window.ModelConfig.getProfile(model.id);
      for (const id of ["temperature", "topP", "presencePenalty", "frequencyPenalty"]) assert.equal(options.element(id).disabled, !profile.sampling, `${model.id} ${id}`);
      assert.equal(options.element("maxTokens").disabled, false, model.id);
      for (const [id, value] of Object.entries(values)) assert.equal(options.element(id).value, value);
    }
    options.chooseCustom("unknown-text-model");
    assert.equal(options.element("temperature").disabled, true);
    assert.equal(options.element("maxTokens").disabled, false);
    assert.match(options.element("parameterPolicy").textContent, /omitted/);
    assert.equal(options.writes.length, 0);
    options.changeModel("gpt-4o-mini");
    options.element("useDefaults").click();
    assert.equal(options.element("temperature").value, String(options.window.ModelConfig.getProfile("gpt-4o-mini").defaults.temperature));
    assert.equal(options.element("maxTokens").value, "");
    assert.match(options.element("status").textContent, /Click Save/);
    assert.equal(options.writes.length, 0);
  } finally { options.dom.window.close(); }
});

test("custom model validation rejects empty and malformed IDs before saving or testing", async () => {
  const options = await createOptions({ openaiApiKey: "fake-key" });
  try {
    for (const invalid of ["", " ", "model id", "model\u200Bname"]) {
      options.chooseCustom(invalid);
      await options.window.save();
      assert.match(options.element("status").textContent, /Save failed/);
      assert.equal(options.element("customModel").getAttribute("aria-invalid"), "true");
      await options.window.testModel();
      assert.match(options.element("status").textContent, /Test failed/);
      assert.equal(options.writes.length, 0);
      assert.equal(options.messages.length, 0);
    }
    options.chooseCustom("  my-model-2026-09-01  ");
    await options.window.save();
    assert.equal(options.data.openaiModel, "my-model-2026-09-01");
  } finally { options.dom.window.close(); }
});

test("Test model uses the unsaved key and model, with no email preferences or storage write", async () => {
  const options = await createOptions({ openaiApiKey: "saved-fake-key", openaiModel: "gpt-4o-mini", lastPrompt: "Private instruction", writingPreferences: "Private preferences" });
  try {
    options.element("apiKey").value = "  unsaved-fake-key  ";
    options.chooseCustom("  custom-text-model  ");
    await options.window.testModel();
    assert.deepEqual(options.messages, [{ type: "TEST_MODEL", apiKey: "unsaved-fake-key", model: "custom-text-model" }]);
    assert.equal(options.writes.length, 0);
    assert.equal(options.data.openaiModel, "gpt-4o-mini");
    assert.equal(options.data.openaiApiKey, "saved-fake-key");
    assert.equal(options.element("status").textContent, "custom-text-model responded to the test. Settings were not saved.");
  } finally { options.dom.window.close(); }
});

test("Test model prevents double requests and saving while key and selection are locked", async () => {
  let resolveRequest;
  const request = new Promise(resolve => { resolveRequest = resolve; });
  const options = await createOptions({ openaiApiKey: "fake-key" }, false, { sendMessage: () => request });
  try {
    const pending = options.window.testModel();
    for (const id of ["test", "apiKey", "toggleKey", "model", "customModel", "save", "useDefaults"]) assert.equal(options.element(id).disabled, true, id);
    assert.equal(options.element("maxTokens").disabled, false);
    await options.window.testModel();
    await options.window.save();
    assert.equal(options.messages.length, 1);
    assert.equal(options.writes.length, 0);
    resolveRequest({ ok: true, model: "gpt-4o-mini" });
    await pending;
    for (const id of ["test", "apiKey", "toggleKey", "model", "customModel", "save", "useDefaults"]) assert.equal(options.element(id).disabled, false, id);
  } finally { options.dom.window.close(); }
});

test("Test model reports rejected or thrown errors, unlocks controls and permits retry", async () => {
  for (const sendMessage of [async () => ({ ok: false, error: "Model is unavailable." }), async () => { throw new Error("Request failed."); }]) {
    const options = await createOptions({ openaiApiKey: "fake-key" }, false, { sendMessage });
    try {
      await options.window.testModel();
      assert.match(options.element("status").textContent, /^Test failed:/);
      for (const id of ["test", "apiKey", "model", "save"]) assert.equal(options.element(id).disabled, false);
      assert.equal(options.writes.length, 0);
      await options.window.testModel();
      assert.equal(options.messages.length, 2);
    } finally { options.dom.window.close(); }
  }
});

test("Test model refuses an absent key and does not claim success for a stale selection", async () => {
  const absent = await createOptions();
  try {
    await absent.window.testModel();
    assert.match(absent.element("status").textContent, /Enter an API key/);
    assert.equal(absent.messages.length, 0);
  } finally { absent.dom.window.close(); }
  for (const changedId of ["apiKey", "model"]) {
    let resolveRequest;
    const request = new Promise(resolve => { resolveRequest = resolve; });
    const options = await createOptions({ openaiApiKey: "fake-key" }, false, { sendMessage: () => request });
    try {
      const pending = options.window.testModel();
      options.element(changedId).value = changedId === "model" ? "gpt-6-luna" : "another-fake-key";
      resolveRequest({ ok: true, model: "gpt-4o-mini" });
      await pending;
      assert.match(options.element("status").textContent, /changed.*Test the current selection again/);
      assert.doesNotMatch(options.element("status").textContent, /responded/);
    } finally { options.dom.window.close(); }
  }
});

test("an older Saved status timeout cannot erase an in-flight model test or its result", async () => {
  let resolveRequest;
  const request = new Promise(resolve => { resolveRequest = resolve; });
  const options = await createOptions({ openaiApiKey: "fake-key" }, false, { sendMessage: () => request });
  try {
    await options.window.save();
    const pending = options.window.testModel();
    options.timers[0]();
    assert.match(options.element("status").textContent, /^Testing/);
    resolveRequest({ ok: true, model: "gpt-4o-mini" });
    await pending;
    options.timers[0]();
    assert.match(options.element("status").textContent, /responded/);
  } finally { options.dom.window.close(); }
});

test("Max tokens preserves exponent values and rejects fractional, nonpositive or unsafe limits without rounding", async () => {
  const options = await createOptions();
  try {
    const input = options.element("maxTokens");
    input.value = "1e4";
    input.dispatchEvent(new options.window.Event("blur"));
    assert.equal(input.value, "1e4");
    await options.window.save();
    assert.equal(options.data.openaiMaxTokens, 10000);
    const writes = options.writes.length;
    for (const invalid of ["1.5", "0", "-3", "9007199254740992"]) {
      input.value = invalid;
      input.dispatchEvent(new options.window.Event("blur"));
      assert.equal(input.value, invalid);
      assert.equal(input.classList.contains("invalid"), true);
      await options.window.save();
      assert.match(options.element("status").textContent, /Max tokens must be a positive whole number/);
      assert.equal(options.writes.length, writes);
      assert.equal(options.data.openaiMaxTokens, 10000);
    }
    input.value = "";
    await options.window.save();
    assert.equal(options.data.openaiMaxTokens, null);
    assert.equal(input.classList.contains("invalid"), false);
  } finally { options.dom.window.close(); }
});

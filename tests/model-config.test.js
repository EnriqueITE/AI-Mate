const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const models = require("../model-config.js");
const messages = [{ role: "user", content: "Write a short reply." }];
const configured = {
  openaiTemperature: 0.8,
  openaiTopP: 0.9,
  openaiMaxTokens: 320,
  openaiPresencePenalty: 0.2,
  openaiFrequencyPenalty: 0.1
};

test("the maintained catalog keeps all six existing IDs and adds the three approved models", () => {
  assert.equal(models.DEFAULT_MODEL, "gpt-4o-mini");
  assert.deepEqual(models.MODELS.map((model) => model.id).sort(), [
    "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-5", "gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-3.5-turbo"
  ].sort());
  assert.equal(new Set(models.MODELS.map((model) => model.id)).size, 9);
  assert.ok(models.MODELS.every((model) => model.label && model.description));
});

test("normalization preserves custom IDs and trims only surrounding whitespace", () => {
  for (const id of ["gpt-6.1-sol", "ft:gpt-4.1:my-org:email:abc123", "custom-provider-model/v2", "future-model-2027-01-01", "toString", "__proto__"]) {
    assert.equal(models.normalizeModel(`  ${id}  `), id);
    assert.equal(models.buildPayload({ openaiModel: `  ${id}  ` }, messages).model, id);
  }
});

test("empty, invalid, spaced, and invisible model IDs fail without falling back", () => {
  for (const invalid of [undefined, null, 123, {}, [], "", "   ", "gpt 4o", "gpt\t4o", "gpt-4o\n", "gpt\u00004o", "gpt\u007f4o", "gpt\u200b4o", "gpt\u202e4o", "gpt\u00a04o"]) {
    assert.throws(() => models.normalizeModel(invalid), /model ID/i);
    if (invalid !== undefined) assert.throws(() => models.buildPayload({ openaiModel: invalid }, messages), /model ID/i);
  }
  assert.equal(models.buildPayload({}, messages).model, "gpt-4o-mini");
});

test("profiles preserve legacy defaults and give every custom model independent safe defaults", () => {
  for (const [id, temperature] of [["gpt-4o-mini", 0.4], ["gpt-4o", 0.4], ["gpt-4.1-mini", 0.5], ["gpt-4.1", 0.5], ["gpt-3.5-turbo", 0.7]]) {
    const profile = models.getProfile(id);
    assert.equal(profile.known, true);
    assert.equal(profile.sampling, true);
    assert.deepEqual(profile.defaults, { temperature, topP: 1, maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 });
  }
  for (const id of ["gpt-5", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "my-custom-model"]) {
    const profile = models.getProfile(id);
    assert.equal(profile.id, id);
    assert.equal(profile.sampling, false);
    assert.equal(profile.known, id !== "my-custom-model");
    assert.deepEqual(profile.defaults, { temperature: 1, topP: 1, maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 });
    profile.defaults.temperature = 99;
    assert.equal(models.getProfile(id).defaults.temperature, 1);
  }
});

test("explicitly supported legacy models retain configured sampling values and use the modern token limit", () => {
  for (const id of ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-3.5-turbo"]) {
    assert.deepEqual(models.buildPayload({ ...configured, openaiModel: id }, messages), {
      model: id, messages, temperature: 0.8, top_p: 0.9, presence_penalty: 0.2, frequency_penalty: 0.1, max_completion_tokens: 320
    });
  }
});

test("reasoning, unknown, snapshot, and fine-tuned IDs are preserved without optional sampling parameters", () => {
  for (const id of ["gpt-5", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "gpt-4o-mini-2024-07-18", "gpt-4o-custom", "ft:gpt-4o-mini:org:email:123", "future-model", "toString"]) {
    assert.deepEqual(models.buildPayload({ ...configured, openaiModel: id }, messages), { model: id, messages, max_completion_tokens: 320 });
  }
});

test("sampling is neither invented nor coerced and valid zero values survive", () => {
  assert.deepEqual(models.buildPayload({ openaiModel: "gpt-4o-mini" }, messages), { model: "gpt-4o-mini", messages });
  assert.deepEqual(models.buildPayload({ openaiModel: "gpt-4o-mini", openaiTemperature: 0, openaiTopP: 0, openaiPresencePenalty: 0, openaiFrequencyPenalty: 0 }, messages), {
    model: "gpt-4o-mini", messages, temperature: 0, top_p: 0, presence_penalty: 0, frequency_penalty: 0
  });
  assert.deepEqual(models.buildPayload({ openaiModel: "gpt-4o-mini", openaiTemperature: "0.4", openaiTopP: Infinity, openaiPresencePenalty: NaN, openaiFrequencyPenalty: null }, messages), { model: "gpt-4o-mini", messages });
});

test("token limits are validated for every profile and are never silently dropped or converted", () => {
  for (const id of ["gpt-4o-mini", "gpt-6-astra", "custom-model"]) {
    for (const value of [0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, "128", "", true, {}, []]) {
      assert.throws(() => models.buildPayload({ openaiModel: id, openaiMaxTokens: value }, messages), /Max Tokens must be a positive whole number/);
    }
    for (const value of [1, 64, 2048, Number.MAX_SAFE_INTEGER]) {
      const payload = models.buildPayload({ openaiModel: id, openaiMaxTokens: value }, messages);
      assert.equal(payload.max_completion_tokens, value);
      assert.ok(!Object.hasOwn(payload, "max_tokens"));
    }
    for (const value of [undefined, null]) {
      const payload = models.buildPayload({ openaiModel: id, openaiMaxTokens: value }, messages);
      assert.ok(!Object.hasOwn(payload, "max_completion_tokens"));
      assert.ok(!Object.hasOwn(payload, "max_tokens"));
    }
  }
});

test("payload construction does not mutate preferences or messages and excludes unrelated settings", () => {
  const settings = Object.freeze({ ...configured, openaiModel: "gpt-6-luna", openaiApiKey: "offline-test-placeholder", writingPreferences: "Use concise wording", openaiReasoningEffort: "high" });
  const immutableMessages = Object.freeze([Object.freeze({ role: "user", content: "Test" })]);
  const payload = models.buildPayload(settings, immutableMessages);
  assert.deepEqual(payload, { model: "gpt-6-luna", messages: immutableMessages, max_completion_tokens: 320 });
  assert.equal(settings.openaiTemperature, 0.8);
  assert.equal(immutableMessages[0].content, "Test");
  for (const name of ["openaiApiKey", "writingPreferences", "reasoning_effort", "tools"]) assert.ok(!Object.hasOwn(payload, name));
});

test("the same module works as a browser global without CommonJS or Node APIs", () => {
  const source = fs.readFileSync(require.resolve("../model-config.js"), "utf8");
  const browser = vm.createContext({});
  vm.runInContext(source, browser);
  assert.equal(browser.ModelConfig.DEFAULT_MODEL, models.DEFAULT_MODEL);
  assert.deepEqual(JSON.parse(JSON.stringify(browser.ModelConfig.MODELS)), models.MODELS);
  const payload = browser.ModelConfig.buildPayload({ openaiModel: "gpt-6.1-sol", openaiMaxTokens: 512 }, messages);
  assert.deepEqual(JSON.parse(JSON.stringify(payload)), { model: "gpt-6.1-sol", messages, max_completion_tokens: 512 });
});

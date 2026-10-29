const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { JSDOM } = require("jsdom");
global.DOMParser = new JSDOM("").window.DOMParser;
const core = require("../reply-core.js");
const modelConfig = require("../model-config.js");
const source = fs.readFileSync(require.resolve("../background.js"), "utf8");
const answer = "Hello,\n\nThanks for your message.\n\nBest regards,";
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function harness(options = {}) {
  let messageListener, removedListener;
  const initial = { isPlainText: true, plainTextBody: "", subject: "Test", to: ["Ada <ada@example.test>"], cc: [], ...options.details };
  const tabs = new Map([[42, structuredClone(initial)]]);
  const current = (id) => {
    if (!tabs.has(id)) tabs.set(id, structuredClone(initial));
    return tabs.get(id);
  };
  let getCount = 0;
  const updates = [], payloads = [], requests = [];
  const browser = {
    storage: { local: { get: async (defaults) => ({ ...defaults, openaiApiKey: "offline-test-placeholder", ...options.settings }) } },
    compose: {
      getComposeDetails: async (id) => {
        if (options.beforeGet) await options.beforeGet(++getCount, id);
        return structuredClone(current(id));
      },
      setComposeDetails: async (id, update) => {
        updates.push(structuredClone(update));
        if (options.setError) throw new Error(options.setError);
        let details = { ...current(id), ...update };
        if (options.afterSet) details = options.afterSet(details);
        tabs.set(id, details);
      }
    },
    tabs: { query: async (query) => { if (options.queryTabs) return options.queryTabs(query); return []; }, onRemoved: { addListener: (listener) => { removedListener = listener; } } },
    windows: { getAll: async () => options.windows || [] },
    runtime: { onMessage: { addListener: (listener) => { messageListener = listener; } } }
  };
  const sandbox = vm.createContext({ browser, ReplyCore: core, ModelConfig: modelConfig, crypto, AbortController,
    setTimeout: options.timeout ? (callback) => setTimeout(callback, 1) : setTimeout, clearTimeout,
    console: { warn() {}, error() {} }, fetch: async (_url, request) => {
    requests.push({ url: _url, ...request });
    if (request.body) payloads.push(JSON.parse(request.body));
    if (options.fetch) return options.fetch(request);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) };
  } });
  vm.runInContext(source, sandbox);
  return {
    request: (extra = {}) => new Promise((resolve) => messageListener({ type: "GENERATE_REPLY", tabId: 42, prompt: "Reply in English", ...extra }, {}, resolve)),
    close: (id = 42) => removedListener(id),
    change: (change, id = 42) => { tabs.set(id, { ...current(id), ...change }); },
    details: (id = 42) => structuredClone(current(id)), updates, payloads, requests,
    failWrites: (message = "") => { options.setError = message; }
  };
}

test("generation uses style preference, sends structured context, and replaces its last reply", async () => {
  for (const style of ["natural", "formal", "friendly"]) {
    const app = harness({ settings: { replyStyle: style }, details: { plainTextBody: "Manual\n\n-- \nAda\n\n> Original" } });
    assert.equal((await app.request()).ok, true);
    assert.equal(app.updates.length, 1);
    assert.ok(app.payloads[0].messages[0].content.includes(style === "friendly" ? "friendly" : style));
    const context = JSON.parse(app.payloads[0].messages[1].content.split("Email context (JSON):\n")[1]);
    assert.equal(context.draft, "Manual");
    assert.equal(context.signature, "--\nAda");
    assert.equal(context.quoted, "> Original");
    assert.equal((await app.request()).ok, true);
    assert.equal(app.updates.length, 2);
    assert.equal(app.details().plainTextBody.split(answer).length - 1, 1);
  }
});

test("explicit reply style overrides saved style and unknown styles default naturally", async () => {
  const app = harness({ settings: { replyStyle: "formal" } });
  assert.equal((await app.request({ replyStyle: "friendly" })).ok, true);
  assert.match(app.payloads[0].messages[0].content, /approachable, friendly/);
  assert.equal((await app.request({ replyStyle: "invalid" })).ok, true);
  assert.match(app.payloads[1].messages[0].content, /natural, clear/);
});

test("concurrent requests in one compose tab make only one API request", async () => {
  const pending = deferred(), entered = deferred();
  const app = harness({ fetch: async () => { entered.resolve(); return pending.promise; } });
  const first = app.request();
  await entered.promise;
  const second = await app.request();
  assert.equal(second.ok, false);
  assert.match(second.error, /already being generated/);
  pending.resolve({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) });
  assert.equal((await first).ok, true);
  assert.equal(app.payloads.length, 1);
  assert.equal(app.updates.length, 1);
});

test("locks are per compose tab rather than global", async () => {
  const pending = deferred(), entered = deferred();
  let count = 0;
  const app = harness({ fetch: async () => { if (++count === 2) entered.resolve(); return pending.promise; } });
  const first = app.request();
  const second = app.request({ tabId: 43 });
  await entered.promise;
  pending.resolve({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) });
  const results = await Promise.all([first, second]);
  assert.equal(app.payloads.length, 2);
  assert.ok(results.every((result) => result.ok));
});

test("writing, changing recipients, or switching format during generation preserves the email", async () => {
  for (const change of [{ plainTextBody: "Manual changed while waiting" }, { to: ["new@example.test"] }, { subject: "New subject" }, { isPlainText: false, body: "<p>Changed format</p>" }]) {
    const pending = deferred(), entered = deferred();
    const app = harness({ fetch: async () => { entered.resolve(); return pending.promise; } });
    const request = app.request();
    await entered.promise;
    app.change(change);
    pending.resolve({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) });
    const response = await request;
    assert.equal(response.ok, false);
    assert.match(response.error, /email changed/);
    assert.equal(app.updates.length, 0);
    for (const [key, value] of Object.entries(change)) assert.deepEqual(app.details()[key], value);
  }
});

test("API/network/empty-response failures never write the body and always release the lock", async () => {
  for (const failure of [async () => { throw new Error("Network offline"); }, async () => ({ ok: false, status: 429, text: async () => "Rate limited" }), async () => ({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "   " } }] }) })]) {
    const app = harness({ details: { plainTextBody: "Keep me" }, fetch: failure });
    assert.equal((await app.request()).ok, false);
    assert.equal((await app.request()).ok, false);
    assert.equal(app.payloads.length, 2);
    assert.equal(app.updates.length, 0);
    assert.equal(app.details().plainTextBody, "Keep me");
  }
});

test("compose write failures do not retry with an unsafe fallback", async () => {
  const app = harness({ details: { isPlainText: false, body: '<p>Manual</p><div class="moz-signature">Ada</div>' }, setError: "Compose failure" });
  const response = await app.request();
  assert.equal(response.ok, false);
  assert.match(response.error, /Compose failure/);
  assert.equal(app.updates.length, 1);
  assert.equal(app.details().body, '<p>Manual</p><div class="moz-signature">Ada</div>');
});

test("edited generated blocks abort before the next API call", async () => {
  for (const isPlainText of [true, false]) {
    const app = harness({ details: { isPlainText, body: "" } });
    assert.equal((await app.request()).ok, true);
    const field = isPlainText ? "plainTextBody" : "body";
    app.change({ [field]: app.details()[field].replace("Thanks", "Thank you very much") });
    const response = await app.request();
    assert.equal(response.ok, false);
    assert.match(response.error, /cannot be identified safely/);
    assert.equal(app.payloads.length, 1);
    assert.equal(app.updates.length, 1);
  }
});

test("post-insertion editing is not adopted as a trusted replacement baseline", async () => {
  const app = harness({ details: { isPlainText: false, body: "" }, afterSet: (details) => ({ ...details, body: details.body.replace("Thanks", "Manually changed") }) });
  assert.equal((await app.request()).ok, true);
  assert.equal((await app.request()).ok, false);
  assert.equal(app.updates.length, 1);
  assert.match(app.details().body, /Manually changed/);
});

test("closing a compose tab while generating prevents insertion", async () => {
  const pending = deferred(), entered = deferred();
  const app = harness({ fetch: async () => { entered.resolve(); return pending.promise; } });
  const request = app.request();
  await entered.promise;
  app.close();
  pending.resolve({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) });
  const response = await request;
  assert.equal(response.ok, false);
  assert.match(response.error, /window was closed/);
  assert.equal(app.updates.length, 0);
});

test("closing a compose tab clears its old plain replacement state", async () => {
  const app = harness();
  assert.equal((await app.request()).ok, true);
  app.close();
  app.change({ plainTextBody: "New compose draft" });
  assert.equal((await app.request()).ok, true);
  assert.ok(app.details().plainTextBody.startsWith("New compose draft\n\n"));
});

test("missing API key never sends a request or writes the compose body", async () => {
  const app = harness({ settings: { openaiApiKey: "" } });
  assert.equal((await app.request()).ok, false);
  assert.equal(app.payloads.length, 0);
  assert.equal(app.updates.length, 0);
});

test("length and permanent preferences are passed without migrating the last instruction", async () => {
  const app = harness({ settings: { replyLength: "detailed", writingPreferences: "Avoid jargon.", lastPrompt: "OLD SECRET INSTRUCTION" } });
  assert.equal((await app.request()).ok, true);
  assert.match(JSON.stringify(app.payloads[0].messages), /detailed/i);
  assert.match(JSON.stringify(app.payloads[0].messages), /Avoid jargon\./);
  assert.doesNotMatch(JSON.stringify(app.payloads[0].messages), /OLD SECRET INSTRUCTION/);
  assert.equal((await app.request({ replyLength: "short" })).ok, true);
  assert.match(JSON.stringify(app.payloads[1].messages), /short/i);
});

test("improve includes edited AI text, then undo restores the edited draft exactly", async () => {
  for (const isPlainText of [true, false]) {
    const app = harness({ details: { isPlainText, body: "<p>My notes</p>", plainTextBody: "My notes" } });
    assert.equal((await app.request()).ok, true);
    const field = isPlainText ? "plainTextBody" : "body";
    const edited = app.details()[field].replace("Thanks", "Thank you for the 17 boxes");
    app.change({ [field]: edited });
    assert.equal((await app.request({ operation: "improve" })).ok, true);
    const context = JSON.parse(app.payloads[1].messages[1].content.split("Email context (JSON):\n")[1]);
    assert.match(context.draft, /Thank you for the 17 boxes/);
    assert.match(context.draft, /My notes/);
    assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, true);
    assert.equal(app.details()[field], edited);
    // Restoring an edited older reply does not make it safe to regenerate.
    assert.equal((await app.request()).ok, false);
  }
});

test("empty and complex drafts are disabled and never sent to the API", async () => {
  for (const details of [
    { isPlainText: true, plainTextBody: "" },
    { isPlainText: false, body: '<div class="moz-signature">Signature only</div>' },
    { isPlainText: false, body: "<p>Notes</p><table><tr><td>Data</td></tr></table>" },
    { isPlainText: false, body: "<p>Notes</p><img src='cid:test'>" },
    { isPlainText: false, body: "<p>Notes</p><blockquote>Question</blockquote><p>Inline answer</p>" }
  ]) {
    const app = harness({ details });
    const state = await app.request({ type: "GET_COMPOSE_ACTION_STATE" });
    assert.equal(state.ok, true);
    assert.equal(state.canImprove, false);
    assert.ok(state.improveReason);
    assert.equal((await app.request({ operation: "improve" })).ok, false);
    assert.equal(app.payloads.length, 0);
    assert.equal(app.updates.length, 0);
  }
});

test("losing a draft link aborts improvement before writing", async () => {
  const app = harness({ details: { isPlainText: false, body: '<p>Read <a href="https://example.test/source?q=7">these notes</a></p>' } });
  const result = await app.request({ operation: "improve" });
  assert.equal(result.ok, false);
  assert.match(result.error, /link|URL/i);
  assert.equal(app.payloads.length, 1);
  assert.equal(app.updates.length, 0);
});

test("undo is one level, preserves outside edits, and restores regeneration tracking", async () => {
  const app = harness({ details: { plainTextBody: "Manual" } });
  assert.equal((await app.request()).ok, true);
  const first = app.details().plainTextBody;
  assert.equal((await app.request()).ok, true);
  app.change({ plainTextBody: "Later outside edit\n\n" + app.details().plainTextBody });
  assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, true);
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, true);
  assert.equal(app.details().plainTextBody, "Later outside edit\n\n" + first);
  const state = await app.request({ type: "GET_COMPOSE_ACTION_STATE" });
  assert.equal(state.canUndo, false);
  assert.ok(state.undoReason);
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, false);
  assert.equal((await app.request()).ok, true);
  assert.equal(app.details().plainTextBody.split(answer).length - 1, 1);
});

test("undo does not need an API key and refuses edited, missing, and changed-format results", async () => {
  for (const change of [
    (value) => ({ plainTextBody: value.replace("Thanks", "Edited") }),
    () => ({ plainTextBody: "Result removed" }),
    () => ({ isPlainText: false, body: "<p>Switched format</p>" })
  ]) {
    const settings = { openaiApiKey: "fake" };
    const app = harness({ settings });
    assert.equal((await app.request()).ok, true);
    settings.openaiApiKey = "";
    const patch = change(app.details().plainTextBody);
    app.change(patch);
    assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, false);
    assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, false);
    assert.equal(app.updates.length, 1);
    for (const [key, value] of Object.entries(patch)) assert.equal(app.details()[key], value);
  }
  const settings = { openaiApiKey: "fake" }, app = harness({ settings });
  assert.equal((await app.request()).ok, true);
  settings.openaiApiKey = "";
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, true);
  assert.equal(app.details().plainTextBody, "");
  assert.equal(app.payloads.length, 1);
});

test("failed writes and API failures preserve the previous undo slot", async () => {
  let failApi = false;
  const app = harness({ fetch: async () => {
    if (failApi) throw new Error("Network down");
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) };
  } });
  assert.equal((await app.request()).ok, true);
  failApi = true;
  assert.equal((await app.request()).ok, false);
  failApi = false;
  app.failWrites("Write failed");
  assert.equal((await app.request()).ok, false);
  assert.equal((await app.request({ operation: "improve" })).ok, false);
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, false);
  app.failWrites();
  assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, true);
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, true);
  assert.equal(app.details().plainTextBody, "");
});

test("generate, improve, and undo share the lock and action state reports why", async () => {
  const pending = deferred(), entered = deferred();
  const app = harness({ details: { plainTextBody: "Notes" }, fetch: async () => { entered.resolve(); return pending.promise; } });
  const first = app.request({ operation: "improve" });
  await entered.promise;
  for (const extra of [{}, { operation: "improve" }, { type: "UNDO_LAST_REPLY" }]) {
    const result = await app.request(extra);
    assert.equal(result.ok, false);
    assert.match(result.error, /in progress|already/);
  }
  const state = await app.request({ type: "GET_COMPOSE_ACTION_STATE" });
  assert.equal(state.busy, true);
  assert.equal(state.canImprove, false);
  assert.equal(state.canUndo, false);
  pending.resolve({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) });
  assert.equal((await first).ok, true);
  assert.equal(app.payloads.length, 1);
});

test("improvement and undo recheck the editor before writing", async () => {
  const pending = deferred(), entered = deferred();
  const app = harness({ details: { plainTextBody: "Notes" }, fetch: async () => { entered.resolve(); return pending.promise; } });
  const first = app.request({ operation: "improve" });
  await entered.promise;
  app.change({ plainTextBody: "Typed during improvement" });
  pending.resolve({ ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) });
  assert.equal((await first).ok, false);
  assert.equal(app.updates.length, 0);
  let undoCheck = false;
  const app2 = harness({ beforeGet: async (count) => { if (undoCheck && count === 4) app2.change({ plainTextBody: app2.details().plainTextBody + "\n\nConcurrent edit" }); } });
  assert.equal((await app2.request()).ok, true);
  undoCheck = true;
  const result = await app2.request({ type: "UNDO_LAST_REPLY" });
  assert.equal(result.ok, false);
  assert.match(result.error, /email changed/);
  assert.equal(app2.updates.length, 1);
  assert.match(app2.details().plainTextBody, /Concurrent edit/);
});

test("closing a window clears its undo while other windows remain independent", async () => {
  const app = harness();
  assert.equal((await app.request()).ok, true);
  assert.equal((await app.request({ tabId: 43, operation: "generate" })).ok, true);
  app.close(42);
  assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, false);
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, false);
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY", tabId: 43 })).ok, true);
  assert.equal(app.details(43).plainTextBody, "");
  assert.equal(app.details(42).plainTextBody, answer);
});

test("invalid operations fail without calling the API or touching the body", async () => {
  const app = harness();
  assert.equal((await app.request({ operation: "delete" })).ok, false);
  assert.equal(app.payloads.length, 0);
  assert.equal(app.updates.length, 0);
});

test("a legacy message without a tab ID targets only the focused compose window", async () => {
  const app = harness({ windows: [
    { type: "messageCompose", focused: false, tabs: [{ id: 42, active: true }] },
    { type: "messageCompose", focused: true, tabs: [{ id: 43, active: true }] }
  ] });
  assert.equal((await app.request({ tabId: undefined })).ok, true);
  assert.equal(app.details(42).plainTextBody, "");
  assert.equal(app.details(43).plainTextBody, answer);
  const noFocused = harness({ windows: [ { type: "messageCompose", focused: false, tabs: [{ id: 42, active: true }] } ], queryTabs: async query => {
    assert.equal(query.currentWindow, true);
    assert.equal(query.active, true);
    return [{ id: 90, type: "mail", active: true }];
  } });
  assert.equal((await noFocused.request({ tabId: undefined })).ok, false);
  assert.equal(noFocused.updates.length, 0);
});

test("truncated or filtered model output never replaces content or consumes an older undo", async () => {
  for (const finishReason of ["length", "content_filter", "tool_calls"]) {
    for (const operation of ["generate", "improve"]) {
      let partial = false;
      const app = harness({ details: { plainTextBody: "Original notes: preserve all facts." }, fetch: async () => ({
        ok: true, json: async () => ({ choices: [{ finish_reason: partial ? finishReason : "stop", message: { content: partial ? "Hello,\n\nOnly the first" : answer } }] })
      }) });
      assert.equal((await app.request()).ok, true);
      const before = app.details().plainTextBody;
      partial = true;
      const response = await app.request({ operation });
      assert.equal(response.ok, false);
      assert.match(response.error, /finishing|complete reply/);
      assert.equal(app.updates.length, 1);
      assert.equal(app.details().plainTextBody, before);
      assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, true);
      assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, true);
      assert.equal(app.details().plainTextBody, "Original notes: preserve all facts.");
    }
  }
});

test("generate, improve and summaries share model compatibility and saved parameters", async () => {
  for (const model of ["gpt-4o-mini", "gpt-4.1", "gpt-5", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "ft:future-model:my-project:custom"]) {
    const app = harness({ settings: {
      openaiModel: model, openaiTemperature: 0.3, openaiTopP: 0.9, openaiMaxTokens: 1024,
      openaiPresencePenalty: 0.2, openaiFrequencyPenalty: -0.2
    }, details: { plainTextBody: "My notes to keep." } });
    for (const message of [{}, { operation: "improve" }, { type: "SUMMARIZE_EMAIL" }]) {
      assert.equal((await app.request(message)).ok, true, model);
    }
    const configs = app.payloads.map(({ messages, ...config }) => config);
    assert.deepEqual(configs[0], configs[1]);
    assert.deepEqual(configs[0], configs[2]);
    assert.equal(configs[0].model, model);
    assert.equal(configs[0].max_completion_tokens, 1024);
    assert.equal("max_tokens" in configs[0], false);
    assert.equal("temperature" in configs[0], ["gpt-4o-mini", "gpt-4.1"].includes(model));
    if ("temperature" in configs[0]) assert.equal(configs[0].temperature, 0.3);
    assert.equal(app.updates.length, 2, "Summaries must not edit the draft");
  }
});

test("invalid model or token limits fail all operations before the API and preserve content", async () => {
  for (const settings of [{ openaiModel: "" }, { openaiMaxTokens: -3 }, { openaiMaxTokens: 2.5 }]) {
    const app = harness({ settings, details: { plainTextBody: "Keep my draft" } });
    for (const message of [{}, { operation: "improve" }, { type: "SUMMARIZE_EMAIL" }]) {
      assert.equal((await app.request(message)).ok, false);
    }
    assert.equal(app.requests.length, 0);
    assert.equal(app.updates.length, 0);
  }
});

test("unsupported parameters fail without silent retries, changing models or dropping a limit", async () => {
  for (const code of ["unsupported_value", "unsupported_parameter"]) {
    const app = harness({ settings: { openaiModel: "custom-model", openaiMaxTokens: 500 }, fetch: async () => ({
      ok: false, status: 400, json: async () => ({ error: { code, param: "max_completion_tokens" } })
    }) });
    const result = await app.request();
    assert.equal(result.ok, false);
    assert.match(result.error, /max_completion_tokens/);
    assert.equal(app.payloads.length, 1);
    assert.equal(app.payloads[0].model, "custom-model");
    assert.equal(app.payloads[0].max_completion_tokens, 500);
    assert.equal(app.updates.length, 0);
  }
});

test("model access, authentication and quota errors are actionable and do not echo provider bodies", async () => {
  const cases = [
    [401, "invalid_api_key", /API key/], [403, "permission_denied", /permissions/],
    [404, "model_not_found", /not available/], [429, "insufficient_quota", /credits/],
    [429, "rate_limit_exceeded", /rate limiting/], [503, "server_error", /temporarily unavailable/],
    [400, "context_length_exceeded", /context limit/], [400, "other", /Chat Completions/]
  ];
  for (const [status, code, expected] of cases) {
    const app = harness({ fetch: async () => ({ ok: false, status, json: async () => ({ error: {
      code, message: "Sensitive draft text and secret credentials", param: "Sensitive draft text and secret credentials"
    } }) }) });
    const result = await app.request({ type: "TEST_MODEL", apiKey: "offline-test-key", model: "gpt-6-luna" });
    assert.equal(result.ok, false);
    assert.match(result.error, expected);
    assert.doesNotMatch(result.error, /Sensitive|secret credentials|offline-test-key/);
    assert.equal(app.requests.length, 1);
    assert.equal(app.updates.length, 0);
  }
});

test("Test model uses unsaved inputs and a bounded fixed prompt, without any email or preferences", async () => {
  for (const model of ["gpt-4o-mini", "gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "custom-unlisted-model"]) {
    const app = harness({ settings: {
      openaiApiKey: "stored-key-do-not-use", openaiModel: "stored-model-do-not-use",
      lastPrompt: "PRIVATE PROMPT", writingPreferences: "PRIVATE RULES", openaiMaxTokens: 90000
    }, details: { plainTextBody: "PRIVATE BODY", subject: "PRIVATE SUBJECT", to: ["private@example.test"] } });
    const before = app.details();
    const result = await app.request({ type: "TEST_MODEL", apiKey: "unsaved-offline-key", model });
    assert.equal(result.ok, true);
    assert.equal(result.model, model);
    assert.equal(app.requests[0].url, "https://api.openai.com/v1/chat/completions");
    assert.equal(app.requests[0].headers.Authorization, "Bearer unsaved-offline-key");
    assert.deepEqual(app.payloads[0], {
      model, max_completion_tokens: model === "gpt-4o-mini" ? 64 : 2048,
      messages: [{ role: "user", content: "Reply with exactly: OK" }]
    });
    assert.deepEqual(app.details(), before);
    assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, false);
    assert.equal(app.updates.length, 0);
  }
});

test("empty Test model inputs never fall back to stored keys or models", async () => {
  const app = harness();
  for (const values of [{ apiKey: "", model: "gpt-6-luna" }, { apiKey: "fake", model: "" }, { apiKey: "fake", model: "gpt 6" }, {}]) {
    assert.equal((await app.request({ type: "TEST_MODEL", ...values })).ok, false);
  }
  assert.equal(app.requests.length, 0);
});

test("concurrent model tests make one request and release the test lock after failure", async () => {
  const pending = deferred(), entered = deferred();
  let fail = true;
  const app = harness({ fetch: async () => {
    if (fail) { entered.resolve(); return pending.promise; }
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "OK" } }] }) };
  } });
  const message = { type: "TEST_MODEL", apiKey: "fake", model: "gpt-6-luna" };
  const first = app.request(message);
  await entered.promise;
  const second = await app.request(message);
  assert.equal(second.ok, false);
  assert.match(second.error, /already in progress/);
  pending.reject(new Error("Network offline"));
  assert.equal((await first).ok, false);
  assert.equal(app.requests.length, 1);
  fail = false;
  assert.equal((await app.request(message)).ok, true);
  assert.equal(app.requests.length, 2);
});

test("successful and failed model tests preserve the previous compose undo", async () => {
  let failure = false;
  const app = harness({ fetch: async () => {
    if (failure) throw new Error("Offline");
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: answer } }] }) };
  } });
  assert.equal((await app.request()).ok, true);
  const message = { type: "TEST_MODEL", apiKey: "fake", model: "gpt-6-luna" };
  assert.equal((await app.request(message)).ok, true);
  failure = true;
  assert.equal((await app.request(message)).ok, false);
  assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, true);
  assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, true);
  assert.equal(app.details().plainTextBody, "");
});

test("partial, refused, malformed and non-text responses fail summaries and model tests", async () => {
  for (const data of [
    { choices: [{ finish_reason: "length", message: { content: "Partial" } }] },
    { choices: [{ finish_reason: "content_filter", message: { content: "Filtered" } }] },
    { choices: [{ finish_reason: "stop", message: { content: "Refusal", refusal: "Cannot comply" } }] },
    { choices: [{ finish_reason: "stop", message: { content: [] } }] }, { choices: [] }, null
  ]) {
    const app = harness({ details: { plainTextBody: "Notes" }, fetch: async () => ({ ok: true, json: async () => data }) });
    for (const message of [{ type: "SUMMARIZE_EMAIL" }, { type: "TEST_MODEL", apiKey: "fake", model: "gpt-6-luna" }]) {
      const result = await app.request(message);
      assert.equal(result.ok, false);
      assert.equal(result.summary, undefined);
    }
    assert.equal(app.updates.length, 0);
  }
});

test("timed out requests abort, release locks and preserve the editor", async () => {
  const app = harness({ timeout: true, details: { plainTextBody: "Keep notes" }, fetch: request => new Promise((_, reject) => {
    request.signal.addEventListener("abort", () => reject(new Error("Aborted")));
  }) });
  for (const message of [{}, { type: "TEST_MODEL", apiKey: "fake", model: "gpt-6-luna" }]) {
    assert.match((await app.request(message)).error, /timed out/);
    assert.match((await app.request(message)).error, /timed out/);
  }
  assert.equal(app.updates.length, 0);
  assert.equal(app.details().plainTextBody, "Keep notes");
});

test("legacy API-key tests still work without performing inference", async () => {
  const app = harness();
  assert.equal((await app.request({ type: "TEST_API_KEY", apiKey: "legacy-offline-key" })).ok, true);
  assert.equal(app.requests[0].url, "https://api.openai.com/v1/models");
  assert.equal(app.payloads.length, 0);
});

test("missing completion status cannot approve a test, summary or draft change", async () => {
  for (const finishReason of [undefined, null, ""]) {
    let malformed = false;
    const app = harness({ details: { plainTextBody: "Original notes" }, fetch: async () => ({
      ok: true, json: async () => ({ choices: [{
        finish_reason: malformed ? finishReason : "stop", message: { content: answer }
      }] })
    }) });
    assert.equal((await app.request()).ok, true);
    const before = app.details();
    malformed = true;
    for (const message of [{}, { operation: "improve" }, { type: "SUMMARIZE_EMAIL" }, { type: "TEST_MODEL", apiKey: "fake", model: "gpt-6-luna" }]) {
      const result = await app.request(message);
      assert.equal(result.ok, false);
      assert.match(result.error, /complete/);
    }
    assert.deepEqual(app.details(), before);
    assert.equal(app.updates.length, 1);
    assert.equal((await app.request({ type: "GET_COMPOSE_ACTION_STATE" })).canUndo, true);
    assert.equal((await app.request({ type: "UNDO_LAST_REPLY" })).ok, true);
    assert.equal(app.details().plainTextBody, "Original notes");
  }
});

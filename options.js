// Options page logic (root) with robust API access
const api = typeof browser !== 'undefined' ? browser : (typeof messenger !== 'undefined' ? messenger : null);

async function load() {
  if (!api) return;
  const { openaiApiKey, openaiModel, lastPrompt, openaiTemperature, openaiTopP, openaiMaxTokens, openaiPresencePenalty, openaiFrequencyPenalty } = await api.storage.local.get({
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    lastPrompt: "",
    openaiTemperature: 0.7,
    openaiTopP: 1,
    openaiMaxTokens: null,
    openaiPresencePenalty: 0,
    openaiFrequencyPenalty: 0
  });
  document.getElementById("apiKey").value = openaiApiKey || "";
  document.getElementById("model").value = openaiModel || "gpt-4o-mini";
  document.getElementById("defaultPrompt").value = lastPrompt || "";
  document.getElementById("temperature").value = (openaiTemperature ?? 0.7);
  document.getElementById("topP").value = (openaiTopP ?? 1);
  document.getElementById("maxTokens").value = (openaiMaxTokens ?? "");
  document.getElementById("presencePenalty").value = (openaiPresencePenalty ?? 0);
  document.getElementById("frequencyPenalty").value = (openaiFrequencyPenalty ?? 0);

  toggleAdvancedForModel(document.getElementById("model").value);
}

async function save() {
  const status = document.getElementById("status");
  const apiKey = document.getElementById("apiKey").value.trim();
  const model = document.getElementById("model").value;
  const lastPrompt = document.getElementById("defaultPrompt").value;
  const temperature = parseFloat(document.getElementById("temperature").value);
  const topP = parseFloat(document.getElementById("topP").value);
  const maxTokensRaw = document.getElementById("maxTokens").value;
  const presencePenalty = parseFloat(document.getElementById("presencePenalty").value);
  const frequencyPenalty = parseFloat(document.getElementById("frequencyPenalty").value);
  const maxTokens = maxTokensRaw === "" ? null : parseInt(maxTokensRaw, 10);
  try {
    await api.storage.local.set({
      openaiApiKey: apiKey,
      openaiModel: model,
      lastPrompt,
      openaiTemperature: isFinite(temperature) ? temperature : 0.7,
      openaiTopP: isFinite(topP) ? topP : 1,
      openaiMaxTokens: (maxTokens !== null && isFinite(maxTokens)) ? maxTokens : null,
      openaiPresencePenalty: isFinite(presencePenalty) ? presencePenalty : 0,
      openaiFrequencyPenalty: isFinite(frequencyPenalty) ? frequencyPenalty : 0
    });
    status.textContent = "Saved.";
  } catch (e) {
    status.textContent = `Save failed: ${e?.message || e}`;
  }
  setTimeout(() => (status.textContent = ""), 1500);
}

function toggleAdvancedForModel(model) {
  const advancedIds = ["temperature","topP","maxTokens","presencePenalty","frequencyPenalty"];
  const disable = /(^|\b)gpt-5(\b|$)/i.test(model);
  for (const id of advancedIds) {
    const el = document.getElementById(id);
    if (el) el.disabled = disable;
  }
}

function attachValidation(id, { min = null, max = null, integer = false } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const clamp = () => {
    if (el.value === "") { el.classList.remove("invalid"); return; }
    let v = integer ? parseInt(el.value, 10) : parseFloat(el.value);
    if (!Number.isFinite(v)) { el.classList.add("invalid"); return; }
    if (min !== null && v < min) v = min;
    if (max !== null && v > max) v = max;
    el.value = integer ? String(Math.round(v)) : String(v);
    el.classList.remove("invalid");
  };
  el.addEventListener("blur", clamp);
  el.addEventListener("input", () => {
    if (el.value === "") { el.classList.remove("invalid"); return; }
    let v = integer ? parseInt(el.value, 10) : parseFloat(el.value);
    const bad = !Number.isFinite(v) || (min !== null && v < min) || (max !== null && v > max);
    el.classList.toggle("invalid", bad);
  });
}

const MODEL_DEFAULTS = {
  "gpt-5":            { temperature: 1,   topP: 1,   maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 },
  "gpt-4o-mini":      { temperature: 0.4, topP: 1,   maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 },
  "gpt-4o":           { temperature: 0.4, topP: 1,   maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 },
  "gpt-4.1-mini":     { temperature: 0.5, topP: 1,   maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 },
  "gpt-4.1":          { temperature: 0.5, topP: 1,   maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 },
  "gpt-3.5-turbo":    { temperature: 0.7, topP: 1,   maxTokens: null, presencePenalty: 0, frequencyPenalty: 0 }
};

function applyModelDefaults(model) {
  const m = MODEL_DEFAULTS[model];
  if (!m) return;
  document.getElementById("temperature").value = m.temperature;
  document.getElementById("topP").value = m.topP;
  document.getElementById("maxTokens").value = m.maxTokens ?? "";
  document.getElementById("presencePenalty").value = m.presencePenalty;
  document.getElementById("frequencyPenalty").value = m.frequencyPenalty;
}

document.addEventListener("DOMContentLoaded", () => {
  load();
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("toggleKey").addEventListener("click", () => {
    const input = document.getElementById("apiKey");
    const btn = document.getElementById("toggleKey");
    if (input.type === "password") { input.type = "text"; btn.textContent = "Hide"; }
    else { input.type = "password"; btn.textContent = "Show"; }
  });
  document.getElementById("test").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "Testing...";
    try {
      const apiKey = document.getElementById("apiKey").value.trim();
      const res = await api.runtime.sendMessage({ type: "TEST_API_KEY", apiKey });
      if (res && res.ok) {
        status.textContent = "API key OK.";
      } else {
        status.textContent = `Test failed: ${res?.error || "Unknown error"}`;
      }
    } catch (e) {
      status.textContent = `Test failed: ${e?.message || e}`;
    }
  });
  document.getElementById("model").addEventListener("change", (e) => {
    toggleAdvancedForModel(e.target.value);
  });
  document.getElementById("useDefaults").addEventListener("click", () => {
    const model = document.getElementById("model").value;
    applyModelDefaults(model);
    const status = document.getElementById("status");
    if (status) {
      status.textContent = "Defaults applied. Click Save to persist.";
      setTimeout(() => { if (status.textContent.startsWith("Defaults applied")) status.textContent = ""; }, 2500);
    }
  });

  // Field validations
  attachValidation("temperature", { min: 0, max: 2, integer: false });
  attachValidation("topP", { min: 0, max: 1, integer: false });
  attachValidation("maxTokens", { min: 1, max: null, integer: true });
  attachValidation("presencePenalty", { min: -2, max: 2, integer: false });
  attachValidation("frequencyPenalty", { min: -2, max: 2, integer: false });
});

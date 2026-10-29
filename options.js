// Options page logic (root) with robust API access
const api = typeof browser !== 'undefined' ? browser : (typeof messenger !== 'undefined' ? messenger : null);
const CUSTOM_MODEL = "__custom__";
let testInProgress = false;
let optionsReady = null;
let statusRevision = 0;

function setOptionsStatus(message, clearAfter = 0) {
  const status = document.getElementById("status");
  const revision = ++statusRevision;
  status.textContent = message;
  if (clearAfter) setTimeout(() => {
    if (revision === statusRevision) status.textContent = "";
  }, clearAfter);
}

function populateModels() {
  const select = document.getElementById("model");
  select.replaceChildren();
  for (const model of ModelConfig.MODELS) {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = model.label;
    select.appendChild(option);
  }
  const custom = document.createElement("option");
  custom.value = CUSTOM_MODEL;
  custom.textContent = "Other model";
  select.appendChild(custom);
}

function selectedModelValue() {
  const selected = document.getElementById("model").value;
  return selected === CUSTOM_MODEL ? document.getElementById("customModel").value : selected;
}

function readSelectedModel() {
  return ModelConfig.normalizeModel(selectedModelValue());
}

function showModelValidation(message = "") {
  const input = document.getElementById("customModel");
  input.classList.toggle("invalid", !!message);
  input.setAttribute("aria-invalid", message ? "true" : "false");
  document.getElementById("modelValidation").textContent = message;
}

function updateModelUi() {
  const custom = document.getElementById("model").value === CUSTOM_MODEL;
  document.getElementById("customModelRow").hidden = !custom;
  const raw = selectedModelValue();
  const model = ModelConfig.MODELS.find((entry) => entry.id === raw);
  document.getElementById("modelDescription").textContent = model?.description || "Enter the exact OpenAI model ID. Availability depends on your account; use Test model to check access.";
  toggleAdvancedForModel(raw);
  showModelValidation();
}

async function load() {
  if (!api) return;
  const { openaiApiKey, openaiModel, lastPrompt, writingPreferences, summaryLanguage, summaryStyle, openaiTemperature, openaiTopP, openaiMaxTokens, openaiPresencePenalty, openaiFrequencyPenalty, enableReaderSummaries, autoSummariesOnOpen } = await api.storage.local.get({
    openaiApiKey: "",
    openaiModel: ModelConfig.DEFAULT_MODEL,
    lastPrompt: "",
    writingPreferences: "",
    summaryLanguage: "auto",
    summaryStyle: "balanced",
    openaiTemperature: 0.7,
    openaiTopP: 1,
    openaiMaxTokens: null,
    openaiPresencePenalty: 0,
    openaiFrequencyPenalty: 0,
    enableReaderSummaries: false,
    autoSummariesOnOpen: false
  });
  populateModels();
  document.getElementById("apiKey").value = openaiApiKey || "";
  const savedModel = typeof openaiModel === "string" ? openaiModel : "";
  const listedModel = ModelConfig.MODELS.find((entry) => entry.id === savedModel.trim());
  document.getElementById("model").value = listedModel ? listedModel.id : CUSTOM_MODEL;
  document.getElementById("customModel").value = listedModel ? "" : savedModel;
  document.getElementById("defaultPrompt").value = lastPrompt || "";
  document.getElementById("writingPreferences").value = typeof writingPreferences === "string" ? writingPreferences : "";
  const langEl = document.getElementById("summaryLanguage");
  if (langEl) langEl.value = (summaryLanguage || "auto");
  const styleEl = document.getElementById("summaryStyle");
  if (styleEl) styleEl.value = (summaryStyle || "balanced");
  document.getElementById("temperature").value = (openaiTemperature ?? 0.7);
  document.getElementById("topP").value = (openaiTopP ?? 1);
  document.getElementById("maxTokens").value = (openaiMaxTokens ?? "");
  document.getElementById("presencePenalty").value = (openaiPresencePenalty ?? 0);
  document.getElementById("frequencyPenalty").value = (openaiFrequencyPenalty ?? 0);
  const readerToggle = document.getElementById("enableReaderSummaries");
  if (readerToggle) readerToggle.checked = !!enableReaderSummaries;
  const autoToggle = document.getElementById("autoSummariesOnOpen");
  if (autoToggle) autoToggle.checked = !!enableReaderSummaries && !!autoSummariesOnOpen;
  syncReaderSummaryOptions(!!enableReaderSummaries);

  updateModelUi();
}

async function save() {
  if (testInProgress) return;
  const apiKey = document.getElementById("apiKey").value.trim();
  let model;
  try {
    model = readSelectedModel();
    showModelValidation();
  } catch (error) {
    showModelValidation(String(error.message || error));
    setOptionsStatus(`Save failed: ${error.message || error}`);
    return;
  }
  const lastPrompt = document.getElementById("defaultPrompt").value;
  const writingPreferences = document.getElementById("writingPreferences").value;
  const temperature = parseFloat(document.getElementById("temperature").value);
  const topP = parseFloat(document.getElementById("topP").value);
  const maxTokensInput = document.getElementById("maxTokens");
  const maxTokensRaw = maxTokensInput.value.trim();
  const presencePenalty = parseFloat(document.getElementById("presencePenalty").value);
  const frequencyPenalty = parseFloat(document.getElementById("frequencyPenalty").value);
  const maxTokens = maxTokensRaw === "" ? null : Number(maxTokensRaw);
  if (maxTokensInput.validity.badInput || (maxTokens !== null && (!Number.isSafeInteger(maxTokens) || maxTokens <= 0))) {
    maxTokensInput.classList.add("invalid");
    setOptionsStatus("Save failed: Max tokens must be a positive whole number within the safe integer range, or left blank.");
    return;
  }
  maxTokensInput.classList.remove("invalid");
  const enableReaderSummaries = !!(document.getElementById("enableReaderSummaries") && document.getElementById("enableReaderSummaries").checked);
  const autoSummariesOnOpen = enableReaderSummaries && !!(document.getElementById("autoSummariesOnOpen") && document.getElementById("autoSummariesOnOpen").checked);
  try {
    await api.storage.local.set({
      openaiApiKey: apiKey,
      openaiModel: model,
      lastPrompt,
      writingPreferences,
      summaryLanguage: (document.getElementById("summaryLanguage") && document.getElementById("summaryLanguage").value) || "auto",
      summaryStyle: (document.getElementById("summaryStyle") && document.getElementById("summaryStyle").value) || "balanced",
      openaiTemperature: isFinite(temperature) ? temperature : 0.7,
      openaiTopP: isFinite(topP) ? topP : 1,
      openaiMaxTokens: maxTokens,
      openaiPresencePenalty: isFinite(presencePenalty) ? presencePenalty : 0,
      openaiFrequencyPenalty: isFinite(frequencyPenalty) ? frequencyPenalty : 0,
      enableReaderSummaries,
      autoSummariesOnOpen
    });
    setOptionsStatus("Saved.", 1500);
  } catch (e) {
    setOptionsStatus(`Save failed: ${e?.message || e}`);
  }
}

function toggleAdvancedForModel(model) {
  const advancedIds = ["temperature", "topP", "presencePenalty", "frequencyPenalty"];
  let sampling = false;
  try { sampling = ModelConfig.getProfile(ModelConfig.normalizeModel(model)).sampling; } catch {}
  for (const id of advancedIds) {
    const el = document.getElementById(id);
    if (el) el.disabled = !sampling;
  }
  document.getElementById("maxTokens").disabled = false;
  document.getElementById("parameterPolicy").textContent = sampling
    ? "Sampling controls are available for this model. Changing the model keeps your saved values; Use model defaults only changes them when you click it."
    : "Temperature, Top P and penalty settings are omitted for this model. Their saved values are kept. Max tokens remains available.";
}

function syncReaderSummaryOptions(enabled) {
  const autoToggle = document.getElementById("autoSummariesOnOpen");
  if (!autoToggle) return;
  autoToggle.disabled = !enabled;
  if (!enabled) {
    autoToggle.checked = false;
  }
}

function attachValidation(id, { min = null, max = null, integer = false } = {}) {
  const el = document.getElementById(id);
  if (!el) return;
  const clamp = () => {
    if (el.value === "") { el.classList.remove("invalid"); return; }
    let v = Number(el.value);
    if (integer) {
      el.classList.toggle("invalid", !Number.isSafeInteger(v) || (min !== null && v < min) || (max !== null && v > max));
      return;
    }
    if (!Number.isFinite(v)) { el.classList.add("invalid"); return; }
    if (min !== null && v < min) v = min;
    if (max !== null && v > max) v = max;
    el.value = String(v);
    el.classList.remove("invalid");
  };
  el.addEventListener("blur", clamp);
  el.addEventListener("input", () => {
    if (el.value === "") { el.classList.remove("invalid"); return; }
    let v = Number(el.value);
    const bad = !Number.isFinite(v) || (integer && !Number.isSafeInteger(v)) || (min !== null && v < min) || (max !== null && v > max);
    el.classList.toggle("invalid", bad);
  });
}

function applyModelDefaults(model) {
  const m = ModelConfig.getProfile(ModelConfig.normalizeModel(model)).defaults;
  document.getElementById("temperature").value = m.temperature;
  document.getElementById("topP").value = m.topP;
  document.getElementById("maxTokens").value = m.maxTokens ?? "";
  document.getElementById("presencePenalty").value = m.presencePenalty;
  document.getElementById("frequencyPenalty").value = m.frequencyPenalty;
}

function lockModelTest(locked) {
  for (const id of ["test", "apiKey", "toggleKey", "model", "customModel", "save", "useDefaults"]) {
    document.getElementById(id).disabled = locked;
  }
}

async function testModel() {
  if (testInProgress) return;
  let model;
  try {
    model = readSelectedModel();
    showModelValidation();
  } catch (error) {
    showModelValidation(String(error.message || error));
    setOptionsStatus(`Test failed: ${error.message || error}`);
    return;
  }
  const apiKey = document.getElementById("apiKey").value.trim();
  if (!apiKey) {
    setOptionsStatus("Enter an API key to test the selected model.");
    return;
  }
  testInProgress = true;
  lockModelTest(true);
  setOptionsStatus(`Testing ${model}...`);
  const sameSelection = () => {
    try { return readSelectedModel() === model && document.getElementById("apiKey").value.trim() === apiKey; }
    catch { return false; }
  };
  try {
    const result = await api.runtime.sendMessage({ type: "TEST_MODEL", apiKey, model });
    if (!sameSelection()) {
      setOptionsStatus("The model or API key changed. Test the current selection again.");
    } else if (result?.ok) {
      setOptionsStatus(`${result.model || model} responded to the test. Settings were not saved.`);
    } else {
      setOptionsStatus(`Test failed: ${result?.error || "Unknown error"}`);
    }
  } catch (error) {
    setOptionsStatus(sameSelection() ? `Test failed: ${error.message || error}` : "The model or API key changed. Test the current selection again.");
  } finally {
    testInProgress = false;
    lockModelTest(false);
  }
}

function initializeOptions() {
  if (optionsReady) return optionsReady;
  document.getElementById("save").addEventListener("click", save);
  document.getElementById("toggleKey").addEventListener("click", () => {
    const input = document.getElementById("apiKey");
    const btn = document.getElementById("toggleKey");
    if (input.type === "password") { input.type = "text"; btn.textContent = "Hide"; }
    else { input.type = "password"; btn.textContent = "Show"; }
  });
  document.getElementById("test").addEventListener("click", testModel);
  const selectionChanged = () => { updateModelUi(); setOptionsStatus(""); };
  document.getElementById("model").addEventListener("change", selectionChanged);
  document.getElementById("customModel").addEventListener("input", selectionChanged);
  document.getElementById("apiKey").addEventListener("input", () => setOptionsStatus(""));
  document.getElementById("useDefaults").addEventListener("click", () => {
    try {
      applyModelDefaults(readSelectedModel());
      showModelValidation();
      setOptionsStatus("Defaults applied. Click Save to persist.", 2500);
    } catch (error) {
      showModelValidation(String(error.message || error));
      setOptionsStatus(`Defaults could not be applied: ${error.message || error}`);
    }
  });

  // Field validations
  attachValidation("temperature", { min: 0, max: 2, integer: false });
  attachValidation("topP", { min: 0, max: 1, integer: false });
  attachValidation("maxTokens", { min: 1, max: null, integer: true });
  attachValidation("presencePenalty", { min: -2, max: 2, integer: false });
  attachValidation("frequencyPenalty", { min: -2, max: 2, integer: false });
  const readerToggle = document.getElementById("enableReaderSummaries");
  if (readerToggle) {
    readerToggle.addEventListener("change", (e) => {
      syncReaderSummaryOptions(!!e.target.checked);
    });
  }
  optionsReady = load().catch(error => setOptionsStatus(`Settings could not be loaded: ${error.message || error}`));
  return optionsReady;
}

document.addEventListener("DOMContentLoaded", initializeOptions);

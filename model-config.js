/* Shared model catalog and Chat Completions parameters; no API access. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ModelConfig = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULT_MODEL = "gpt-6-luna";
  const MODELS = Object.freeze([
    { id: "gpt-6-luna", label: "GPT-6 Luna", description: "For everyday email drafting." },
    { id: "gpt-6.1-terra", label: "GPT-6.1 Terra", description: "For clear, natural drafting and revision." },
    { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", description: "For more demanding writing and reasoning tasks." },
    { id: "gpt-6-astra", label: "GPT-6 Astra", description: "For complex writing and reasoning tasks." },
    { id: "gpt-5", label: "GPT-5 (deprecated)", description: "Deprecated by OpenAI. Choose a current model for new work." },
    { id: "gpt-4o-mini", label: "GPT-4o mini (deprecated)", description: "Previous AI Mate default; deprecated by OpenAI. Your saved choice is preserved." },
    { id: "gpt-4o", label: "GPT-4o (deprecated)", description: "Deprecated by OpenAI; saved sampling controls are preserved." },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini (deprecated)", description: "Deprecated by OpenAI; saved sampling controls are preserved." },
    { id: "gpt-4.1", label: "GPT-4.1 (deprecated)", description: "Deprecated by OpenAI; saved sampling controls are preserved." }
  ].map((model) => Object.freeze(model)));

  // Only explicitly supported IDs receive sampling parameters. A model name,
  // dated snapshot, or fine-tune must not inherit capabilities from a prefix.
  const SAMPLING_TEMPERATURES = new Map([
    ["gpt-4o-mini", 0.4],
    ["gpt-4o", 0.4],
    ["gpt-4.1-mini", 0.5],
    ["gpt-4.1", 0.5],
    ["gpt-3.5-turbo", 0.7]
  ]);
  const RETIRED_MODELS = new Set(["gpt-3.5-turbo"]);
  const KNOWN_MODELS = new Set([...MODELS.map((model) => model.id), ...RETIRED_MODELS]);

  function normalizeModel(value) {
    if (typeof value !== "string") throw new Error("Enter a non-empty model ID, such as gpt-4o-mini.");
    // Reject invisible controls before trimming, including pasted line breaks.
    if (/[\p{Cc}\p{Cf}]/u.test(value)) throw new Error("The model ID cannot contain control characters or line breaks.");
    const model = value.trim();
    if (!model) throw new Error("Enter a non-empty model ID, such as gpt-4o-mini.");
    if (/\s/u.test(model)) throw new Error("The model ID cannot contain spaces or other whitespace.");
    return model;
  }

  function getProfile(value) {
    const id = normalizeModel(value);
    const sampling = SAMPLING_TEMPERATURES.has(id);
    return {
      id,
      known: KNOWN_MODELS.has(id),
      sampling,
      defaults: {
        temperature: sampling ? SAMPLING_TEMPERATURES.get(id) : 1,
        topP: 1,
        maxTokens: null,
        presencePenalty: 0,
        frequencyPenalty: 0
      }
    };
  }

  function buildPayload(settings, messages) {
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new Error("Model settings must be an object.");
    const model = normalizeModel(settings.openaiModel === undefined ? DEFAULT_MODEL : settings.openaiModel);
    const profile = getProfile(model);
    const payload = { model, messages, store: false };
    if (profile.sampling) {
      const parameters = [
        ["openaiTemperature", "temperature"],
        ["openaiTopP", "top_p"],
        ["openaiPresencePenalty", "presence_penalty"],
        ["openaiFrequencyPenalty", "frequency_penalty"]
      ];
      for (const [setting, parameter] of parameters) {
        if (Number.isFinite(settings[setting])) payload[parameter] = settings[setting];
      }
    }
    const maxTokens = settings.openaiMaxTokens;
    if (maxTokens !== undefined && maxTokens !== null) {
      if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) {
        throw new Error("Max Tokens must be a positive whole number within the safe integer range, or left blank.");
      }
      // Use the current Chat Completions field for ordinary and reasoning
      // models alike; never retry by silently dropping the user's limit.
      payload.max_completion_tokens = maxTokens;
    }
    return payload;
  }

  function modelNotice(id) { return RETIRED_MODELS.has(id) ? "This model has been retired by OpenAI. Your saved ID is preserved; choose a current model to continue." : ""; }
  return Object.freeze({ DEFAULT_MODEL, MODELS, normalizeModel, getProfile, buildPayload, modelNotice });
});

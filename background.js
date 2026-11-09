/* global DOMPurify, ReplyCore, ModelConfig, RewriteCore */
/* Background script for AI Reply Assistant */

function sanitizeAiContent(content) {
  const text = typeof content === "string" ? content : "";
  if (!text) return "";
  try {
    if (typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function") {
      return DOMPurify.sanitize(text);
    }
  } catch (err) {
    console.warn("AI Mate: summary sanitization failed.");
  }
  throw new Error("The summary could not be displayed safely. Please reload AI Mate and try again.");
}

async function getSettings() {
  const {
    openaiApiKey,
    openaiModel,
    openaiTemperature,
    openaiTopP,
    openaiMaxTokens,
    openaiPresencePenalty,
    openaiFrequencyPenalty,
    summaryLanguage,
    summaryStyle,
    replyStyle,
    replyLength,
    writingPreferences
  } = await browser.storage.local.get({
    openaiApiKey: "",
    openaiModel: ModelConfig.DEFAULT_MODEL,
    openaiTemperature: 0.7,
    openaiTopP: 1,
    openaiMaxTokens: null,
    openaiPresencePenalty: 0,
    openaiFrequencyPenalty: 0,
    summaryLanguage: "auto",
    summaryStyle: "balanced",
    replyStyle: "natural",
    replyLength: "normal",
    writingPreferences: ""
  });
  return { openaiApiKey, openaiModel, openaiTemperature, openaiTopP, openaiMaxTokens, openaiPresencePenalty, openaiFrequencyPenalty, summaryLanguage, summaryStyle, replyStyle: ReplyCore.normalizeStyle(replyStyle), replyLength: ReplyCore.normalizeLength(replyLength), writingPreferences: typeof writingPreferences === "string" ? writingPreferences : "" };
}

const LAST_PROMPT_KEY = "lastPrompt";

function getComposeApi() {
  const api = browser["compose"];
  if (!api || typeof api.getComposeDetails !== "function" || typeof api.setComposeDetails !== "function") {
    throw new Error("Compose API is not available in this application.");
  }
  return api;
}

function getMessagesApi() {
  return browser["messages"] || null;
}

function getMessageDisplayApi() {
  return browser["messageDisplay"] || null;
}

function getComposeActionApi() {
  return browser["composeAction"] || null;
}


async function notify(title, message) {
  try {
    const id = `ai-reply-${Date.now()}`;
    await browser.notifications.create(id, {
      type: "basic",
      iconUrl: browser.runtime.getURL("Logo.png"),
      title,
      message
    });
    return id;
  } catch (e) {
    // Notifications might be disabled; ignore.
    return null;
  }
}

function stripHtml(html) {
  try {
    return ReplyCore.htmlToText(html);
  } catch (e) {
    // A failed parser must not expose hidden HTML or raw MIME as email text.
    return "";
  }
}

function normalizeSummaryInput(text) {
  return (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const SUMMARY_SYSTEM_PROMPT = "You are a helpful email assistant. Create a clear, concise summary of the email. Focus on the key points, action items, and important details. Use bullet points for clarity. Do not end with generic offers for further help or invitations to ask questions.";
const SUMMARY_STYLE_INSTRUCTIONS = {
  balanced: "Keep the summary balanced with 3 to 5 bullet points covering the main ideas and action items.",
  concise: "Keep the summary very short with only the essential 2 to 3 bullet points.",
  detailed: "Provide a more detailed summary that captures context, relevant figures, and next steps using bullet points.",
  outline: "Present the summary as an outline-style list with clear structure and hierarchy."
};

const LANG_NAME_MAP = {
  en: 'English',
  es: 'Spanish (Espanol)',
  fr: 'French (Francais)',
  de: 'German (Deutsch)',
  pt: 'Portuguese (Portugues)',
  it: 'Italian (Italiano)',
  nl: 'Dutch (Nederlands)',
  el: 'Greek',
  ja: 'Japanese',
  zh: 'Chinese',
  ru: 'Russian',
  ar: 'Arabic'
};

function buildSummaryMessages(originalText, userPrompt = "", language = "auto", style = "balanced") {
  let langInstruction;
  if (language && language !== "auto") {
    // support region tags like "es-ES"
    const code = String(language).split(/[-_]/)[0].toLowerCase();
    const name = LANG_NAME_MAP[code] || language;
    langInstruction = `Please write the summary in ${name}.`;
  } else {
    langInstruction = "If possible, match the language of the email or use the user's prompt to choose language.";
  }
  const styleKey = SUMMARY_STYLE_INSTRUCTIONS[style] ? style : "balanced";
  const styleInstruction = SUMMARY_STYLE_INSTRUCTIONS[styleKey];
  const systemContent = [SUMMARY_SYSTEM_PROMPT, langInstruction, styleInstruction].filter(Boolean).join(" ");

  return [
    {
      role: "system",
      content: systemContent
    },
    {
      role: "user",
      content:
        (userPrompt ? `Instruction: ${userPrompt}\n\n` : "") +
        "Email content to summarize:\n\n" +
        originalText
    }
  ];
}

async function summarizeTextContent(originalText, userPrompt = "", language = "auto") {
  const settings = await getSettings();
  const { openaiApiKey, summaryLanguage, summaryStyle } = settings;
  if (!openaiApiKey) {
    throw new Error("OpenAI API key not set. Configure it in Add-on Options.");
  }

  const normalizedText = normalizeSummaryInput(originalText);
  if (!normalizedText) {
    throw new Error("No content to summarize.");
  }

  // prefer explicit language parameter if provided, otherwise use saved setting
  const effectiveLang = (language && language !== "") ? language : (summaryLanguage || "auto");
  const stylePreference = summaryStyle || "balanced";
  const messages = buildSummaryMessages(normalizedText, userPrompt, effectiveLang, stylePreference);
  const payload = ModelConfig.buildPayload(settings, messages);
  const content = await requestCompletionText(openaiApiKey, payload, "summary");
  const sanitized = sanitizeAiContent(content);
  if (!sanitized) throw new Error("No summary generated");
  return sanitized;
}

function extractPlainTextFromPayload(part) {
  if (!part) return "";
  const disposition = part.headers?.["content-disposition"] || [];
  if (part.name || part.filename || String(disposition).toLowerCase().includes("attachment")) return "";
  const mime = (part.mimeType || part.contentType || "").toLowerCase();
  if (mime.startsWith("message/")) return "";
  if (typeof part.body === "string" && part.body.length) {
    if (mime.includes("text/plain")) return part.body;
    if (mime.includes("text/html")) return stripHtml(part.body);
  }
  if (Array.isArray(part.parts)) {
    if (mime.startsWith("multipart/alternative")) {
      const plain = part.parts.find((child) => /^text\/plain(?:;|$)/i.test(child.contentType || child.mimeType || "") && !child.name && !child.filename);
      if (plain) return extractPlainTextFromPayload(plain);
    }
    return part.parts
      .map((child) => extractPlainTextFromPayload(child))
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

async function getMessagePlainText(messageId) {
  const messagesApi = getMessagesApi();
  if (!messagesApi) {
    console.warn("AI Mate: messages API is unavailable in this environment.");
    return "";
  }

  // Try messages.getFull first (preferred)
  if (typeof messagesApi.getFull === "function") {
    try {
      const full = await messagesApi.getFull(messageId);
      const plain = extractPlainTextFromPayload(full?.payload || full);
      if (plain && plain.trim()) {
        return plain;
      }
    } catch (e) {
      console.warn("AI Mate: inline message extraction failed.");
    }
  }

  // Do not fall back to raw MIME: that can include attachments and headers.
  console.warn("AI Mate: no readable inline message body.");
  return "";
}


async function getActiveComposeTabId() {
  // Prefer a compose tab in the last focused compose window
  try {
    const wins = await browser.windows.getAll({ populate: true });
    const focused = wins.find((w) => w.focused && w.type === "messageCompose");
    if (focused && focused.tabs && focused.tabs.length) {
      const t = focused.tabs.find((tb) => tb.active) || focused.tabs[0];
      if (t && t.id) return t.id;
    }
  } catch {}

  // Each compose window has its own active tab. Never pick an arbitrary
  // active tab from another window when the caller has no explicit tab ID.
  const allTabs = await browser.tabs.query({ active: true, currentWindow: true });
  const isCompose = (t) => (t && (t.type === "messageCompose" || (t.url && t.url.includes("about:compose"))));
  const candidate = allTabs.find((t) => isCompose(t));
  if (!candidate) throw new Error("No compose window/tab is currently active.");
  return candidate.id;
}

async function describeOpenAIError(response, model) {
  // Never surface raw provider bodies: they can echo credentials or email text.
  let error;
  try { error = (await response.json())?.error; } catch {}
  const code = error?.code;
  const status = response.status;
  if (status === 401) return "OpenAI rejected the API key. Check the key in Settings.";
  if (status === 403) return `OpenAI denied access to ${model}. Check your project's model permissions and account access.`;
  if (status === 404 || code === "model_not_found") return `Model ${model} was not found or is not available to this API key. Check its exact ID and your project's model access.`;
  if (code === "insufficient_quota" || code === "billing_hard_limit_reached") return "OpenAI API quota or credits are exhausted. Check API billing and project spending limits.";
  if (status === 429) return "OpenAI is rate limiting requests. Wait a moment and try again.";
  if (code === "context_length_exceeded") return "The email and requested output exceed this model's context limit. Reduce the input or Max tokens, or choose a model with a larger context.";
  if (status === 400 && (code === "unsupported_value" || code === "unsupported_parameter")) {
    const param = typeof error?.param === "string" && /^[a-z_][a-z0-9_.]{0,79}$/i.test(error.param) ? ` (${error.param})` : "";
    return `Model ${model} rejected a request parameter${param}. Check its Chat Completions compatibility and settings. No model or token limit was changed automatically.`;
  }
  if (status >= 500) return "OpenAI is temporarily unavailable. Try again later.";
  return `OpenAI rejected the request for ${model} (HTTP ${status}). Check the model ID, Chat Completions support and API settings.`;
}

async function requestCompletionText(apiKey, payload, purpose = "reply") {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
  try {
    let response;
    try {
      response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", redirect: "error",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
    } catch {
      throw new Error(controller.signal.aborted
        ? "The OpenAI request timed out. Try again when you are ready."
        : "Could not reach OpenAI. Check your connection and try again.");
    }
    if (!response.ok) throw new Error(await describeOpenAIError(response, payload.model));
    let data;
    try { data = await response.json(); }
    catch {
      throw new Error(controller.signal.aborted ? "The OpenAI request timed out." : "OpenAI returned an unreadable response. Try again.");
    }
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") {
      if (purpose === "test") throw new Error("The model was reached, but the test token budget was exhausted before a complete answer. Access responded; the generation test is inconclusive.");
      throw new Error(`OpenAI stopped before finishing the ${purpose}. Increase Max tokens in Settings or request a shorter ${purpose}. The limit includes reasoning tokens on reasoning models.`);
    }
    if (choice?.finish_reason !== "stop" || choice?.message?.refusal) {
      throw new Error(`OpenAI did not return a complete ${purpose === "test" ? "test response" : purpose}. Try again when you are ready.`);
    }
    const content = choice?.message?.content;
    if (typeof content !== "string" || !content.trim()) throw new Error("No text returned by OpenAI. Check that the model supports text output in Chat Completions.");
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

let modelTestPending = false;
async function testModel(apiKey, requestedModel) {
  if (modelTestPending) throw new Error("A model test is already in progress. Wait for it to finish.");
  modelTestPending = true;
  try {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!key) throw new Error("API key is empty. Enter a key before testing the model.");
    const model = ModelConfig.normalizeModel(requestedModel);
    const profile = ModelConfig.getProfile(model);
    // A fixed, bounded access test; never read compose content or stored prompts.
    const payload = ModelConfig.buildPayload({ openaiModel: model, openaiMaxTokens: profile.sampling ? 64 : 2048 }, [
      { role: "user", content: "Reply with exactly: OK" }
    ]);
    await requestCompletionText(key, payload, "test");
    return { ok: true, model };
  } finally {
    modelTestPending = false;
  }
}
// Draft fragments and reply identities live only in memory for this compose tab.
const replyRequests = new Map();
const previousReplies = new Map();
const undoReplies = new Map();
const rewritePreviews = new Map();
browser.tabs.onRemoved.addListener((tabId) => {
  replyRequests.delete(tabId);
  previousReplies.delete(tabId);
  undoReplies.delete(tabId);
  rewritePreviews.delete(tabId);
});

const selectionReady = (async () => {
  if (!browser.composeScripts?.register) return;
  await browser.composeScripts.register({ js: [{ file: "rewrite-core.js" }, { file: "selection-editor.js" }] });
  const tabs = await browser.tabs.query({});
  await Promise.all(tabs.filter((tab) => tab.type === "messageCompose").map((tab) => injectSelectionEditor(tab.id).catch(() => {})));
})().catch(() => { console.warn("AI Mate: selection editor registration failed."); });

async function injectSelectionEditor(tabId) {
  await browser.tabs.executeScript(tabId, { file: "rewrite-core.js" });
  await browser.tabs.executeScript(tabId, { file: "selection-editor.js" });
}

async function selectionRequest(tabId, command, fields = {}) {
  await selectionReady;
  const message = { channel: "ai-mate-selection", command, ...fields };
  let result;
  try { result = await browser.tabs.sendMessage(tabId, message); }
  catch {
    // Only read operations may recover by injection. Never repeat a mutation.
    if (command !== "state") throw new Error("The selection editor is unavailable. Select the text again.");
    await injectSelectionEditor(tabId);
    result = await browser.tabs.sendMessage(tabId, message);
  }
  if (!result?.ok) throw new Error(result?.error || "The selection editor is unavailable. Reopen this compose window.");
  return result;
}

async function generateSelectionPreview(tabId, token, style, instruction) {
  if (typeof token !== "string" || !token) throw new Error("Select some text in the email body first.");
  const request = acquireComposeChange(tabId);
  const preview = { token, request, text: "" };
  rewritePreviews.set(tabId, preview);
  try {
    const selection = await selectionRequest(tabId, "verify", { token });
    const settings = await getSettings();
    if (!settings.openaiApiKey) throw new Error("OpenAI API key not set. Configure it in Add-on Options.");
    const messages = RewriteCore.buildMessages(selection, style, instruction);
    const content = await requestCompletionText(settings.openaiApiKey, ModelConfig.buildPayload(settings, messages), "rewrite");
    await selectionRequest(tabId, "verify", { token });
    if (rewritePreviews.get(tabId) !== preview || replyRequests.get(tabId) !== request) throw new Error("This rewrite was cancelled or the compose window closed.");
    preview.text = RewriteCore.validateResult(content, selection.links);
    return { ok: true, token, original: selection.text, text: preview.text };
  } catch (error) {
    if (rewritePreviews.get(tabId) === preview) rewritePreviews.delete(tabId);
    throw error;
  } finally {
    if (replyRequests.get(tabId) === request) replyRequests.delete(tabId);
  }
}

async function applySelectionPreview(tabId, token) {
  const request = acquireComposeChange(tabId);
  try {
    const preview = rewritePreviews.get(tabId);
    if (!preview?.text || preview.token !== token) throw new Error("Generate a new rewrite preview before replacing the selection.");
    const previous = previousReplies.get(tabId) || null;
    const result = await selectionRequest(tabId, "apply", { token, text: preview.text });
    if (replyRequests.get(tabId) !== request) throw new Error("The compose window closed.");
    undoReplies.set(tabId, { selectionToken: result.undoToken, previousReply: previous });
    // Keep existing reply identity: if selection rewriting edits it, regeneration
    // must refuse it as edited until Undo restores that exact previous reply.
    rewritePreviews.delete(tabId);
    return { ok: true };
  } finally { if (replyRequests.get(tabId) === request) replyRequests.delete(tabId); }
}

async function discardSelectionPreview(tabId, token) {
  if (rewritePreviews.get(tabId)?.token === token) rewritePreviews.delete(tabId);
  await selectionRequest(tabId, "discard", { token }).catch(() => {});
  return { ok: true };
}

// The popup owns a short-lived preview lease. Closing it invalidates pending
// results even when unload messages cannot be delivered.
browser.runtime.onConnect?.addListener((port) => {
  if (!isTrustedPage(port.sender) || !/^rewrite:\d+$/.test(port.name)) return;
  const tabId = Number(port.name.slice(8));
  port.onDisconnect.addListener(() => {
    const preview = rewritePreviews.get(tabId);
    if (preview) discardSelectionPreview(tabId, preview.token);
  });
});

function acquireComposeChange(tabId) {
  if (replyRequests.has(tabId)) throw new Error("A reply is already being generated or another AI-Mate change is in progress in this compose window.");
  const request = {};
  replyRequests.set(tabId, request);
  return request;
}

async function writeComposeChange(tabId, request, details, update) {
  const composeApi = getComposeApi();
  // Compose has no atomic compare-and-set API. Keep this final read/write
  // interval minimal and never adopt intervening edits as a trusted baseline.
  const current = await composeApi.getComposeDetails(tabId);
  if (replyRequests.get(tabId) !== request) throw new Error("The compose window was closed. No change was applied.");
  if (ReplyCore.snapshot(current) !== ReplyCore.snapshot(details)) {
    throw new Error("The email changed while AI-Mate was working. Your changes have been kept; try again when you are ready.");
  }
  await composeApi.setComposeDetails(tabId, update);
}

async function generateReplyForCompose(tabId, userPrompt, requestedStyle, requestedLength, operation = "generate") {
  if (operation !== "generate" && operation !== "improve") throw new Error("Unknown compose operation.");
  const request = acquireComposeChange(tabId);
  try {
    const settings = await getSettings();
    const { openaiApiKey } = settings;
    if (!openaiApiKey) throw new Error("OpenAI API key not set. Configure it in Add-on Options.");
    const composeApi = getComposeApi();
    const details = await composeApi.getComposeDetails(tabId);
    const previous = previousReplies.get(tabId) || null;
    const context = operation === "improve" ? ReplyCore.buildImproveContext(details) : ReplyCore.buildContext(details, previous);
    const style = requestedStyle === undefined ? settings.replyStyle : ReplyCore.normalizeStyle(requestedStyle);
    const length = requestedLength === undefined ? settings.replyLength : ReplyCore.normalizeLength(requestedLength);
    const payload = ModelConfig.buildPayload(settings, ReplyCore.buildMessages(context, userPrompt, style, length, settings.writingPreferences, operation));
    const content = await requestCompletionText(openaiApiKey, payload);
    const insertion = operation === "improve"
      ? ReplyCore.prepareImprovement(details, content, crypto.randomUUID())
      : ReplyCore.prepareInsertion(details, content, previous, crypto.randomUUID());
    await writeComposeChange(tabId, request, details, insertion.update);
    if (replyRequests.get(tabId) === request) {
      previousReplies.set(tabId, insertion.state);
      undoReplies.set(tabId, { undo: insertion.undo, previousReply: previous });
      rewritePreviews.delete(tabId);
      await selectionRequest(tabId, "clearUndo").catch(() => {});
    }
  } finally {
    if (replyRequests.get(tabId) === request) replyRequests.delete(tabId);
  }
}

async function undoLastReplyForCompose(tabId) {
  const request = acquireComposeChange(tabId);
  try {
    const record = undoReplies.get(tabId);
    if (!record) throw new Error("There is no AI-Mate change to undo in this compose window.");
    if (record.selectionToken) {
      await selectionRequest(tabId, "undo", { token: record.selectionToken });
    } else {
      const details = await getComposeApi().getComposeDetails(tabId);
      const update = ReplyCore.prepareUndo(details, record.undo);
      await writeComposeChange(tabId, request, details, update);
    }
    if (replyRequests.get(tabId) === request) {
      if (record.previousReply) previousReplies.set(tabId, record.previousReply);
      else previousReplies.delete(tabId);
      undoReplies.delete(tabId);
    }
  } finally {
    if (replyRequests.get(tabId) === request) replyRequests.delete(tabId);
  }
}

async function getComposeActionState(tabId) {
  const busyState = { ok: true, busy: true, canImprove: false, improveReason: "Wait for the current AI-Mate change to finish.", canUndo: false, undoReason: "Wait for the current AI-Mate change to finish." };
  if (replyRequests.has(tabId)) return busyState;
  const details = await getComposeApi().getComposeDetails(tabId);
  if (replyRequests.has(tabId)) return busyState;
  const state = { ok: true, busy: false, canImprove: true, improveReason: "", canUndo: false, undoReason: "There is no AI-Mate change to undo in this compose window." };
  try { Object.assign(state, await selectionRequest(tabId, "state")); }
  catch { Object.assign(state, { canRewrite: false, rewriteReason: "Selection rewriting is unavailable. Reopen this compose window." }); }
  try { ReplyCore.buildImproveContext(details); }
  catch (error) { state.canImprove = false; state.improveReason = error.message; }
  const record = undoReplies.get(tabId);
  if (record) {
    try {
      if (record.selectionToken) Object.assign(state, await selectionRequest(tabId, "undoState", { token: record.selectionToken }));
      else { ReplyCore.prepareUndo(details, record.undo); state.canUndo = true; state.undoReason = ""; }
    }
    catch (error) { state.undoReason = error.message; }
  }
  return state;
}
async function summarizeEmailForCompose(tabId, userPrompt = "", language = "") {
  const composeApi = getComposeApi();
  const details = await composeApi.getComposeDetails(tabId);
  const originalText = details.isPlainText
    ? (details.plainTextBody || "")
    : stripHtml(details.body || "");
  return summarizeTextContent(originalText, userPrompt, language);
}

async function summarizeDisplayedMessage(tabId, userPrompt = "", language = "") {
  const { enableReaderSummaries = false } = await browser.storage.local.get({
    enableReaderSummaries: false
  });
  if (!enableReaderSummaries) {
    throw new Error("Message display summaries are disabled in the add-on options.");
  }
  let resolvedTabId = Number(tabId);
  if (!Number.isFinite(resolvedTabId) || resolvedTabId < 1) {
    resolvedTabId = undefined;
  }
  const messageDisplayApi = getMessageDisplayApi();
  if (!messageDisplayApi || typeof messageDisplayApi.getDisplayedMessage !== "function") {
    throw new Error("Message display API is not available in this application.");
  }
  const message = resolvedTabId !== undefined
    ? await messageDisplayApi.getDisplayedMessage(resolvedTabId)
    : await messageDisplayApi.getDisplayedMessage();
  if (!message) {
    throw new Error("Select an email to summarize.");
  }
  const plainText = await getMessagePlainText(message.id);
  if (!plainText.trim()) {
    throw new Error("Unable to read this email's content.");
  }
  const headerParts = [];
  if (message.subject) headerParts.push(`Subject: ${message.subject}`);
  if (message.author) headerParts.push(`From: ${message.author}`);
  if (Array.isArray(message.recipients) && message.recipients.length) {
    const list = message.recipients
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && entry.name) return entry.name;
        if (entry && entry.email) return entry.email;
        return "";
      })
      .filter(Boolean)
      .join(", ");
    if (list) headerParts.push(`To: ${list}`);
  }
  const context = [headerParts.join("\n"), plainText].filter(Boolean).join("\n\n");
  return summarizeTextContent(context, userPrompt, language);
}
// Initialize message handling with proper async handling
function isTrustedPage(sender) {
  if (sender?.id !== browser.runtime.id || typeof sender.url !== "string") return false;
  return ["popup.html", "options.html", "reader-popup.html"].some((page) => sender.url.split(/[?#]/)[0] === browser.runtime.getURL(page));
}

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handleMessage = async () => {
    if (!msg || typeof msg !== 'object') {
      throw new Error('Invalid message format');
    }

    try {
      if (!isTrustedPage(sender)) throw new Error("This request did not come from an AI Mate page.");
      const composeTypes = ["GENERATE_REPLY", "UNDO_LAST_REPLY", "GET_COMPOSE_ACTION_STATE", "SUMMARIZE_EMAIL", "REWRITE_SELECTION", "APPLY_REWRITE", "DISCARD_REWRITE"];
      if (composeTypes.includes(msg.type)) {
        if (sender.url.split(/[?#]/)[0] !== browser.runtime.getURL("popup.html")) throw new Error("Open the AI Mate compose widget for this action.");
        if (msg.tabId === undefined) msg = { ...msg, tabId: await getActiveComposeTabId() };
        if (!Number.isSafeInteger(msg.tabId) || msg.tabId <= 0 || (await browser.tabs.get(msg.tabId)).type !== "messageCompose") throw new Error("The target is not an open compose window.");
      }
      if (["TEST_MODEL", "TEST_API_KEY"].includes(msg.type) && sender.url.split(/[?#]/)[0] !== browser.runtime.getURL("options.html")) throw new Error("Open Settings to test a model.");
      switch(msg.type) {
        case "REWRITE_SELECTION": return await generateSelectionPreview(msg.tabId, msg.token, msg.style, msg.instruction || "");
        case "APPLY_REWRITE": return await applySelectionPreview(msg.tabId, msg.token);
        case "DISCARD_REWRITE": return await discardSelectionPreview(msg.tabId, msg.token);
        case "GENERATE_REPLY":
          try {
            const tabId = msg.tabId || (await getActiveComposeTabId());
            await generateReplyForCompose(tabId, msg.prompt || "", msg.replyStyle, msg.replyLength, msg.operation === undefined ? "generate" : msg.operation);
            return { ok: true };
          } catch (e) {
            console.error('AI Mate: reply generation failed.');
            throw e;
          }

        case "UNDO_LAST_REPLY":
          await undoLastReplyForCompose(msg.tabId || (await getActiveComposeTabId()));
          return { ok: true };

        case "GET_COMPOSE_ACTION_STATE":
          return await getComposeActionState(msg.tabId || (await getActiveComposeTabId()));

        case "OPEN_OPTIONS":
          try {
            await browser.runtime.openOptionsPage();
            return { ok: true };
          } catch (e) {
            console.error('AI Mate: could not open Settings.');
            // Try alternative method if primary fails
            try {
              await browser.windows.create({
                url: browser.runtime.getURL("options.html"),
                type: "popup",
                width: 600,
                height: 700
              });
              return { ok: true, fallback: true };
            } catch (e2) {
              console.error('AI Mate: Settings fallback failed.');
              throw e2;
            }
          }
          break;

        case "TEST_MODEL":
          return await testModel(msg.apiKey, msg.model);

        case "TEST_API_KEY":
          let key = msg?.apiKey;
          if (!key) {
            const { openaiApiKey } = await getSettings();
            key = openaiApiKey;
          }
          if (!key) throw new Error("API key is empty");
          const r = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${key}` }
          });
          if (!r.ok) throw new Error(`HTTP ${r.status} ${r.statusText}`);
          return { ok: true };

        case "SUMMARIZE_EMAIL":
          {
            const emailTabId = msg.tabId || (await getActiveComposeTabId());
            const emailSummary = await summarizeEmailForCompose(emailTabId, msg.prompt || "", msg.language || "");
            return { ok: true, summary: emailSummary };
          }

        case "SUMMARIZE_DISPLAYED_MESSAGE":
          {
            const displaySummary = await summarizeDisplayedMessage(msg.tabId, msg.prompt || "", msg.language || "");
            return { ok: true, summary: displaySummary };
          }

        default:
          throw new Error(`Unknown message type: ${msg.type}`);
      }
    } catch (e) {
      console.error('AI Mate: operation failed.');
      return { ok: false, error: e?.message || String(e) };
    }
  };

  // Proper async message handling
  handleMessage()
    .then(response => sendResponse(response))
    .catch(error => sendResponse({
      ok: false,
      error: error?.message || String(error)
    }));

  // Return true to indicate we will send a response asynchronously
  return true;
});

// Fallback: if popup cannot open or user clicks the toolbar button directly,
// generate using the last prompt (or none), and report via notifications.
const composeActionApi = getComposeActionApi();
if (composeActionApi && composeActionApi.onClicked) {
  composeActionApi.onClicked.addListener(async (tab) => {
    try {
      const tabId = (tab && tab.id) ? tab.id : await getActiveComposeTabId();
      const { [LAST_PROMPT_KEY]: lastPrompt } = await browser.storage.local.get({ [LAST_PROMPT_KEY]: "" });
      await notify("AI Reply", "Generating reply...");
      await generateReplyForCompose(tabId, lastPrompt || "");
      await notify("AI Reply", "Reply inserted in the compose window.");
    } catch (e) {
      await notify("AI Reply - Error", String(e?.message || e));
      // If likely due to missing API key, open settings to help user fix quickly
      const { openaiApiKey } = await getSettings();
      if (!openaiApiKey) {
        try { await browser.runtime.openOptionsPage(); } catch {}
      }
    }
  });
}








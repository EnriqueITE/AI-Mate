/* Background script for AI Reply Assistant */

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
    summaryStyle
  } = await browser.storage.local.get({
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    openaiTemperature: 0.7,
    openaiTopP: 1,
    openaiMaxTokens: null,
    openaiPresencePenalty: 0,
    openaiFrequencyPenalty: 0,
    summaryLanguage: "auto",
    summaryStyle: "balanced"
  });
  return { openaiApiKey, openaiModel, openaiTemperature, openaiTopP, openaiMaxTokens, openaiPresencePenalty, openaiFrequencyPenalty, summaryLanguage, summaryStyle };
}

const LAST_PROMPT_KEY = "lastPrompt";


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
    const parser = new DOMParser();
    const doc = parser.parseFromString(html || "", "text/html");
    return doc.body.textContent || "";
  } catch (e) {
    // Fallback simple stripper
    return (html || "").replace(/<[^>]+>/g, "");
  }
}

function textToHtml(text) {
  // Retained for string-based fallback path only.
  const esc = (s) => s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const cleaned = (text || "")
    .replace(/\r\n/g, "\n")
    .replace(/^\s+|\s+$/g, "");
  return `<span data-ai-reply-text style="display:block;margin:0;padding:0;">${esc(cleaned).replace(/\n/g, "<br>")}</span>`;
}

function createReplySpan(ownerDoc, text) {
  const span = ownerDoc.createElement("span");
  span.setAttribute("data-ai-reply-text", "");
  span.style.display = "block";
  span.style.margin = "0";
  span.style.padding = "0";
  const cleaned = String(text || "").replace(/\r\n/g, "\n").trim();
  const parts = cleaned.split("\n");
  parts.forEach((line, idx) => {
    span.appendChild(ownerDoc.createTextNode(line));
    if (idx < parts.length - 1) span.appendChild(ownerDoc.createElement("br"));
  });
  return span;
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
  const { openaiApiKey, openaiModel, summaryLanguage, summaryStyle } = await getSettings();
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
  const payload = {
    model: openaiModel || "gpt-4o-mini",
    messages,
    temperature: 0.7
  };

  const resp = await sendChatCompletion(openaiApiKey, payload);
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${text || resp.statusText}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("No summary generated");
  return content;
}

function extractPlainTextFromPayload(part) {
  if (!part) return "";
  const mime = (part.mimeType || part.contentType || "").toLowerCase();
  if (typeof part.body === "string" && part.body.length) {
    if (mime.includes("text/plain")) return part.body;
    if (mime.includes("text/html")) return stripHtml(part.body);
  }
  if (Array.isArray(part.parts)) {
    return part.parts
      .map((child) => extractPlainTextFromPayload(child))
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

async function getMessagePlainText(messageId) {
  // Try messages.getFull first (preferred)
  try {
    const full = await browser.messages.getFull(messageId);
    const plain = extractPlainTextFromPayload(full?.payload || full);
    if (plain && plain.trim()) {
      return plain;
    }
  } catch (e) {
    console.warn("AI Mate: messages.getFull failed:", e);
  }

  // Try messages.getRaw as a fallback and attempt to strip HTML
  try {
    const raw = await browser.messages.getRaw(messageId);
    if (raw && raw.length) {
      // naive extraction: prefer text/plain parts if present, otherwise strip HTML tags
      // Try to find a text/plain section in the raw source
      const textPlainMatch = raw.match(/Content-Type: text\/plain;[\s\S]*?\r?\n\r?\n([\s\S]*)/i);
      if (textPlainMatch && textPlainMatch[1]) {
        const candidate = textPlainMatch[1].trim();
        if (candidate) {
          return candidate;
        }
      }
      // Fallback: strip HTML tags from the raw source
      const stripped = stripHtml(raw);
      if (stripped && stripped.trim()) {
        return stripped;
      }
    }
  } catch (e) {
    console.warn("AI Mate: messages.getRaw failed:", e);
  }

  // Older code paths tried browser.messages.getBody(); attempt if available
  try {
    if (typeof browser.messages.getBody === 'function') {
      try {
        const htmlBody = await browser.messages.getBody(messageId);
        if (htmlBody) {
          const plain = stripHtml(htmlBody);
          if (plain && plain.trim()) {
            return plain;
          }
        }
      } catch (e) {
        console.warn("AI Mate: messages.getBody failed:", e);
      }
    }
  } catch (e) {
    // ignore
  }

  console.warn("AI Mate: Unable to extract plain text for message", messageId);
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
    // Any compose window
    const anyCompose = wins.find((w) => w.type === "messageCompose");
    if (anyCompose && anyCompose.tabs && anyCompose.tabs.length) {
      return anyCompose.tabs[0].id;
    }
  } catch {}

  // Fallback to tabs.query scanning
  const allTabs = await browser.tabs.query({});
  const isCompose = (t) => (t && (t.type === "messageCompose" || (t.url && t.url.includes("about:compose"))));
  let candidate = allTabs.find((t) => isCompose(t) && t.active) || allTabs.find((t) => isCompose(t));
  if (!candidate) throw new Error("No compose window/tab is currently active.");
  return candidate.id;
}

async function sendChatCompletion(apiKey, payload) {
  const makeRequest = async (body) => fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  let resp = await makeRequest(payload);
  if (resp.ok) return resp;
  if (resp.status === 400) {
    let errJson = null;
    try { errJson = await resp.clone().json(); } catch {}
    const code = errJson?.error?.code || "";
    if (code === "unsupported_value") {
      const stripped = { model: payload.model, messages: payload.messages };
      if (typeof payload.max_tokens !== "undefined") stripped.max_tokens = payload.max_tokens;
      resp = await makeRequest(stripped);
      return resp;
    }
  }
  return resp;
}
async function generateReplyForCompose(tabId, userPrompt) {
  const { openaiApiKey, openaiModel, openaiTemperature, openaiTopP, openaiMaxTokens, openaiPresencePenalty, openaiFrequencyPenalty } = await getSettings();
  if (!openaiApiKey) {
    throw new Error("OpenAI API key not set. Configure it in Add-on Options.");
  }

  const details = await browser.compose.getComposeDetails(tabId);

  const originalText = details.isPlainText
    ? (details.plainTextBody || "")
    : stripHtml(details.body || "");

  // Build chat messages
  const messages = [
    {
      role: "system",
      content:
        "You are a helpful email assistant. Draft a clear, polite, and concise reply. " +
        "Use the same language as the original email. " +
        "Write only the reply text. Do not include quoted text, signatures, or placeholders. Do not end with generic offers for further help unless the user explicitly requests it."
    },
    {
      role: "user",
      content:
        (userPrompt ? `Instruction: ${userPrompt}\n\n` : "") +
        "Original email content (quoted below in the compose editor):\n\n" +
        originalText
    }
  ];

  // Build payload with conditional params
  const basePayload = {
    model: openaiModel || "gpt-4o-mini",
    messages
  };
  const isGpt5 = /(^|\b)gpt-5(\b|$)/i.test(openaiModel || "");
  if (!isGpt5 && Number.isFinite(openaiTemperature)) basePayload.temperature = openaiTemperature;
  if (!isGpt5 && Number.isFinite(openaiTopP)) basePayload.top_p = openaiTopP;
  if (Number.isFinite(openaiMaxTokens)) basePayload.max_tokens = openaiMaxTokens;
  if (!isGpt5 && Number.isFinite(openaiPresencePenalty)) basePayload.presence_penalty = openaiPresencePenalty;
  if (!isGpt5 && Number.isFinite(openaiFrequencyPenalty)) basePayload.frequency_penalty = openaiFrequencyPenalty;

  const resp = await sendChatCompletion(openaiApiKey, basePayload);


  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OpenAI error ${resp.status}: ${text || resp.statusText}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("No content returned by OpenAI");

  // Insert generated reply at the very top, above signature and quote
  if (details.isPlainText) {
    const original = details.plainTextBody || "";
    const trimmedReply = (content || "").replace(/[\s\n]+$/g, "").replace(/^\s+/, "");
    const newBody = `${trimmedReply}\n${original.replace(/^\s+/, "")}`;
    await browser.compose.setComposeDetails(tabId, { plainTextBody: newBody });
  } else {
    const replyHtml = textToHtml(content);
    const original = details.body || "";
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(original, "text/html");
      const container = doc.createElement("div");
      container.setAttribute("data-ai-reply", "true");
      container.style.margin = "0";
      // Append reply content safely without assigning innerHTML
      container.appendChild(createReplySpan(doc, content));
      // In reply mode Thunderbird usually wraps the quote in blockquote[type=cite]
      // and the signature in .moz-signature
      const signature = doc.querySelector(".moz-signature, #moz-signature, pre.moz-signature, span.moz-signature");
      const citePrefix = doc.querySelector(".moz-cite-prefix");
      const quote = doc.querySelector("blockquote");
      const insertBefore = signature || citePrefix || quote || doc.body.firstChild;
      doc.body.insertBefore(container, insertBefore);

      // Remove placeholder empty nodes immediately before our container
      function isEffectivelyEmpty(node) {
        if (!node) return false;
        if (node.nodeType === Node.TEXT_NODE) return !node.nodeValue || !node.nodeValue.trim();
        if (node.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = node.tagName;
        if (tag === 'BR' || tag === 'HR') return true;
        const inner = node.innerHTML.trim();
        if (inner === '' || /^<br\s*\/?>(?:<br\s*\/?>(?:&nbsp;)?)*$/i.test(inner)) return true;
        // Empty block elements with only whitespace or &nbsp;
        const stripped = inner.replace(/&nbsp;|\s|<br\s*\/?>(<!--.*?-->)?/gi, '');
        return stripped === '';
      }
      for (let i = 0; i < 3; i++) {
        const prev = container.previousSibling;
        if (isEffectivelyEmpty(prev)) prev.remove(); else break;
      }
      let newHtml = doc.body.innerHTML
        // Trim extra leading empty blocks and breaks
        .replace(/^\s*(?:<(?:br|hr)\b[^>]*>\s*)+/i, "")
        .replace(/^\s*(?:<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*\/?><!--?[^>]*?--?>?)*<\/(?:p|div)>\s*)+/i, "")
        // Trim extra trailing empty blocks and breaks
        .replace(/(?:<(?:br|hr)\b[^>]*>\s*)+\s*$/i, "")
        .replace(/(?:<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*\/?><!--?[^>]*?--?>?)*<\/(?:p|div)>\s*)+\s*$/i, "");
      await browser.compose.setComposeDetails(tabId, { body: newHtml });
    } catch (e) {
      const newHtml = `${replyHtml}${original}`
        .replace(/^\s*(?:<(?:br|hr)\b[^>]*>\s*)+/i, "")
        .replace(/^\s*(?:<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*\/?><!--?[^>]*?--?>?)*<\/(?:p|div)>\s*)+/i, "")
        .replace(/(?:<(?:br|hr)\b[^>]*>\s*)+\s*$/i, "")
        .replace(/(?:<(?:p|div)[^>]*>(?:\s|&nbsp;|<br\s*\/?><!--?[^>]*?--?>?)*<\/(?:p|div)>\s*)+\s*$/i, "");
      await browser.compose.setComposeDetails(tabId, { body: newHtml });
    }
  }
}

async function summarizeEmailForCompose(tabId, userPrompt = "", language = "") {
  const details = await browser.compose.getComposeDetails(tabId);
  const originalText = details.isPlainText
    ? (details.plainTextBody || "")
    : stripHtml(details.body || "");
  return summarizeTextContent(originalText, userPrompt, language);
}

async function summarizeDisplayedMessage(tabId, userPrompt = "", language = "") {
  let resolvedTabId = Number(tabId);
  if (!Number.isFinite(resolvedTabId) || resolvedTabId < 1) {
    resolvedTabId = undefined;
  }
  const message = resolvedTabId !== undefined
    ? await browser.messageDisplay.getDisplayedMessage(resolvedTabId)
    : await browser.messageDisplay.getDisplayedMessage();
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
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handleMessage = async () => {
    if (!msg || typeof msg !== 'object') {
      throw new Error('Invalid message format');
    }

    try {
      switch(msg.type) {
        case "GENERATE_REPLY":
          try {
            const tabId = msg.tabId || (await getActiveComposeTabId());
            await generateReplyForCompose(tabId, msg.prompt || "");
            return { ok: true };
          } catch (e) {
            console.error('Generate reply error:', e);
            throw e;
          }

        case "OPEN_OPTIONS":
          try {
            await browser.runtime.openOptionsPage();
            return { ok: true };
          } catch (e) {
            console.error('Primary options open error:', e);
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
              console.error('Fallback options open error:', e2);
              throw e2;
            }
          }
          break;

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
      console.error('Message handling error:', e);
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
if (browser.composeAction && browser.composeAction.onClicked) {
  browser.composeAction.onClicked.addListener(async (tab) => {
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








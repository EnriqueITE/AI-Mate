/* Background script for AI Reply Assistant */

async function getSettings() {
  const {
    openaiApiKey,
    openaiModel,
    openaiTemperature,
    openaiTopP,
    openaiMaxTokens,
    openaiPresencePenalty,
    openaiFrequencyPenalty
  } = await browser.storage.local.get({
    openaiApiKey: "",
    openaiModel: "gpt-4o-mini",
    openaiTemperature: 0.7,
    openaiTopP: 1,
    openaiMaxTokens: null,
    openaiPresencePenalty: 0,
    openaiFrequencyPenalty: 0
  });
  return { openaiApiKey, openaiModel, openaiTemperature, openaiTopP, openaiMaxTokens, openaiPresencePenalty, openaiFrequencyPenalty };
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
        "Write only the reply text. Do not include quoted text, signatures, or placeholders."
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

  async function postWithFallback(payload) {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify(payload)
    });
    if (resp.ok) return resp;
    // Fallback for models that don't support certain params (e.g., gpt-5 temperature)
    if (resp.status === 400) {
      let errJson = null;
      try { errJson = await resp.json(); } catch {}
      const code = errJson?.error?.code || "";
      const param = errJson?.error?.param || "";
      if (code === "unsupported_value") {
        const stripped = { model: payload.model, messages: payload.messages };
        // Keep max_tokens if present, it's commonly supported
        if (typeof payload.max_tokens !== 'undefined') stripped.max_tokens = payload.max_tokens;
        return await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${openaiApiKey}`
          },
          body: JSON.stringify(stripped)
        });
      }
    }
    return resp;
  }

  const resp = await postWithFallback(basePayload);

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

browser.runtime.onMessage.addListener(async (msg) => {
  if (msg && msg.type === "GENERATE_REPLY") {
    try {
      const tabId = msg.tabId || (await getActiveComposeTabId());
      await generateReplyForCompose(tabId, msg.prompt || "");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
  if (msg && msg.type === "OPEN_OPTIONS") {
    try {
      await browser.runtime.openOptionsPage();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
  if (msg && msg.type === "TEST_API_KEY") {
    try {
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
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
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

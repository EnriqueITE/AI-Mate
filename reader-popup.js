/* global DOMPurify */

const summarySection = document.getElementById("summarySection");
const summaryOutput = document.getElementById("summary");
const statusEl = document.getElementById("status");
const summarizeBtn = document.getElementById("summarize");
const copyBtn = document.getElementById("copySummary");
const openSettingsBtn = document.getElementById("openSettings");
const sumSpinner = document.getElementById("sumSpinner");
const NO_API_KEY_MESSAGE = 'No API key set. Click "Open Settings" to configure your OpenAI key.';
const SUMMARIES_DISABLED_MESSAGE = "Message display summaries are turned off. Open Settings to opt in.";

let displayTabId = null;

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function formatSummaryHtml(text) {
  if (!text) return "";

  const escapeHtml = (str) => str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  const formatEmphasis = (input) => {
    let output = input
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/__(.+?)__/g, "<strong>$1</strong>");
    output = output.replace(/(^|[^*])\*(?!\*)([^*\n]+?)\*(?!\*)/g, (match, prefix, content) => `${prefix}<em>${content}</em>`);
    return output;
  };

  const applyInlineFormatting = (input) => {
    const codePlaceholders = [];
    const withCodePlaceholders = input.replace(/`([^`]+?)`/g, (_, code) => {
      const placeholder = `__CODE_PLACEHOLDER_${codePlaceholders.length}__`;
      codePlaceholders.push(code);
      return placeholder;
    });

    let processed = withCodePlaceholders.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safeUrl = (url || "").trim();
      const formattedLabel = formatEmphasis(label);
      if (!/^https?:\/\//i.test(safeUrl)) {
        return formattedLabel;
      }
      const escapedUrl = safeUrl.replace(/"/g, "&quot;");
      return `<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener">${formattedLabel}</a>`;
    });

    processed = formatEmphasis(processed);

    codePlaceholders.forEach((code, index) => {
      const placeholder = new RegExp(`__CODE_PLACEHOLDER_${index}__`, "g");
      processed = processed.replace(placeholder, `<code>${code}</code>`);
    });

    return processed;
  };

  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const htmlParts = [];
  let inList = false;
  let listTag = "";
  let paragraphBuffer = [];

  const closeList = () => {
    if (inList) {
      htmlParts.push(`</${listTag}>`);
      inList = false;
      listTag = "";
    }
  };

  const flushParagraph = () => {
    if (!paragraphBuffer.length) return;
    const combined = paragraphBuffer.join(" ").trim();
    if (combined) {
      htmlParts.push(`<p>${applyInlineFormatting(escapeHtml(combined))}</p>`);
    }
    paragraphBuffer = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      flushParagraph();
      closeList();
      continue;
    }

    const headingMatch = rawLine.match(/^\s*(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      flushParagraph();
      closeList();
      const level = Math.min(4, headingMatch[1].length);
      const content = applyInlineFormatting(escapeHtml(headingMatch[2].trim()));
      htmlParts.push(`<h${level} class="summary-heading">${content}</h${level}>`);
      continue;
    }

    const hrMatch = trimmed.match(/^(-{3,}|\*{3,}|_{3,})$/);
    if (hrMatch) {
      flushParagraph();
      closeList();
      htmlParts.push('<hr class="summary-rule">');
      continue;
    }

    const quoteMatch = rawLine.match(/^\s*>\s?(.*)$/);
    if (quoteMatch) {
      flushParagraph();
      closeList();
      const content = applyInlineFormatting(escapeHtml(quoteMatch[1].trim()));
      htmlParts.push(`<blockquote>${content}</blockquote>`);
      continue;
    }

    const ulMatch = rawLine.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      flushParagraph();
      if (!inList || listTag !== "ul") {
        closeList();
        htmlParts.push("<ul>");
        inList = true;
        listTag = "ul";
      }
      const content = applyInlineFormatting(escapeHtml(ulMatch[1].trim()));
      htmlParts.push(`<li>${content}</li>`);
      continue;
    }

    const olMatch = rawLine.match(/^\s*\d+\.\s+(.*)$/);
    if (olMatch) {
      flushParagraph();
      if (!inList || listTag !== "ol") {
        closeList();
        htmlParts.push("<ol>");
        inList = true;
        listTag = "ol";
      }
      const content = applyInlineFormatting(escapeHtml(olMatch[1].trim()));
      htmlParts.push(`<li>${content}</li>`);
      continue;
    }

    closeList();
    paragraphBuffer.push(rawLine.trim());
  }

  flushParagraph();
  closeList();
  return htmlParts.join("");
}

function replaceSummaryContent(target, markup) {
  if (!target) return;
  target.replaceChildren();
  if (!markup) {
    return;
  }
  const sanitized = (typeof DOMPurify !== "undefined" && typeof DOMPurify.sanitize === "function")
    ? DOMPurify.sanitize(markup)
    : markup;
  const template = target.ownerDocument.createElement("template");
  template.innerHTML = sanitized;
  const fragment = target.ownerDocument.createDocumentFragment();
  template.content.childNodes.forEach((node) => {
    fragment.appendChild(target.ownerDocument.importNode(node, true));
  });
  target.replaceChildren(fragment);
}

function setStatus(message, type = "") {
  if (!statusEl) return;
  statusEl.className = "status";
  if (type) statusEl.classList.add(type);
  statusEl.textContent = message || "";
}

function toggleLoading(isLoading) {
  if (summarizeBtn) {
    summarizeBtn.disabled = isLoading;
    summarizeBtn.classList.toggle("loading", isLoading);
  }
  if (sumSpinner) {
    sumSpinner.hidden = !isLoading;
  }
}

function showSummary(text) {
  if (!summarySection || !summaryOutput) return;
  summarySection.hidden = false;
  summaryOutput.classList.remove("error");
  replaceSummaryContent(summaryOutput, formatSummaryHtml(text));
  if (copyBtn) copyBtn.disabled = !text;
}

function showSummaryNotice(message) {
  if (!summarySection || !summaryOutput) return;
  summarySection.hidden = false;
  summaryOutput.classList.remove("error");
  summaryOutput.textContent = message;
  if (copyBtn) copyBtn.disabled = true;
}

function showSummaryError(message) {
  if (!summarySection || !summaryOutput) return;
  summarySection.hidden = false;
  summaryOutput.classList.add("error");
  summaryOutput.textContent = message;
  if (copyBtn) copyBtn.disabled = true;
}

async function fetchSummary(userPrompt = "") {
  let isLoading = false;
  if (summaryOutput) {
    summaryOutput.textContent = "";
  }
  try {
    const stored = await browser.storage.local.get({
      summaryLanguage: "auto",
      openaiApiKey: "",
      enableReaderSummaries: false
    });
    if (!stored.enableReaderSummaries) {
      showSummaryNotice(SUMMARIES_DISABLED_MESSAGE);
      setStatus("Enable message display summaries in Settings to use this feature.", "warn");
      if (summarizeBtn) summarizeBtn.disabled = true;
      return;
    }
    if (!stored.openaiApiKey) {
      showSummaryNotice(NO_API_KEY_MESSAGE);
      setStatus("Add your OpenAI API key in settings to enable summaries.", "warn");
      return;
    }
    toggleLoading(true);
    isLoading = true;
    setStatus("Summarizing...");
    const payload = { type: "SUMMARIZE_DISPLAYED_MESSAGE", prompt: userPrompt, language: stored.summaryLanguage || "auto" };
    if (displayTabId) {
      const numericId = Number(displayTabId);
      if (Number.isFinite(numericId) && numericId > 0) {
        payload.tabId = numericId;
      }
    }
    const res = await browser.runtime.sendMessage(payload);
    if (!res || !res.ok || !res.summary) {
      throw new Error(res?.error || "Unknown error");
    }
    showSummary(res.summary);
    setStatus("Summary ready.", "ok");
  } catch (err) {
    const message = err?.message || String(err);
    showSummaryError(`Error: ${message}`);
    setStatus("Failed to summarize.", "error");
  } finally {
    if (isLoading) {
      toggleLoading(false);
    }
  }
}

async function copySummaryToClipboard() {
  if (!summaryOutput) return;
  const text = summaryOutput.innerText?.trim();
  if (!text) return;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setStatus("Summary copied to clipboard.", "ok");
  } catch (err) {
    setStatus(`Copy failed: ${err?.message || err}`, "error");
  }
}

async function openSettings() {
  setStatus("Opening settings...");
  try {
    const res = await browser.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    if (!res || !res.ok) {
      throw new Error(res?.error || "Unknown error");
    }
    setStatus(res.fallback ? "Settings opened in a new tab." : "Settings opened.", "ok");
  } catch (err) {
    setStatus(`Failed to open settings: ${err?.message || err}`, "error");
  }
}

async function initializeReaderPopup() {
  try {
    const stored = await browser.storage.local.get({
      enableReaderSummaries: false,
      autoSummariesOnOpen: false,
      openaiApiKey: ""
    });
    const featureEnabled = !!stored.enableReaderSummaries;
    if (summarizeBtn) summarizeBtn.disabled = !featureEnabled;
    if (!featureEnabled) {
      showSummaryNotice(SUMMARIES_DISABLED_MESSAGE);
      setStatus("Enable message display summaries in Settings to opt in.", "warn");
      return;
    }
    if (!stored.openaiApiKey) {
      showSummaryNotice(NO_API_KEY_MESSAGE);
      setStatus("Add your OpenAI API key in settings to enable summaries.", "warn");
      return;
    }
    if (stored.autoSummariesOnOpen) {
      await fetchSummary("");
    } else {
      setStatus("Click Summarize to send this email to OpenAI.", "");
    }
  } catch (err) {
    console.error("AI Mate: failed to initialize reader popup", err);
    setStatus(`Failed to load settings: ${err?.message || err}`, "error");
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  displayTabId = getQueryParam("tabId");
  if (summarizeBtn) summarizeBtn.addEventListener("click", () => fetchSummary(""));
  if (copyBtn) copyBtn.addEventListener("click", copySummaryToClipboard);
  if (openSettingsBtn) openSettingsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });
  await initializeReaderPopup();
});

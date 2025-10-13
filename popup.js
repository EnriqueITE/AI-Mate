// Persist last prompt for convenience
const LAST_PROMPT_KEY = "lastPrompt";
const NO_API_KEY_MESSAGE = "No API key set. Click 'Open Settings' to configure.";
let composeTabId = null;

const summarySection = document.getElementById("summarySection");
const summaryOutput = document.getElementById("summary");
const summarizeBtn = document.getElementById("summarize");
const sumSpinner = document.getElementById("sumSpinner");
const clearSummaryBtn = document.getElementById("clearSummary");

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
  if (!markup) {
    target.replaceChildren();
    return;
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${markup}</div>`, "text/html");
  const fragment = document.createDocumentFragment();
  const container = doc.body.firstElementChild || doc.body;
  const nodes = Array.from(container.childNodes);
  nodes.forEach((node) => {
    fragment.appendChild(target.ownerDocument.importNode(node, true));
  });
  target.replaceChildren(fragment);
}

function setSummaryLayout(expanded) {
  if (!document.body) return;
  document.body.classList.toggle("show-summary", expanded);
}

function clearSummary(hide = true) {
  if (!summarySection || !summaryOutput) return;
  summaryOutput.replaceChildren();
  summaryOutput.classList.remove("error");
  if (hide) {
    summarySection.hidden = true;
    setSummaryLayout(false);
  }
  if (clearSummaryBtn) clearSummaryBtn.disabled = true;
}

function showSummaryMessage(text) {
  if (!summarySection || !summaryOutput) return;
  summarySection.hidden = false;
  setSummaryLayout(true);
  summaryOutput.classList.remove("error");
  summaryOutput.textContent = text;
  if (clearSummaryBtn) clearSummaryBtn.disabled = true;
}

function renderSummary(text, isError = false) {
  if (!summarySection || !summaryOutput) return;
  summarySection.hidden = false;
  setSummaryLayout(!isError);
  if (isError) {
    summaryOutput.textContent = text;
    summaryOutput.classList.add("error");
  } else {
    summaryOutput.classList.remove("error");
    replaceSummaryContent(summaryOutput, formatSummaryHtml(text));
  }
  if (clearSummaryBtn) clearSummaryBtn.disabled = false;
}
function toggleSummarizeState(isLoading) {
  if (summarizeBtn) {
    summarizeBtn.disabled = isLoading;
    summarizeBtn.classList.toggle("loading", isLoading);
  }
  if (sumSpinner) {
    sumSpinner.style.display = isLoading ? "inline-block" : "none";
  }
}

async function onSummarize() {
  toggleSummarizeState(true);
  try {
    const stored = await browser.storage.local.get({ summaryLanguage: "auto", openaiApiKey: "" });
    if (!stored.openaiApiKey) {
      showSummaryMessage(NO_API_KEY_MESSAGE);
      return;
    }
    showSummaryMessage("Summarizing...");
    const payload = { type: "SUMMARIZE_EMAIL", language: stored.summaryLanguage || "auto" };
    if (composeTabId) payload.tabId = Number(composeTabId);
    const result = await browser.runtime.sendMessage(payload);
    if (!result || !result.ok || !result.summary) {
      throw new Error(result?.error || "Unknown error");
    }
    renderSummary(result.summary);
  } catch (e) {
    renderSummary(`Error: ${e.message || e}`, true);
  } finally {
    toggleSummarizeState(false);
  }
}

async function onGenerate() {
  const btn = document.getElementById("generate");
  const prompt = document.getElementById("prompt").value.trim();
  const status = document.getElementById("status");
  const spinner = document.getElementById("genSpinner");
  clearSummary();
  btn.disabled = true;
  btn.classList.add("loading");
  spinner.style.display = "inline-block";
  status.className = "status";
  status.textContent = "Generating reply...";
  try {
    const payload = {
      type: "GENERATE_REPLY",
      prompt
    };
    if (composeTabId) payload.tabId = Number(composeTabId);
    const result = await browser.runtime.sendMessage(payload);
    if (!result || !result.ok) {
      throw new Error(result?.error || "Unknown error");
    }
    status.classList.add("ok");
    status.textContent = "Reply inserted.";
    await browser.storage.local.set({ [LAST_PROMPT_KEY]: prompt });
    setTimeout(() => window.close(), 600);
  } catch (e) {
    status.classList.add("error");
    status.textContent = `Error: ${e.message || e}`;
  } finally {
    btn.disabled = false;
    btn.classList.remove("loading");
    spinner.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  if (document.documentElement) document.documentElement.setAttribute("dir", "rtl");
  if (document.body) {
    document.body.classList.add("open-left");
    document.body.classList.remove("show-summary");
  }
  composeTabId = getQueryParam("tabId");
  if (!composeTabId) {
    try {
      const tabs = await browser.tabs.query({});
      const t = tabs.find((tb) => tb.type === "messageCompose" && tb.active) || tabs.find((tb) => tb.type === "messageCompose");
      if (t && t.id) composeTabId = String(t.id);
    } catch {}
  }
  const generateBtn = document.getElementById("generate");
  if (generateBtn) generateBtn.addEventListener("click", onGenerate);
  if (summarizeBtn) summarizeBtn.addEventListener("click", onSummarize);
  if (clearSummaryBtn) clearSummaryBtn.addEventListener("click", () => clearSummary(true));
  clearSummary();

  const openOptionsBtn = document.getElementById("openOptions");
  if (openOptionsBtn) {
    openOptionsBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      const status = document.getElementById("status");
      status.className = "status";
      status.textContent = "Opening settings...";
      try {
        const res = await browser.runtime.sendMessage({ type: "OPEN_OPTIONS" });
        if (!res || !res.ok) {
          throw new Error(res?.error || "Unknown error");
        }
        status.classList.add("ok");
        status.textContent = res.fallback ? "Settings opened in a new tab." : "Settings opened.";
      } catch (err) {
        status.classList.add("error");
        status.textContent = `Failed to open settings: ${err?.message || err}`;
      }
    });
  }

  try {
    const stored = await browser.storage.local.get({ [LAST_PROMPT_KEY]: "", openaiApiKey: "" });
    document.getElementById("prompt").value = stored[LAST_PROMPT_KEY] || "";
    if (!stored.openaiApiKey) {
      const warn = document.getElementById("warning");
      warn.classList.add("error");
      warn.textContent = NO_API_KEY_MESSAGE;
    }
  } catch {}

  const ta = document.getElementById("prompt");
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onGenerate();
    }
  });
});







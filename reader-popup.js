const summarySection = document.getElementById("summarySection");
const summaryOutput = document.getElementById("summary");
const statusEl = document.getElementById("status");
const summarizeBtn = document.getElementById("summarize");
const copyBtn = document.getElementById("copySummary");
const openSettingsBtn = document.getElementById("openSettings");
const sumSpinner = document.getElementById("sumSpinner");

let displayTabId = null;

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

function formatSummaryHtml(text) {
  if (!text) return "";
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const bulleted = bolded.replace(/(^|\n)-\s+/g, (match, prefix) => `${prefix}&bull; `);
  return bulleted.replace(/\r?\n/g, '<br>');
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
  summaryOutput.innerHTML = formatSummaryHtml(text);
  if (copyBtn) copyBtn.disabled = !text;
}

function showSummaryError(message) {
  if (!summarySection || !summaryOutput) return;
  summarySection.hidden = false;
  summaryOutput.classList.add("error");
  summaryOutput.textContent = message;
  if (copyBtn) copyBtn.disabled = true;
}

async function fetchSummary(userPrompt = "") {
  toggleLoading(true);
  setStatus("Summarizing...");
  if (summaryOutput) {
    summaryOutput.textContent = "";
  }
  try {
    const stored = await browser.storage.local.get({ summaryLanguage: "auto" });
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
    toggleLoading(false);
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

document.addEventListener("DOMContentLoaded", async () => {
  displayTabId = getQueryParam("tabId");
  if (summarizeBtn) summarizeBtn.addEventListener("click", () => fetchSummary(""));
  if (copyBtn) copyBtn.addEventListener("click", copySummaryToClipboard);
  if (openSettingsBtn) openSettingsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    openSettings();
  });
  fetchSummary();
});

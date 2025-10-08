// Persist last prompt for convenience
const LAST_PROMPT_KEY = "lastPrompt";
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
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const bolded = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  const bulleted = bolded.replace(/(^|\n)-\s+/g, (match, prefix) => prefix + '&bull; ');
  return bulleted.replace(/\r?\n/g, '<br>');
}

function setSummaryLayout(expanded) {
  if (!document.body) return;
  document.body.classList.toggle("show-summary", expanded);
}

function clearSummary(hide = true) {
  if (!summarySection || !summaryOutput) return;
  summaryOutput.innerHTML = "";
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
    summaryOutput.innerHTML = formatSummaryHtml(text);
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
  showSummaryMessage("Summarizing...");
  try {
    const stored = await browser.storage.local.get({ summaryLanguage: "auto" });
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
      warn.textContent = "No API key set. Click 'Open Settings' to configure.";
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







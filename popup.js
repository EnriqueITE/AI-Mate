// Persist last prompt for convenience
const LAST_PROMPT_KEY = "lastPrompt";
let composeTabId = null;

function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

async function onGenerate() {
  const btn = document.getElementById("generate");
  const prompt = document.getElementById("prompt").value.trim();
  const status = document.getElementById("status");
  const spinner = document.getElementById("genSpinner");
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
    // Save last prompt
    await browser.storage.local.set({ [LAST_PROMPT_KEY]: prompt });
    // Give a moment so users can read confirmation, then close
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
  composeTabId = getQueryParam("tabId");
  // Try to detect compose tab id in case the popup is integrated and no query param is provided
  if (!composeTabId) {
    try {
      const tabs = await browser.tabs.query({});
      const t = tabs.find((tb) => tb.type === "messageCompose" && tb.active) || tabs.find((tb) => tb.type === "messageCompose");
      if (t && t.id) composeTabId = String(t.id);
    } catch {}
  }
  document.getElementById("generate").addEventListener("click", onGenerate);
  document.getElementById("openOptions").addEventListener("click", async (e) => {
    e.preventDefault();
    const status = document.getElementById("status");
    status.className = "status";
    status.textContent = "Opening settings...";
    const res = await browser.runtime.sendMessage({ type: "OPEN_OPTIONS" });
    if (!res || !res.ok) {
      status.classList.add("error");
      status.textContent = `Failed to open settings: ${res?.error || "Unknown"}`;
    } else {
      status.classList.add("ok");
      status.textContent = "Settings opened.";
    }
  });

  // Load last prompt for convenience
  try {
    const stored = await browser.storage.local.get({ [LAST_PROMPT_KEY]: "", openaiApiKey: "" });
    document.getElementById("prompt").value = stored[LAST_PROMPT_KEY] || "";
    if (!stored.openaiApiKey) {
      const warn = document.getElementById("warning");
      warn.classList.add("error");
      warn.textContent = "No API key set. Click 'Open Settings' to configure.";
    }
  } catch {}

  // Keyboard shortcuts: Enter to generate, Shift+Enter for newline
  const ta = document.getElementById("prompt");
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onGenerate();
    }
  });
});

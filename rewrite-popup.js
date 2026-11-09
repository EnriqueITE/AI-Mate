/* Additive selection workflow: existing whole-draft actions keep their behavior. */
"use strict";
let rewriteToken = null, rewriteText = "", rewriteBusy = false, rewritePort = null;
const rewriteElement = (id) => document.getElementById(id);

function updateRewriteControls() {
  const hasPreview = !rewriteElement("rewritePreview").hidden;
  document.body.classList.toggle("reviewing-rewrite", hasPreview);
  const busy = rewriteBusy || generationInProgress || composeActionState.busy;
  rewriteElement("draftControls").hidden = hasPreview;
  rewriteElement("rewriteControls").hidden = !composeActionState.canRewrite && !hasPreview;
  rewriteElement("rewriteReason").textContent = composeActionState.rewriteReason || "";
  rewriteElement("rewriteReason").hidden = !!composeActionState.canRewrite || hasPreview;
  for (const id of ["rewrite", "rewriteStyle", "rewriteInstruction", "applyRewrite", "regenerateRewrite", "copyRewrite", "cancelRewrite"]) rewriteElement(id).disabled = busy;
  rewriteElement("rewrite").hidden = hasPreview;
  if (busy || hasPreview) for (const id of ["generate", "improve", "undo", "summarize"]) rewriteElement(id).disabled = true;
}

async function runRewrite() {
  if (rewriteBusy || generationInProgress || composeActionState.busy || !composeTabId) return;
  const token = rewriteToken || composeActionState.token;
  if (!token) return;
  rewriteToken = token;
  if (closeTimer !== null) { clearTimeout(closeTimer); closeTimer = null; }
  rewriteBusy = true;
  updateRewriteControls();
  const status = rewriteElement("status");
  status.className = "status"; status.textContent = "Rewriting selection…";
  try {
    const result = await browser.runtime.sendMessage(composePayload("REWRITE_SELECTION", {
      token, style: rewriteElement("rewriteStyle").value, instruction: rewriteElement("rewriteInstruction").value
    }));
    if (!result?.ok) throw new Error(result?.error || "The selection could not be rewritten.");
    rewriteText = result.text;
    rewriteElement("rewriteOriginal").textContent = result.original;
    rewriteElement("rewriteResult").textContent = result.text;
    rewriteElement("rewritePreview").hidden = false;
    status.textContent = "Review the rewrite before replacing your selection.";
  } catch (error) {
    rewriteText = "";
    rewriteToken = null;
    rewriteElement("rewritePreview").hidden = true;
    status.className = "status error"; status.textContent = error.message;
  } finally { rewriteBusy = false; updateComposeControls(); updateRewriteControls(); }
}

async function applyRewrite() {
  if (rewriteBusy || !rewriteToken || !rewriteText) return;
  rewriteBusy = true; updateRewriteControls();
  try {
    const result = await browser.runtime.sendMessage(composePayload("APPLY_REWRITE", { token: rewriteToken }));
    if (!result?.ok) throw new Error(result?.error || "The selection could not be replaced.");
    clearRewritePreview();
    rewriteElement("status").className = "status ok";
    rewriteElement("status").textContent = "Selection replaced. Undo last change restores the original formatting.";
    await refreshComposeActionState();
  } catch (error) {
    rewriteElement("status").className = "status error";
    rewriteElement("status").textContent = error.message;
  } finally { rewriteBusy = false; updateComposeControls(); updateRewriteControls(); }
}

function clearRewritePreview() {
  rewriteToken = null; rewriteText = "";
  rewriteElement("rewritePreview").hidden = true;
  rewriteElement("rewriteOriginal").textContent = "";
  rewriteElement("rewriteResult").textContent = "";
}

async function cancelRewrite() {
  if (rewriteBusy) return;
  if (rewriteToken) await browser.runtime.sendMessage(composePayload("DISCARD_REWRITE", { token: rewriteToken }));
  clearRewritePreview();
  await refreshComposeActionState();
  updateRewriteControls();
  rewriteElement("status").textContent = "Rewrite cancelled. The email was not changed.";
}

document.addEventListener("DOMContentLoaded", async () => {
  rewriteElement("rewrite").addEventListener("click", runRewrite);
  rewriteElement("regenerateRewrite").addEventListener("click", runRewrite);
  rewriteElement("applyRewrite").addEventListener("click", applyRewrite);
  rewriteElement("cancelRewrite").addEventListener("click", () => cancelRewrite().catch(() => {}));
  rewriteElement("copyRewrite").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(rewriteText); rewriteElement("status").textContent = "Rewrite copied."; }
    catch { rewriteElement("status").textContent = "Could not copy the rewrite. Select and copy it manually."; }
  });
  const stored = await browser.storage.local.get({ rewriteStyle: "paraphrase" }).catch(() => ({ rewriteStyle: "paraphrase" }));
  rewriteElement("rewriteStyle").value = RewriteCore.normalizeStyle(stored.rewriteStyle);
  rewriteElement("rewriteStyle").addEventListener("change", async () => {
    try { await browser.storage.local.set({ rewriteStyle: RewriteCore.normalizeStyle(rewriteElement("rewriteStyle").value) }); }
    catch { rewriteElement("status").textContent = "The rewrite style could not be saved."; }
  });
  updateRewriteControls();
});

function refreshRewriteLease() {
  if (composeTabId && !rewritePort) rewritePort = browser.runtime.connect({ name: `rewrite:${composeTabId}` });
  updateRewriteControls();
}

"""Run an isolated, offline Thunderbird profile with a fixture-only QA extension.
No production profile, mailbox, credentials or real OpenAI requests are used.
"""
import hashlib
import http.server
import json
import pathlib
import subprocess
import threading
import time
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
VERSION = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["version"]
QA = ROOT / "dist" / (f"qa-{VERSION}-" + time.strftime("%Y%m%d-%H%M%S"))
PROFILE = QA / "profile"
(PROFILE / "extensions").mkdir(parents=True)
results = []
done = threading.Event()


class Reporter(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        results.append(data)
        (QA / "report.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(json.dumps(data), flush=True)
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")
        if data.get("done"):
            done.set()

    def log_message(self, *args):
        pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Reporter)
endpoint = f"http://127.0.0.1:{server.server_port}/"
threading.Thread(target=server.serve_forever, daemon=True).start()
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
manifest["browser_specific_settings"]["gecko"]["id"] = "ai-mate-qa@local.test"
manifest["permissions"].append("http://127.0.0.1/*")
manifest["permissions"].append("accountsRead")
manifest["background"]["scripts"].insert(0, "qa-bootstrap.js")
manifest["background"]["scripts"].append("qa-run.js")

bootstrap = r'''
const realFetch = globalThis.fetch.bind(globalThis);
const qaPayloads = [];
globalThis.fetch = async (url, options) => {
  if (String(url) === "https://api.openai.com/v1/chat/completions") {
    qaPayloads.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: { content: "Rewritten selection." } }] }) };
  }
  if (!String(url).startsWith(REPORT_URL)) throw new Error("QA blocked outbound request");
  return realFetch(url, options);
};
const qaReport = (value) => realFetch(REPORT_URL, {method: "POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(value)});
'''.replace("REPORT_URL", json.dumps(endpoint))

runner = r'''
const qaDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const qaAssert = (value, message) => { if (!value) throw new Error(message); };
async function qaSelect(tabId, selector, start = 0, end = null) {
  return browser.tabs.executeScript(tabId, { code: `(() => {
    const node = document.querySelector(${JSON.stringify(selector)}).firstChild;
    const range = document.createRange(); range.setStart(node, ${start}); range.setEnd(node, ${end === null ? "node.length" : end});
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return {text: selection.toString(), editable: document.body.isContentEditable, command: document.queryCommandSupported('insertText')};
  })()` });
}
async function runNativeQA() {
  const opened = [];
  async function openToolbar(tab, mode) {
    await browser.storage.local.remove("qaPopupResult");
    await browser.storage.local.set({qaPopupMode:mode});
    await browser.windows.update(tab.windowId, {focused:true});
    qaAssert(await browser.composeAction.openPopup({windowId:tab.windowId}), "Toolbar popup did not open");
    let result;
    for(let tries=0; tries<100; tries++) { await qaDelay(100); result=(await browser.storage.local.get("qaPopupResult")).qaPopupResult; if(result) break; }
    qaAssert(result?.ok, "Native popup: " + JSON.stringify(result));
    return result;
  }
  try {
    await qaReport({stage: "started", version: (await browser.runtime.getBrowserInfo()).version});
    await selectionReady;
    await browser.storage.local.set({ openaiApiKey: "offline-qa-fixture", openaiModel: "gpt-6-luna" });
    for (const isPlainText of [false, true]) {
      const tab = await browser.compose.beginNew({ identityId: "id1", isPlainText,
        ...(isPlainText ? { plainTextBody: "Before selected text after.\n\nOutside paragraph." } : { body: '<p>Before <b>selected text</b> after.</p><p id="outside">Outside paragraph.</p><div class="moz-signature">QA signature</div><blockquote>QA quote</blockquote>' }) });
      opened.push(tab.id);
      await qaDelay(600);
      await injectSelectionEditor(tab.id);
      const original = await browser.compose.getComposeDetails(tab.id);
      await qaReport({stage:"original", isPlainText, html: original.body});
      const selection = isPlainText
        ? await browser.tabs.executeScript(tab.id, { code: `(() => { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); let node; while(node = walker.nextNode()) { const i = node.data.indexOf('selected text'); if(i >= 0) { const r=document.createRange(); r.setStart(node,i); r.setEnd(node,i+13); const s=getSelection(); s.removeAllRanges(); s.addRange(r); return s.toString(); } } throw new Error('No plain text fixture'); })()` })
        : await qaSelect(tab.id, "b");
      await qaReport({stage: "selected", isPlainText, selection});
      const state = await getComposeActionState(tab.id);
      qaAssert(state.canRewrite, JSON.stringify(state));
      const preview = await generateSelectionPreview(tab.id, state.token, "formal", "");
      const beforeApply = await browser.compose.getComposeDetails(tab.id);
      qaAssert(ReplyCore.snapshot(original) === ReplyCore.snapshot(beforeApply), "Preview changed compose");
      qaAssert(!JSON.stringify(qaPayloads.at(-1)).includes("Outside paragraph"), "Unselected context was sent");
      await applySelectionPreview(tab.id, state.token);
      const applied = await browser.compose.getComposeDetails(tab.id);
      const content = isPlainText ? applied.plainTextBody : applied.body;
      qaAssert(content.includes("Rewritten selection."), "Missing replacement: " + content);
      qaAssert(content.includes("Before") && content.includes("after.") && content.includes("Outside paragraph"), "Outside text lost");
      if (!isPlainText) qaAssert(content.includes("</b> after."), "Native whitespace cleanup changed unselected text");
      const undoState = await getComposeActionState(tab.id);
      await qaReport({stage:"applied", isPlainText, canUndo:undoState.canUndo, reason:undoState.undoReason, html: applied.body});
      qaAssert(undoState.canUndo, undoState.undoReason);
      if (!isPlainText) await browser.tabs.executeScript(tab.id, {code: 'document.getElementById("outside").textContent = "Later outside edit.";'});
      await undoLastReplyForCompose(tab.id);
      const restored = await browser.compose.getComposeDetails(tab.id);
      if (isPlainText) qaAssert(restored.plainTextBody === original.plainTextBody, "Plain undo not exact");
      else qaAssert(restored.body === original.body.replace("Outside paragraph.", "Later outside edit."), "HTML undo not exact: " + restored.body);
      await qaReport({stage:"rewrite-and-undo-passed", isPlainText});
      // Existing draft actions, using real compose APIs and simulated completion.
      await generateReplyForCompose(tab.id, "", "natural", "normal", "improve");
      await undoLastReplyForCompose(tab.id);
      await generateReplyForCompose(tab.id, "", "natural", "normal", "generate");
      await undoLastReplyForCompose(tab.id);
      qaAssert(ReplyCore.snapshot(await browser.compose.getComposeDetails(tab.id)) === ReplyCore.snapshot(restored), "Existing actions failed to restore original");
      await qaReport({stage:"existing-actions-passed", isPlainText});
      // The compose API replaces the body element. Capture and rewrite again
      // after those existing operations, not just in a freshly opened editor.
      if (!isPlainText) {
        await browser.compose.setComposeDetails(tab.id, {body:'<p>Start <b>selected first</b> tail</p><p id="second">second ending</p><p id="outside">Outside</p><div class="moz-signature">Signature</div>'});
        await browser.tabs.executeScript(tab.id, {code:`(() => {const r=document.createRange();r.setStart(document.querySelector('b').firstChild,0);r.setEnd(document.getElementById('second').firstChild,6);const s=getSelection();s.removeAllRanges();s.addRange(r);})()`});
        const before = await browser.compose.getComposeDetails(tab.id);
        const current = await getComposeActionState(tab.id);
        qaAssert(current.canRewrite, "Selection unavailable after body replacement");
        await generateSelectionPreview(tab.id,current.token,"direct","");
        await applySelectionPreview(tab.id,current.token);
        const after = await getComposeActionState(tab.id);
        qaAssert(after.canUndo, "Cross-paragraph undo unavailable: " + after.undoReason);
        await undoLastReplyForCompose(tab.id);
        qaAssert((await browser.compose.getComposeDetails(tab.id)).body === before.body, "Cross-paragraph undo did not restore formatting");
        await qaReport({stage:"cross-paragraph-after-body-replacement-passed"});
      }
      if (!isPlainText) await qaSelect(tab.id,"b");
      else await browser.tabs.executeScript(tab.id, {code:`(() => {const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){let i=n.data.indexOf('selected text');if(i>=0){const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+13);const s=getSelection();s.removeAllRanges();s.addRange(r);return;}}})()`});
      await getComposeActionState(tab.id);
      const popupResult = await openToolbar(tab, "rewrite");
      await qaReport({stage:"native-popup-buttons-passed",isPlainText,...popupResult});
      // Reopen the actual toolbar panel with no selection, use its original
      // Generate Reply button, then verify native insertion and restoration.
      await browser.compose.setComposeDetails(tab.id, isPlainText ? {plainTextBody:"Original draft."} : {body:"<p>Original draft.</p>"});
      await browser.tabs.executeScript(tab.id,{code:"getSelection().removeAllRanges();"});
      const draftBefore = await browser.compose.getComposeDetails(tab.id);
      const generated = await openToolbar(tab,"generate");
      qaAssert((await browser.compose.getComposeDetails(tab.id)).body.includes("Rewritten selection."), "Generate Reply button did not insert its completion");
      await undoLastReplyForCompose(tab.id);
      qaAssert(ReplyCore.snapshot(await browser.compose.getComposeDetails(tab.id)) === ReplyCore.snapshot(draftBefore), "Generated reply undo failed");
      await qaReport({stage:"toolbar-generate-no-selection-passed",isPlainText,...generated});
      const settings = await openToolbar(tab,"settings");
      let optionsTab;
      for(let tries=0; tries<100; tries++) {
        optionsTab=(await browser.tabs.query({})).find(t=>t.url?.startsWith(browser.runtime.getURL("options.html")));
        if(optionsTab) break;
        await qaDelay(100);
      }
      qaAssert(optionsTab,"Open Settings button did not open the options page");
      await browser.tabs.remove(optionsTab.id);
      await qaReport({stage:"toolbar-open-settings-passed",isPlainText,...settings});
      if(isPlainText) {
        for(const [plainTextBody,target] of [
          ["Draft.\n\n> Original quoted sentence.","Original quoted"],
          ["Draft.\n\n-- \nName and signature.","Name and signature"]
        ]) {
          await browser.compose.setComposeDetails(tab.id,{plainTextBody});
          await browser.tabs.executeScript(tab.id,{code:`(() => {
            const target=${JSON.stringify(target)};
            const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
            let n;while(n=walker.nextNode()) { const i=n.data.indexOf(target);if(i>=0){
              const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+target.length);
              const s=getSelection();s.removeAllRanges();s.addRange(r);return;
            }}throw new Error('Protected text fixture missing');
          })()`});
          const requestsBefore=qaPayloads.length;
          const blocked=await getComposeActionState(tab.id);
          qaAssert(!blocked.canRewrite && /signatures|quoted/.test(blocked.rewriteReason),"Plain signature/quote selection was accepted: "+JSON.stringify(blocked));
          qaAssert(qaPayloads.length===requestsBefore,"Blocked selection sent a request");
          await qaSelect(tab.id,"body",0,5);
          qaAssert((await getComposeActionState(tab.id)).canRewrite,"Authored text before plain protected section was blocked");
        }
        await qaReport({stage:"plain-signature-and-quote-selections-blocked"});
      }
    }
    await qaReport({done:true, ok:true, requests:qaPayloads.length});
  } catch (error) {
    await qaReport({done:true, ok:false, error:String(error), stack:error.stack});
  } finally {
    for(const id of opened) await browser.tabs.remove(id).catch(() => {});
  }
}
setTimeout(runNativeQA, 1500);
'''

files = ["manifest.json", "reply-core.js", "model-config.js", "rewrite-core.js", "selection-editor.js", "background.js", "popup.html", "popup.js", "rewrite-popup.js", "popup.css", "options.html", "options.js", "reader-popup.html", "reader-popup.js", "reader-popup.css", "Logo.png"]
files += [str(p.relative_to(ROOT)).replace("\\", "/") for p in (ROOT / "icons").glob("*.png")]
files += ["lib/dompurify.min.js"]
popup_driver = r'''
document.addEventListener("DOMContentLoaded", async () => {
  const pause = () => new Promise(resolve => setTimeout(resolve, 40));
  const wait = async (check, label) => { for(let n=0;n<100;n++){if(check())return;await pause();}throw new Error(label); };
  const e = id => document.getElementById(id);
  const footerChecks = [];
  const checkFooter = (state, lastAction) => {
    const footer = document.querySelector(".support-footer");
    const content = document.querySelector(".container");
    const link = footer?.querySelector("a.support-link");
    if (!link || link.textContent.trim() !== "Buy me a coffee" || link.href !== "https://buymeacoffee.com/enriqueite") throw new Error("Support footer/link missing");
    const rect = footer.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    if(rect.height <= 0 || rect.top < 0 || rect.bottom > innerHeight + 1 || innerHeight - rect.bottom > 1) throw new Error("Support footer is not visible at the bottom: " + state);
    if(contentRect.bottom > rect.top + 1) throw new Error("Support footer overlaps scrollable content: " + state);
    if(linkRect.top < rect.top || linkRect.bottom > rect.bottom || linkRect.left < 0 || linkRect.right > innerWidth) throw new Error("Support link is clipped: " + state);
    const hit = document.elementFromPoint(linkRect.x + linkRect.width / 2, linkRect.y + linkRect.height / 2);
    if(!link.contains(hit)) throw new Error("Support link is obscured: " + state);
    // Scroll the final action into view and ensure the fixed footer cannot hide
    // it. Restore scroll position so the test still opens at the normal top.
    const scrollTop = content.scrollTop;
    const action = e(lastAction);
    action.scrollIntoView({block:"nearest"});
    const actionRect = action.getBoundingClientRect();
    if(actionRect.top < contentRect.top || actionRect.bottom > rect.top + 1) throw new Error("Footer obscures the final action: " + state);
    content.scrollTop = scrollTop;
    footerChecks.push({state,top:rect.top,bottom:rect.bottom,linkVisible:true,contentSeparated:true});
  };
  try {
    const {qaPopupMode:mode} = await browser.storage.local.get("qaPopupMode");
    await wait(() => !e("generate").disabled && (mode !== "rewrite" || (!e("rewriteControls").hidden && !e("rewrite").disabled)), "popup actions unavailable");
    await new Promise(resolve => setTimeout(resolve, 350));
    const rect = e("generate").getBoundingClientRect();
    const geometry = {width:innerWidth,height:innerHeight,generateTop:rect.top,generateBottom:rect.bottom};
    if(innerHeight < 350 || rect.top < 0 || rect.bottom > innerHeight) throw new Error("Toolbar popup clipped: " + JSON.stringify(geometry));
    const settingsRect = e("openOptions").getBoundingClientRect();
    if(settingsRect.top < 0 || settingsRect.bottom > innerHeight || e("openOptions").closest("[hidden]")) throw new Error("Settings is not visible");
    checkFooter(mode === "rewrite" ? "selected-text" : "no-selection", "summarize");
    if(mode !== "rewrite") {
      if(!e("rewriteControls").hidden) throw new Error("Unexpected selection in original reply mode");
      if(mode === "settings") {
        await browser.storage.local.set({qaPopupResult:{ok:true,geometry,footerChecks,stages:["settings-visible"]}});
        e("openOptions").click();
      } else {
        e("generate").click();
        await wait(() => e("status").textContent === "Reply inserted.","Generate Reply failed: " + e("status").textContent);
        await browser.storage.local.set({qaPopupResult:{ok:true,geometry,footerChecks,stages:["generate-reply"]}});
        window.close();
      }
      return;
    }
    e("rewriteStyle").value="direct";
    e("rewrite").click();
    await wait(() => !e("rewritePreview").hidden && !e("applyRewrite").disabled,"no native preview");
    if (!e("rewriteOriginal").textContent || e("rewriteResult").textContent!=="Rewritten selection.") throw new Error("incorrect preview");
    if(e("openOptions").closest("[hidden]")) throw new Error("Settings disappeared during preview");
    checkFooter("rewrite-preview", "cancelRewrite");
    e("regenerateRewrite").click();
    await wait(() => !e("regenerateRewrite").disabled,"regeneration stuck");
    e("applyRewrite").click();
    await wait(() => e("rewritePreview").hidden && !e("undo").disabled,"native apply or undo state failed: "+e("status").textContent);
    e("undo").click();
    await wait(() => e("status").textContent === "Last change undone.","native undo button failed: "+e("status").textContent);
    checkFooter("after-undo", "summarize");
    await browser.storage.local.set({qaPopupResult:{ok:true,geometry,footerChecks,stages:["preview","regenerate","replace","undo"]}});
    window.close();
  } catch(error) {await browser.storage.local.set({qaPopupResult:{ok:false,error:String(error)}});}
});
'''
with zipfile.ZipFile(PROFILE / "extensions" / "ai-mate-qa@local.test.xpi", "w", zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        if file == "manifest.json":
            content = json.dumps(manifest)
        elif file == "popup.html":
            content = (ROOT / file).read_text(encoding="utf-8").replace('</body>', '<script src="qa-popup.js"></script></body>')
        else:
            content = (ROOT / file).read_bytes()
        archive.writestr(file, content)
    archive.writestr("qa-bootstrap.js", bootstrap)
    archive.writestr("qa-run.js", runner)
    archive.writestr("qa-popup.js", popup_driver)

prefs = {
    "extensions.autoDisableScopes": 0, "extensions.enabledScopes": 15,
    "extensions.update.enabled": False, "app.update.auto": False,
    "mail.shell.checkDefaultClient": False, "mailnews.start_page.enabled": False,
    "mail.provider.enabled": False, "mail.accountmanager.accounts": "account1",
    "mail.accountmanager.defaultaccount": "account1", "mail.account.account1.server": "server1",
    "mail.account.account1.identities": "id1", "mail.identity.id1.useremail": "qa@example.invalid",
    "mail.identity.id1.fullName": "Offline QA", "mail.identity.id1.valid": True,
    "mail.server.server1.type": "none", "mail.server.server1.hostname": "Local Folders",
    "mail.server.server1.name": "Offline QA", "mail.server.server1.userName": "nobody",
    "mail.server.server1.directory": str(PROFILE / "Mail" / "Local Folders"),
    "mail.accountmanager.localfoldersserver": "server1", "mail.spotlight.firstRunDone": True,
    "datareporting.policy.dataSubmissionEnabled": False, "toolkit.telemetry.enabled": False,
}
(PROFILE / "user.js").write_text("\n".join(f"user_pref({json.dumps(k)}, {json.dumps(v)});" for k, v in prefs.items()), encoding="utf-8")
print(f"QA directory: {QA}", flush=True)
startup = subprocess.STARTUPINFO()
startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
startup.wShowWindow = 0
with (QA / "thunderbird.log").open("w", encoding="utf-8") as log:
    proc = subprocess.Popen([r"C:\Program Files\Mozilla Thunderbird\thunderbird.exe", "-no-remote", "-offline", "-headless", "-profile", str(PROFILE)], stdout=log, stderr=log, startupinfo=startup)
    try:
        if not done.wait(90):
            print("QA timeout: inspect isolated profile logs", flush=True)
        time.sleep(1)
    finally:
        # Terminate only this isolated QA instance, never another Thunderbird.
        proc.terminate()
        proc.wait(timeout=20)
server.shutdown()
raise SystemExit(0 if results and results[-1].get("ok") else 1)

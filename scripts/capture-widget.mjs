// Capture the shipped widget HTML/CSS/scripts with offline demonstration data.
// Uses installed Edge and its DevTools protocol; no additional npm dependencies.
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')).version;
const output = path.join(root, 'dist', `screenshots-${version}`);
const profile = path.join(root, 'dist', `screenshot-profile-${Date.now()}`);
await mkdir(output, { recursive: true });
await mkdir(profile, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const html = (await readFile(path.join(root, 'popup.html'), 'utf8'))
  .replace('<head>', `<head><base href="${pathToFileURL(root + path.sep).href}">`)
  .replace('<script src="lib/dompurify.min.js">', `<script src="${pathToFileURL(path.join(output, 'fixture.js')).href}"></script><script src="lib/dompurify.min.js">`);
await writeFile(path.join(output, 'widget.html'), html);
await writeFile(path.join(output, 'fixture.js'), `
const fixtureMode = new URL(location.href).searchParams.get('scene');
window.browser = {
  tabs: {query: async () => [{id:42,type:'messageCompose',active:true}]},
  storage: {local: {get: async defaults => ({...defaults,openaiApiKey:'offline-demo',rewriteStyle:'formal'}),set:async()=>{}}},
  runtime: {connect:()=>({}),sendMessage:async m => {
    if(m.type==='GET_COMPOSE_ACTION_STATE') return {ok:true,canRewrite:fixtureMode!=='reply',token:'demo',canImprove:true,canUndo:false,undoReason:'There is no AI-Mate change to undo in this compose window.',rewriteReason:'Select text in your email to rewrite it.'};
    if(m.type==='REWRITE_SELECTION') return {ok:true,token:'demo',original:"Could you send the revised proposal before Thursday? We need time to review it before Friday's meeting.",text:"Please send the revised proposal before Thursday so that we have time to review it before Friday's meeting. Thank you."};
    throw new Error('This screenshot fixture does not perform external actions.');
  }}
};
window.fetch = async () => {throw new Error('Network requests are disabled in screenshot fixtures.');};
`);

const edge = spawn(process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--disable-background-networking', '--disable-component-update', '--disable-sync',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'
], { windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let port;
  for(let n=0;n<100;n++) {
    try { port=(await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0];break; }
    catch { await pause(100); }
  }
  if(!port) throw new Error('Edge did not expose its isolated DevTools endpoint');
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let sequence=0;
  const pending=new Map();
  socket.addEventListener('message',event=>{
    const value=JSON.parse(event.data);
    const request=pending.get(value.id);
    if(request) {pending.delete(value.id);value.error?request.reject(new Error(JSON.stringify(value.error))):request.resolve(value.result);}
  });
  const call=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>{
    const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor=async expression=>{
    for(let n=0;n<100;n++) {if(await evaluate(expression)) return;await pause(50);}
    throw new Error(`Widget did not reach screenshot state: ${expression}`);
  };
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:400,height:600,deviceScaleFactor:2,mobile:false});
  const captures=[];
  for(const theme of ['dark','light']) {
    await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:theme}]});
    for(const [index,scene] of ['reply','selection','preview'].entries()) {
      await call('Page.navigate',{url:pathToFileURL(path.join(output,'widget.html')).href+`?scene=${scene}`});
      await waitFor(`document.readyState==='complete' && document.getElementById('generate') && !document.getElementById('generate').disabled && typeof composeTabId!=='undefined' && composeTabId===42`);
      if(scene==='preview') {
        await evaluate(`document.getElementById('rewrite').click()`);
        await waitFor(`!document.getElementById('rewritePreview').hidden && !document.getElementById('applyRewrite').disabled`);
      }
      await evaluate(`document.fonts.ready;document.querySelector('.container').scrollTop=0`);
      await pause(100);
      const geometry=await evaluate(`(()=>{const f=document.querySelector('.support-footer').getBoundingClientRect();return {width:innerWidth,height:innerHeight,footerTop:f.top,footerBottom:f.bottom};})()`);
      if(geometry.footerBottom>600 || geometry.footerTop<540) throw new Error('Footer not at the bottom: '+JSON.stringify(geometry));
      const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false,clip:{x:0,y:0,width:400,height:600,scale:1}});
      const name=`0${index+1}-${scene}-${theme}.png`;
      await writeFile(path.join(output,name),Buffer.from(screenshot.data,'base64'));
      captures.push({file:name,...geometry});
    }
  }
  await writeFile(path.join(output,'captures.json'),JSON.stringify({version,renderer:'Microsoft Edge, actual widget assets',demoResponses:true,captures},null,2)+'\n');
  await writeFile(path.join(output,'README.txt'),`AI Mate ${version} — screenshots\n\nSix PNG files at 800 x 1200 pixels: reply, selection, and preview in light/dark themes.\nCaptured directly from the production widget HTML/CSS/JavaScript rendered in Edge with offline demonstration data. These are not screenshots of a Thunderbird window or real model responses.\nThe native Thunderbird toolbar popup is verified separately by scripts/native-qa.py.\nNo email content, API keys, or personal profile data is used.\n`);
  console.log(JSON.stringify({output,captures},null,2));
  await call('Browser.close').catch(()=>{});
} finally {
  socket?.close();
  edge.kill();
}

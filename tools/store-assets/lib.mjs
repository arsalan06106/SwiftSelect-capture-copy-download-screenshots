import puppeteer from 'puppeteer-core';
import http from 'node:http'; import { fileURLToPath, pathToFileURL } from 'node:url'; import fs from 'node:fs'; import path from 'node:path';
export const EXT = fileURLToPath(new URL('../../', import.meta.url));
export const CHROME = process.env.CHROME_PATH || '/usr/bin/google-chrome';
export const SITE = fileURLToPath(new URL('./site/', import.meta.url));
export function serve(port=8765){
  const types={'.html':'text/html','.css':'text/css','.woff2':'font/woff2','.png':'image/png'};
  const srv=http.createServer((q,r)=>{const u=decodeURIComponent(q.url.split('?')[0]);const f=u.startsWith('/fonts/')?path.join(EXT,u):path.join(SITE,u);
    if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){r.writeHead(404);return r.end();}
    r.writeHead(200,{'content-type':types[path.extname(f)]||'application/octet-stream'});fs.createReadStream(f).pipe(r);});
  return new Promise(res=>srv.listen(port,()=>res(srv)));
}
export async function launch({w=1120,h=620,dpr=2,dark=false}={}){
  const browser = await puppeteer.launch({ executablePath:CHROME, headless:true, pipe:true,
    enableExtensions:[EXT], args:['--no-first-run',`--window-size=${w},${h+200}`,'--hide-scrollbars','--force-color-profile=srgb'],
    defaultViewport:{width:w,height:h,deviceScaleFactor:dpr} });
  const swT = await browser.waitForTarget(t=>t.type()==='service_worker');
  const extId = new URL(swT.url()).host;
  const sw = await browser.newPage();
  await sw.goto(`chrome-extension://${extId}/offscreen.html`);
  return {browser, sw, extId};
}
export async function setSettings(sw, s){ await sw.evaluate(s=>chrome.storage.local.set(s), s); }
export async function sendToTab(sw, urlPart, type){
  return sw.evaluate(async (urlPart,type)=>{
    const tabs=await chrome.tabs.query({}); const t=tabs.find(t=>t.url.includes(urlPart));
    await chrome.tabs.update(t.id,{active:true});
    let alive=false; try{alive=!!(await chrome.tabs.sendMessage(t.id,{type:'ss-ping'}))?.pong}catch{}
    if(!alive) await chrome.scripting.executeScript({target:{tabId:t.id},files:['contentScript.js']});
    return chrome.tabs.sendMessage(t.id,{type});
  }, urlPart, type);
}
export const sleep = ms=>new Promise(r=>setTimeout(r,ms));

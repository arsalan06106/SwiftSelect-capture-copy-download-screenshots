import {serve,launch,sendToTab,sleep,setSettings} from './lib.mjs';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url))); fs.mkdirSync('out',{recursive:true});
const steps = (process.argv[2]||'all').split(',');
const want = s => steps.includes('all')||steps.includes(s);
const srv=await serve(); const W=1120,H=620;
const {browser,sw,extId}=await launch({w:W,h:H});
await setSettings(sw,{userTheme:'light', uiColour:'calm'});
const U=p=>`http://localhost:8765/${p}`;
async function open(p,vp={width:W,height:H}){const pg=await browser.newPage();await pg.setViewport({...vp,deviceScaleFactor:2});await pg.goto(U(p),{waitUntil:'networkidle0'});await pg.bringToFront();await sleep(300);return pg;}
const shadowEl = (pg, sel) => pg.evaluateHandle(sel=>document.querySelector('#qs-guide-host').shadowRoot.querySelector(sel), sel);
const rectOf = (pg, sel) => pg.evaluate(sel=>{const r=document.querySelector(sel).getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}, sel);

// ---- seed gallery (oldest first)
{
  const shots=[];
  const add=async(pg,type,title,clip,full)=>{const b=await pg.screenshot({encoding:'base64',clip,fullPage:!!full,captureBeyondViewport:!!full});shots.push({b,type,title,url:pg.url()});};
  let p=await open('travel.html');
  await add(p,'fullpage','Northbound — Slow travel journal',null,true);
  await add(p,'visible','Seven valleys, one slow train north · Northbound');
  await add(p,'region','Lofoten · Northbound',{x:590,y:124,width:480,height:412}); await p.close();
  p=await open('recipe.html'); await add(p,'visible','Roast squash with brown butter · Saltmarsh Kitchen');
  await add(p,'region','Roast squash · Saltmarsh Kitchen',{x:50,y:84,width:512,height:432}); await p.close();
  p=await open('dash.html'); await add(p,'region','Revenue by month · Tally',{x:250,y:222,width:550,height:330});
  await add(p,'visible','Revenue overview · Tally'); await p.close();
  const now=Date.now();
  await sw.evaluate(async(shots,now)=>{const st=await import('/src/storage.js');
    for(const [i,s] of shots.entries()){const blob=await (await fetch('data:image/png;base64,'+s.b)).blob();const bm=await createImageBitmap(blob);
      await st.addCapture({blob,title:s.title,url:s.url,type:s.type,width:bm.width,height:bm.height,createdAt:now-(shots.length-i)*6*60000});}
  },shots,now);
}
await setSettings(sw,{saveToGallery:false});
if(want('region')){ const p=await open('travel.html'); await sendToTab(sw,'travel.html','start-selection'); await sleep(1400);
  const a=await p.evaluate(()=>{const r=document.querySelector('.art').getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom}});
  await p.mouse.move(a.l-14,a.t-14); await p.mouse.down(); await p.mouse.move(800,300,{steps:6}); await p.mouse.move(a.r+14,a.b+14,{steps:12}); await sleep(700);
  await p.screenshot({path:'out/raw-region.png'}); await p.mouse.up(); await sleep(1500);
  await p.screenshot({path:'out/raw-region-done.png'}); await p.close(); }
if(want('smart')){ const p=await open('travel.html'); await p.evaluate(()=>scrollTo(0,600)); await sleep(300); await sendToTab(sw,'travel.html','start-selection'); await sleep(1400);
  const c=await p.evaluate(()=>{const r=document.querySelectorAll('.card')[1].getBoundingClientRect();return {x:r.left+r.width*0.6,y:r.bottom-4}});
  await p.keyboard.down('Control'); await p.mouse.move(c.x-60,c.y-40); await p.mouse.move(c.x,c.y,{steps:5}); await sleep(700);
  await p.screenshot({path:'out/raw-smart.png'}); await p.keyboard.up('Control'); await p.close(); }
if(want('panel')){ await setSettings(sw,{saveToGallery:true}); const p=await open('dash.html'); await sendToTab(sw,'dash.html','start-selection'); await sleep(1400);
  const g=await shadowEl(p,'.qs-tile-gallery'); await g.click(); await p.mouse.move(150,600); await sleep(2500);
  await p.screenshot({path:'out/raw-panel-gallery.png'});
  const t=await shadowEl(p,'[data-tab="settings"]'); await t.click(); await p.mouse.move(150,600); await sleep(1500);
  await p.screenshot({path:'out/raw-panel-settings.png'}); await p.close(); }
if(want('gallery')){ const p=await browser.newPage(); await p.setViewport({width:1400,height:775,deviceScaleFactor:1.6}); await p.goto(`chrome-extension://${extId}/gallery.html`); await sleep(2500); await p.mouse.move(5,770);
  await p.screenshot({path:'out/raw-gallery.png'}); await p.close(); }
if(want('popup')){ const t=await open('travel.html');
  const p=await browser.newPage();
  await p.evaluateOnNewDocument(()=>{const o=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=(q,cb)=>{const pr=o({}).then(ts=>ts.filter(t=>t.url.includes('travel.html')));if(cb){pr.then(cb);return;}return pr;};});
  await p.setViewport({width:360,height:600,deviceScaleFactor:2}); await p.goto(`chrome-extension://${extId}/popup.html`); await sleep(1500);
  const box=await p.evaluate(()=>{const r=document.querySelector('.popup-shell').getBoundingClientRect();return {w:Math.ceil(document.documentElement.scrollWidth),h:Math.ceil(r.bottom)}});
  await p.setViewport({width:box.w,height:box.h+16,deviceScaleFactor:2}); await sleep(600);
  await p.screenshot({path:'out/raw-popup.png'}); console.log('popup',box); await p.close(); await t.close(); }
if(want('annotate')){ const p=await open('travel.html');
  const R=await p.evaluate(()=>{const g=s=>{const e=document.querySelector(s);const rg=document.createRange();rg.selectNodeContents(e);const r=s==='.kick'?rg.getBoundingClientRect():e.getBoundingClientRect();return {l:r.left,t:r.top,r:r.right,b:r.bottom,w:r.width,h:r.height}};return {kick:g('.kick'),btn:g('.btn.p'),sun:g('.sun'),cta:g('nav .cta'),h1:g('h1')};});
  await sendToTab(sw,'travel.html','start-annotate'); await sleep(2500);
  const info=await p.evaluate(()=>{const c=[...document.querySelectorAll('#swiftselect-annotate-root canvas')].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}});return {c,iw:innerWidth};});
  const cv=info.c.sort((a,b)=>b.w*b.h-a.w*a.h)[0]; const k=cv.w/info.iw;
  const P=(x,y)=>[cv.x+x*k, cv.y+y*k];
  const tool=async id=>{await p.click(`#swiftselect-annotate-root [data-tool="${id}"]`); await sleep(200);};
  const drag=async(a,b,steps=12)=>{await p.mouse.move(...P(...a)); await p.mouse.down(); await p.mouse.move(...P(...b),{steps}); await p.mouse.up(); await sleep(250);};
  const {kick,btn,sun,cta}=R; const kc=kick.t+kick.h/2;
  await tool('highlighter'); await drag([kick.l-2,kc],[kick.r+2,kc]);
  await tool('rect'); await drag([btn.l-9,btn.t-9],[btn.r+9,btn.b+9]);
  await tool('ellipse'); await drag([sun.l-16,sun.t-16],[sun.r+16,sun.b+16]);
  await tool('blur'); await drag([cta.l-4,cta.t-4],[cta.r+4,cta.b+4]);
  await tool('arrow'); await drag([btn.r+70,btn.b+44],[btn.r+14,btn.b+6]);
  await tool('counter'); for (const pt of [[kick.r+22,kc],[btn.r+12,btn.t-10],[sun.r+14,sun.t-6]]) { await p.mouse.click(...P(...pt)); await sleep(200); }
  await tool('text'); await p.mouse.click(...P(btn.r+80,btn.b+30)); await sleep(300); await p.keyboard.type('Make this bigger'); await p.keyboard.press('Enter'); await sleep(300);
  await tool('select'); await p.mouse.click(...P(700,600)); await p.mouse.move(5,5); await sleep(600);
  await p.screenshot({path:'out/raw-annotate.png'}); await p.close(); }
if(want('toolbar')){ const p=await open('blank.html'); await sendToTab(sw,'blank.html','start-selection'); await sleep(1500);
  const r=await p.evaluate(()=>{const e=document.querySelector('#qs-guide-host').shadowRoot.querySelector('.qs-guide-buttons').parentElement;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height}});
  console.log(r); await p.screenshot({path:'out/raw-toolbar.png',omitBackground:true,clip:{x:r.x-30,y:r.y-20,width:r.width+60,height:r.height+50}}); await p.close(); }
await browser.close(); srv.close();

// Local browser fixtures; no live album, camera, printer or storage service.
import assert from "node:assert/strict";
import { before, after, beforeEach, test } from "node:test";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "../../Photo_BE/node_modules/playwright/index.mjs";

const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {usePersistedState} from '/src/album/hooks.js';
import {FrameEditor} from '/src/album/FrameEditor.jsx';
import {ToastProvider} from '/src/studio.jsx';
import {composeLayout,DEFAULT_TRANSFORM,SHEET,frameOutputSize,packPrintSheets} from '/src/frame-utils.js';
import {jpegDataUrl,pngDataUrl} from '/src/album/encode-jpeg.js';
import {renderPrintFrame} from '/src/album/render-frame.js';
const root=createRoot(document.getElementById('root'));
window.jpegDataUrl=jpegDataUrl;
window.pngDataUrl=pngDataUrl;
window.printFrames={SHEET,frameOutputSize,packPrintSheets,composeLayout};
window.renderPrintFrame=renderPrintFrame;
window.unmount=()=>flushSync(()=>root.render(null));
window.writes=[];
const storageSet=Storage.prototype.setItem;
Storage.prototype.setItem=function(key,value){
 if(key.startsWith('interaction-')) window.writes.push({key,value});
 return storageSet.call(this,key,value);
};
function Persisted({name}){
 const [state,setState]=usePersistedState(name,{x:0});
 window.persistSet=setState;
 window.persisted=state;
 return React.createElement('output',null,state.x);
}
window.mountPersist=name=>flushSync(()=>root.render(React.createElement(Persisted,{name})));
window.burst=()=>{for(let x=1;x<=80;x++)flushSync(()=>window.persistSet({x}));};
const source=document.createElement('canvas');source.width=240;source.height=160;
const ctx=source.getContext('2d');
const gradient=ctx.createLinearGradient(0,0,240,0);
gradient.addColorStop(0,'#a12d43');gradient.addColorStop(1,'#2c79bd');
ctx.fillStyle=gradient;ctx.fillRect(0,0,240,160);
const bg=document.createElement('canvas');bg.width=240;bg.height=360;
const frame={image:bg.toDataURL(),slots:[{x:.1,y:.2,w:.8,h:.6}]};
const engine={edited:async()=>source,thumb:async()=>source.toDataURL()};
window.allocations=0;window.draws=0;
for(const name of ['width','height']){
 const property=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,name);
 Object.defineProperty(HTMLCanvasElement.prototype,name,{...property,set(value){
  if(this.closest('.frame-canvas')) window.allocations++;
  return property.set.call(this,value);
 }});
}
const draw=CanvasRenderingContext2D.prototype.drawImage;
CanvasRenderingContext2D.prototype.drawImage=function(...args){
 if(this.canvas.closest?.('.frame-canvas'))window.draws++;
 return draw.apply(this,args);
};
function Composer(){
 const [slots,setSlots]=useState([{photo:'one',...DEFAULT_TRANSFORM,zoom:2}]);
 window.frameSlots=slots;
 window.moveFrame=()=>{for(let i=0;i<80;i++)flushSync(()=>setSlots([{...slots[0],x:i/200}]))};
 return React.createElement(ToastProvider,null,React.createElement(FrameEditor,{
  frame,engine,slots,photos:[{id:'one',number:1,favorite:true}],title:'Fixture',
  adjustOf:()=>({filter:'original'}),onSlots:setSlots,onReshuffle(){},onBack(){},onNext(){},
 }));
}
window.mountFrame=()=>flushSync(()=>root.render(React.createElement(Composer)));
window.expectedPixel=async()=>{
 const image=new Image();image.src=frame.image;await image.decode();
 const out=document.createElement('canvas');out.width=240;out.height=360;
 composeLayout(out,image,frame.slots,[source],window.frameSlots);
 return [...out.getContext('2d').getImageData(120,180,1,1).data];
};
`;

let server, browser, page, base;
before(async () => {
  const bundle = await build({
    root: fileURLToPath(new URL("..", import.meta.url)), configFile: false,
    logLevel: "error", esbuild: { jsx: "automatic" },
    build: { write: false, rollupOptions: {
      input: "/__interaction__.jsx", output: { format: "iife", inlineDynamicImports: true },
    } }, plugins: [{ name: "fixture", resolveId: id => id === "/__interaction__.jsx" ? "\0fixture.jsx" : null,
      load: id => id === "\0fixture.jsx" ? fixture : null }],
  });
  const script = bundle.output.find(item => item.type === "chunk").code;
  server = createServer((req, res) => {
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "application/javascript; charset=utf-8"); res.end(script); return; }
    const asset = bundle.output.find(item => `/${item.fileName}` === req.url);
    if (asset?.type === "asset") { res.setHeader("Content-Type", "application/javascript"); res.end(asset.source); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<div id="root"></div><script src="/fixture.js"></script>');
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
beforeEach(async () => { await page?.close(); page = await browser.newPage(); await page.goto(base); });
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

test("rapid layout changes write once after input pauses", async () => {
  await page.evaluate(() => window.mountPersist("interaction-burst"));
  await page.waitForTimeout(300);
  await page.evaluate(() => { window.writes=[]; window.burst(); });
  assert.equal(await page.locator("output").innerText(), "80");
  assert.equal(await page.evaluate(() => window.writes.length), 0);
  await page.waitForFunction(() => window.writes.length > 0);
  assert.equal(await page.evaluate(() => window.writes.length), 1);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("interaction-burst")).x), 80);
});

test("page hide and unmount flush the latest unsaved position", async () => {
  await page.evaluate(() => {
    window.mountPersist("interaction-hide"); window.persistSet({x:41});
  });
  await page.waitForFunction(() => window.persisted.x === 41);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("interaction-hide")).x), 41);
  await page.evaluate(() => window.persistSet({x:99}));
  await page.waitForFunction(() => window.persisted.x === 99);
  await page.evaluate(() => window.unmount());
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("interaction-hide")).x), 99);
});

test("changing album keys restores its layout and ignores the previous album's setter", async () => {
  await page.evaluate(() => {
    localStorage.setItem("interaction-b", JSON.stringify({x:42}));
    window.mountPersist("interaction-a");
    window.oldSetter=window.persistSet; window.persistSet({x:3});
  });
  await page.waitForFunction(() => window.persisted.x === 3);
  await page.evaluate(() => { window.mountPersist("interaction-b"); window.oldSetter({x:900}); });
  assert.equal(await page.locator("output").innerText(), "42");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("interaction-a")).x), 3);
  await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("interaction-b")).x), 42);
});

test("many frame movements reuse the bitmap and draw only the final frame", async () => {
  await page.evaluate(() => window.mountFrame());
  await page.waitForFunction(() => document.querySelector(".frame-canvas canvas")?.width === 240);
  const result = await page.evaluate(async () => {
    window.allocations=window.draws=0;
    window.moveFrame();
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {allocations:window.allocations,draws:window.draws,x:window.frameSlots[0].x,
      actual:[...document.querySelector(".frame-canvas canvas").getContext("2d").getImageData(120,180,1,1).data],
      expected:await window.expectedPixel()};
  });
  assert.equal(result.allocations, 0);
  assert.ok(result.draws <= 4, JSON.stringify(result));
  assert.equal(result.x, 79/200);
  assert.deepEqual(result.actual, result.expected);
});

test("asynchronous JPEG previews remain byte-identical to the established encoder", async () => {
  const result = await page.evaluate(async () => {
    const canvas = document.createElement("canvas"); canvas.width=1181;canvas.height=1772;
    const ctx=canvas.getContext("2d");ctx.fillStyle="#b98d71";ctx.fillRect(0,0,1181,1772);
    const expected=[.85,.97].map(q=>canvas.toDataURL("image/jpeg",q));
    canvas.toDataURL=()=>{throw new Error("Synchronous encoder used");};
    const native=canvas.toBlob.bind(canvas), calls=[];
    canvas.toBlob=(callback,type,quality)=>{calls.push({type,quality});native(blob=>setTimeout(()=>callback(blob),50),type,quality);};
    let ticks=0;const timer=setInterval(()=>ticks++,5);
    const actual=[];
    try {for(const q of [.85,.97])actual.push(await window.jpegDataUrl(canvas,q));}
    finally {clearInterval(timer);}
    const image=new Image();image.src=actual[1];await image.decode();
    return{same:actual.every((s,i)=>s===expected[i]),calls,ticks,width:image.naturalWidth,height:image.naturalHeight};
  });
  assert.equal(result.same,true);
  assert.deepEqual(result.calls,[{type:"image/jpeg",quality:.85},{type:"image/jpeg",quality:.97}]);
  assert.deepEqual([result.width,result.height],[1181,1772]);
  assert.ok(result.ticks > 2,JSON.stringify(result));
});

test("print PNG encoding keeps every pixel at the native 4×6 inch 300 ppi dimensions", async () => {
  const result = await page.evaluate(async () => {
    const {SHEET,packPrintSheets,frameOutputSize}=window.printFrames;
    const canvas=document.createElement("canvas");canvas.width=SHEET.w;canvas.height=SHEET.h;
    const ctx=canvas.getContext("2d"), image=ctx.createImageData(SHEET.w,SHEET.h);
    for(let y=0;y<SHEET.h;y++)for(let x=0;x<SHEET.w;x++){
      const i=(y*SHEET.w+x)*4;
      image.data.set([(x^y)&255,x&255,y&255,255],i);
    }
    ctx.putImageData(image,0,0);
    const pages=packPrintSheets([{canvas,printSize:"full"}]);
    const sheet=pages[0].canvas;
    sheet.toDataURL=()=>{throw new Error("Synchronous print encoder used");};
    const native=sheet.toBlob.bind(sheet), calls=[];
    sheet.toBlob=(callback,type,quality)=>{calls.push({type,quality});native(blob=>setTimeout(()=>callback(blob),30),type,quality);};
    let ticks=0;const timer=setInterval(()=>ticks++,5);
    let src;try{src=await window.pngDataUrl(sheet);}finally{clearInterval(timer);}
    const decoded=new Image();decoded.src=src;await decoded.decode();
    const copy=document.createElement("canvas");copy.width=decoded.naturalWidth;copy.height=decoded.naturalHeight;
    copy.getContext("2d").drawImage(decoded,0,0);
    const actual=copy.getContext("2d").getImageData(0,0,copy.width,copy.height).data;
    const expected=sheet.getContext("2d").getImageData(0,0,sheet.width,sheet.height).data;
    const portrait=frameOutputSize({printSize:"full"},{naturalWidth:4000,naturalHeight:6000});
    const landscape=frameOutputSize({printSize:"full"},{naturalWidth:6000,naturalHeight:4000});
    return {same:actual.every((v,i)=>v===expected[i]), calls,ticks,type:src.slice(0,22),
      size:[copy.width,copy.height],portrait,landscape};
  });
  assert.equal(result.same,true);
  assert.equal(result.type,"data:image/png;base64,");
  assert.deepEqual(result.size,[1200,1800]);
  assert.deepEqual(result.portrait,{width:1200,height:1800});
  assert.deepEqual(result.landscape,{width:1800,height:1200});
  assert.deepEqual(result.calls,[{type:"image/png",quality:undefined}]);
  assert.ok(result.ticks>2,JSON.stringify(result));
});

test("strip packing and scaled composition keep high-quality interpolation and native sheet size", async () => {
  const result=await page.evaluate(()=>{
    const {packPrintSheets,composeLayout}=window.printFrames;
    const bg=document.createElement("canvas");bg.width=240;bg.height=360;
    const strip=document.createElement("canvas");strip.width=600;strip.height=1800;
    composeLayout(strip,bg,[],[],[]);
    const sourceCtx=strip.getContext("2d");
    const pages=packPrintSheets([{canvas:strip,printSize:"strip"},{canvas:strip,printSize:"strip"}]);
    const ctx=pages[0].canvas.getContext("2d");
    return {size:[pages[0].canvas.width,pages[0].canvas.height],count:pages.length,frames:pages[0].frames,
      smoothing:sourceCtx.imageSmoothingEnabled,quality:sourceCtx.imageSmoothingQuality,
      last:[...ctx.getImageData(1199,1799,1,1).data]};
  });
  assert.deepEqual(result,{size:[1200,1800],count:1,frames:2,smoothing:true,quality:"high",last:[255,255,255,255]});
});

test("sequential print composition preserves every pixel, slot order, zoom and rotation", async () => {
  const result=await page.evaluate(async()=>{
    const {composeLayout}=window.printFrames;
    const make=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
    const images=['one','two'].map((id,index)=>{
      const c=make(240,360),ctx=c.getContext('2d'),data=ctx.createImageData(c.width,c.height);
      for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)data.data.set(
        [index?210:x%256,index?y%256:80,(x^y)%256,255],(y*c.width+x)*4);
      ctx.putImageData(data,0,0);return c;
    });
    const bg=make(1200,1800);bg.getContext('2d').fillStyle='#dbc1a9';bg.getContext('2d').fillRect(0,0,bg.width,bg.height);
    const frame={slots:[{x:.03,y:.04,w:.6,h:.48},{x:.25,y:.3,w:.7,h:.5},{x:.05,y:.65,w:.5,h:.3}]};
    const slots=[{photo:'one',zoom:1.4,x:.15,y:-.1,rotate:90},{photo:'two',zoom:1.2,x:-.2,y:.15,rotate:0},
      {photo:'one',zoom:1,x:0,y:0,rotate:270}];
    const expected=make(1200,1800),actual=make(1200,1800);
    composeLayout(expected,bg,frame.slots,[images[0],images[1],images[0]],slots);
    let active=0,peak=0;const loads=[],released=[];
    await window.renderPrintFrame(actual,bg,frame,slots,{
      edited:async id=>{loads.push(id);peak=Math.max(peak,++active);return images[id==='one'?0:1];},
      releaseFull:id=>{released.push(id);active--;},
      preview:()=>{throw Error('A preview reached print');},
    },()=>({}));
    const a=actual.getContext('2d').getImageData(0,0,1200,1800).data;
    const b=expected.getContext('2d').getImageData(0,0,1200,1800).data;
    let different=0,max=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i]){different++;max=Math.max(max,Math.abs(a[i]-b[i]));}
    return{different,max,loads,released,peak,active};
  });
  assert.equal(result.different,0,JSON.stringify(result));
  assert.deepEqual(result.loads,['one','two','one']);
  assert.deepEqual(result.released,['one','two','one']);
  assert.equal(result.peak,1);
  assert.equal(result.active,0);
});

test("a thirteen-slot print uses 6240 by 4160 sources one at a time and frees canceled jobs", async () => {
  const result=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1800;
    const bg=document.createElement('canvas');bg.width=1200;bg.height=1800;
    const frame={slots:Array.from({length:13},(_,i)=>({x:(i%3)/3,y:Math.floor(i/3)/5,w:1/3,h:1/5}))};
    const slots=frame.slots.map((_,i)=>({photo:String(i),zoom:1,x:0,y:0,rotate:0}));
    const held=new Map();let peak=0,loads=0;
    const engine={edited:async id=>{
      const c=document.createElement('canvas');c.width=6240;c.height=4160;
      c.getContext('2d').fillStyle=`rgb(${20+Number(id)*15},80,130)`;c.getContext('2d').fillRect(0,0,c.width,c.height);
      held.set(id,c);peak=Math.max(peak,held.size);loads++;return c;
    },releaseFull:id=>{const c=held.get(id);c.width=c.height=0;held.delete(id);}};
    await window.renderPrintFrame(canvas,bg,frame,slots,engine,()=>({}));
    const samples=frame.slots.map(slot=>[...canvas.getContext('2d').getImageData(
      Math.round((slot.x+slot.w/2)*1200),Math.round((slot.y+slot.h/2)*1800),1,1).data]);
    let live=true;
    const canceled=await window.renderPrintFrame(canvas,bg,frame,slots,{
      ...engine,edited:async id=>{const c=await engine.edited(id);live=false;return c;},
    },()=>({}),()=>live);
    return{loads,peak,held:held.size,samples,canceled};
  });
  assert.equal(result.peak,1);
  assert.equal(result.held,0);
  assert.equal(result.loads,14);
  assert.equal(result.canceled,false);
  assert.deepEqual(result.samples,Array.from({length:13},(_,i)=>[20+i*15,80,130,255]));
});

test("prints paint from 3000 px print sources and fetch the camera original only for a slot zoomed beyond them", async () => {
  const result=await page.evaluate(async()=>{
    const make=(w,h,color)=>{const c=document.createElement('canvas');c.width=w;c.height=h;
      const ctx=c.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,w,h);return c;};
    const colors={one:'rgb(200,40,40)',two:'rgb(40,160,60)',old:'rgb(30,60,200)'};
    const canvas=make(1200,1800,'#fff'),bg=make(1200,1800,'#fff');
    const frame={slots:[{x:0,y:0,w:1/3,h:1/5},{x:.4,y:0,w:1/3,h:1/5},{x:0,y:.5,w:1/3,h:1/5}]};
    const slots=[{photo:'one',zoom:1,x:0,y:0,rotate:0},{photo:'two',zoom:9,x:0,y:0,rotate:0},
      {photo:'old',zoom:1,x:0,y:0,rotate:0}];
    const printLoads=[],originalLoads=[],released=[];
    await window.renderPrintFrame(canvas,bg,frame,slots,{
      hasPrintSource:id=>id!=='old',
      printEdited:async id=>{printLoads.push(id);return make(3000,2000,colors[id]);},
      edited:async id=>{originalLoads.push(id);return make(6240,4160,colors[id]);},
      releasePrint:id=>released.push('print:'+id),releaseFull:id=>released.push('full:'+id),
    },()=>({}));
    const at=(x,y)=>[...canvas.getContext('2d').getImageData(x,y,1,1).data].slice(0,3).join(',');
    return{printLoads,originalLoads,samples:[at(200,180),at(680,180),at(200,1080)]};
  });
  assert.deepEqual(result.printLoads,['one','two'],'light print sources first');
  assert.deepEqual(result.originalLoads,['two','old'],
    'the 9× zoomed slot needs more pixels than 3000 px; an old photo has no print source');
  assert.deepEqual(result.samples,['200,40,40','40,160,60','30,60,200']);
});

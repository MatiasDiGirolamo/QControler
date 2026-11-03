// Offline integration: all browser traffic is fulfilled by fixtures, never Boca.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {AccountAuto} from '../account-auto.mjs';
import {AttemptLog} from '../attempt-log.mjs';
import {PlateaControl} from '../platea-control.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url)),require=createRequire(import.meta.url);
let chromium;try{({chromium}=require('playwright-core'));}catch{({chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core')));}
const candidates=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Google/Chrome/Application/chrome.exe'));
let chrome;for(const p of candidates){try{await fs.access(p);chrome=p;break;}catch{}}
const fixtureDir=await fs.mkdtemp(path.join(dir,'.qc-browser-test-'));
if(path.dirname(path.resolve(fixtureDir))!==dir)throw Error('Test path outside workspace');
const browser=await chromium.launch({executablePath:chrome,headless:true});
try{
  const log=new AttemptLog();
  const control=new PlateaControl(path.join(fixtureDir,'ledger.json'));await control.load();
  const auto=new AccountAuto();auto.configure({accounts:{'1':{user:'fixture@example.test',password:'fixture-password'},'2':{user:'other@example.test',password:'other-fixture-password'}},matchUrl:'https://bocasocios.bocajuniors.com.ar/matches/878/plateas'});
  const context=await browser.newContext(),page=await context.newPage();
  const s={id:1,account:'1',page,autoEnabled:true};
  await context.exposeBinding('__qcPlatea',({page:caller,frame},action,data)=>{
    assert.equal(caller,page);assert.equal(frame,page.mainFrame());assert.equal(new URL(frame.url()).origin,'https://bocasocios.bocajuniors.com.ar');
    if(action==='stop')s.autoEnabled=false;
    if(action==='telemetry'){log.record(s,data);return {ok:true};}
    return control.command(s,action,data);
  });
  const extension=path.resolve(dir,'../../boca-extension');
  const api=await fs.readFile(path.join(extension,'page-api.js'),'utf8'),monitor=await fs.readFile(path.resolve(dir,'../platea-worker.js'),'utf8');
  await context.addInitScript({content:`if(window===top&&location.origin==='https://bocasocios.bocajuniors.com.ar'){${api}\naddEventListener('DOMContentLoaded',()=>{${monitor}\n},{once:true});}`});
  const login=`<!doctype html><meta charset="utf-8"><form onsubmit="event.preventDefault();if(this.elements.user.value==='fixture@example.test'&&this.elements.password.value==='fixture-password')location.assign('/home')"><label>Correo electrónico<input type="email" name="user" autocomplete="username" placeholder="Ingresá tu correo"></label><label>Contraseña<input name="password" type="password"></label><button disabled>INICIAR SESIÓN</button></form><script>document.querySelector("form").addEventListener("input",()=>setTimeout(()=>{document.querySelector("button").disabled=!(document.querySelector("input[type=email]").value.includes("@")&&document.querySelector("input[type=password]").value);},150));</script>`;
  const home=`<!doctype html><meta charset="utf-8"><main id="content"><article><h2>BOCA JRS</h2><p>VS</p><h2>RIVER PLATE</h2><button id="more">VER MÁS</button></article></main><script>document.querySelector('#more').onclick=()=>{history.pushState({},'', '/matches/878/assist');const content=document.querySelector('#content');content.replaceChildren();const button=document.createElement('button');button.textContent='OBTENER PLATEAS';button.onclick=()=>location.assign('/matches/878/plateas');content.append(button);};</script>`;
  const map=`<!doctype html><meta charset="utf-8"><p>Seleccioná un sector disponible en el mapa</p><i style="background:rgb(0,128,0)"></i><span>Disponible</span><svg><g id="seccion-G"><rect width="20" height="20" fill="rgb(0,128,0)"></rect></g></svg><script>
  window.reserves=0;window.injectLimit=${process.argv.includes('--rate-limit')};window.availabilityReads=0;const paths={m1:'/event/seat/reserve/{{seatId}}',f:'/event/seat/assignPurchase',gr:'/member/shoppingCart',wT:'/members',yJ:'/seats/{{sectionId}}',fe:'/event/{{matchId}}/availability'};
  const api={get:async url=>{if(url==='/event/878/availability'&&window.injectLimit&&++window.availabilityReads===1)throw {message:'fixture rate limit',response:{status:429,headers:{'retry-after':'0'}}};return {data:url==='/members'?{socios:[{nid:42}]}:url.startsWith('/member/shoppingCart')?{items:window.reserves?[{nid:444,socioNid:42,ubicacion:{nid:721}}]:[]}:url.startsWith('/seats/')?{evento:{nid:878},ubicaciones:[{nid:721}]}:{secciones:[{nid:798,codigo:'G',activa:true,hayDisponibilidad:true}]}};},post:async url=>{if(url.startsWith('/event/seat/reserve/')){window.reserves++;return {data:{ticket:{nid:444}}};}return {data:{tipoTarifaNid:-2}};}};
  const modules={12033:{ZP:api},28275:paths,5632:{default:{push:async()=>true}}};window.webpackChunk_N_E=[];window.webpackChunk_N_E.push=chunk=>{chunk[2](id=>{if(!modules[id])throw Error('optional');return modules[id]});};
  </script>`;
  await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:new URL(route.request().url()).pathname==='/auth/login'?login:new URL(route.request().url()).pathname==='/home'?home:map}));
  await page.goto('https://bocasocios.bocajuniors.com.ar/auth/login');
  await auto.tick(s,control);
  await page.waitForURL('**/home');
  await page.waitForFunction(()=>typeof window.__qcSetAccess==='function');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('div')].some(e=>e.shadowRoot)),false,'Managed mode needs no extension overlay');
  await auto.tick(s,control);
  await page.waitForURL('**/matches/878/assist');
  await auto.tick(s,control);
  await page.waitForURL('**/matches/878/plateas');
  await page.waitForFunction(()=>typeof window.__qcAutoStart==='function');
  await auto.tick(s,control);
  if(process.argv.includes('--rate-limit')){
    await page.waitForFunction(()=>window.__qcWorkerState?.().retryAt>Date.now());
    assert.equal(s.autoEnabled,true);assert.equal(await page.evaluate(()=>window.reserves),0);assert.ok(control.cooldownUntil>Date.now());
  }
  const deadline=Date.now()+(process.argv.includes('--rate-limit')?45000:10000);
  while(control.summary()[0]?.outcome!=='reserved'&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  assert.equal(control.summary()[0]?.outcome,'reserved',JSON.stringify({access:s.access,autoEnabled:s.autoEnabled,platea:s.platea,status:await page.evaluate(()=>window.__qcWorkerState?.().status)}));
  assert.equal(await page.evaluate(()=>window.reserves),1);
  const logDeadline=Date.now()+1000;while(!log.events.some(e=>e.outcome==='reserved')&&Date.now()<logDeadline)await new Promise(r=>setTimeout(r,20));
  assert.ok(log.events.some(e=>e.kind==='attempt'&&e.outcome==='reserved'&&Number.isFinite(e.timings?.preflightMs)));
  await auto.tick(s,control);assert.equal(await page.evaluate(()=>window.reserves),1);
  // A second isolated authenticated account follows the same flow and obtains
  // its own seat/ticket. No shared cookies, extension, or simulated identity.
  const context2=await browser.newContext(),page2=await context2.newPage(),s2={id:2,account:'2',page:page2,autoEnabled:true};
  await context2.exposeBinding('__qcPlatea',({page:caller,frame},action,data)=>{
    assert.equal(caller,page2);assert.equal(frame,page2.mainFrame());assert.equal(new URL(frame.url()).origin,'https://bocasocios.bocajuniors.com.ar');
    if(action==='telemetry'){log.record(s2,data);return {ok:true};}if(action==='stop')s2.autoEnabled=false;
    return control.command(s2,action,data);
  });
  await context2.addInitScript({content:`if(window===top&&location.origin==='https://bocasocios.bocajuniors.com.ar'){${api}\naddEventListener('DOMContentLoaded',()=>{${monitor}\n},{once:true});}`});
  const login2=login.replaceAll('fixture@example.test','other@example.test').replaceAll("'fixture-password'","'other-fixture-password'");
  const map2=map.replaceAll('nid:42','nid:43').replaceAll('socioNid:42','socioNid:43').replaceAll('nid:721','nid:722').replaceAll('nid:444','nid:445').replace('window.injectLimit=true','window.injectLimit=false');
  await context2.route('**/*',route=>route.fulfill({contentType:'text/html',body:new URL(route.request().url()).pathname==='/auth/login'?login2:new URL(route.request().url()).pathname==='/home'?home:map2}));
  await page2.goto('https://bocasocios.bocajuniors.com.ar/auth/login');await auto.tick(s2,control);await page2.waitForURL('**/home');await page2.waitForFunction(()=>typeof window.__qcAutoStart==='function');
  await auto.tick(s2,control);await page2.waitForURL('**/matches/878/assist');await auto.tick(s2,control);await page2.waitForURL('**/matches/878/plateas');await page2.waitForFunction(()=>typeof window.__qcAutoStart==='function');await auto.tick(s2,control);
  const secondDeadline=Date.now()+10000;while(control.summary().filter(r=>r.outcome==='reserved').length<2&&Date.now()<secondDeadline)await new Promise(r=>setTimeout(r,50));
  assert.equal(control.summary().filter(r=>r.outcome==='reserved').length,2);assert.equal(await page2.evaluate(()=>window.reserves),1);
  assert.ok(control.ledger['42']);assert.ok(control.ledger['43']);
  console.log('PASS dos cuentas aisladas: dos accesos, dos reservas simuladas de identidades distintas, bloqueo independiente y motor sin extensión.');
  console.log('PASS Chrome offline: formulario → Inicio sin extensión ni superposición → VER MÁS → OBTENER PLATEAS → mapa → inicio automático → una reserva simulada → bloqueo persistente. Sin tráfico a Boca.');
  if(process.argv.includes('--rate-limit'))console.log('PASS HTTP 429: pausa compartida de 20 s, monitor activo, reanudación automática y reserva simulada posterior.');
}finally{await browser.close();await fs.rm(fixtureDir,{recursive:true,force:true});}

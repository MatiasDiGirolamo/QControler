import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateEntry,observeQueue,classifySessions} from './queue.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(import.meta.url);
let chromium;
try { ({chromium}=require('playwright-core')); }
catch {
  try { ({chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core'))); }
  catch { console.error('Falta playwright-core. En esta carpeta ejecuta: npm.cmd install --ignore-scripts'); process.exit(1); }
}
const GB=2**30, token=randomBytes(24).toString('hex');
const candidates=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean).map(p=>path.join(p,'Google/Chrome/Application/chrome.exe'));
let chrome;
for(const candidate of candidates) { try {await fs.access(candidate);chrome=candidate;break;}catch{} }
if(!chrome){console.error('No se encontro Chrome.');process.exit(1);}
const reserve=Math.max(2*GB,os.totalmem()*.20);
const tempParent=await fs.realpath(os.tmpdir());
let runTemp,stopPromise,cleanup='Sin temporales creados';
let lastCpu=os.cpus(), cpuSamples=[], cpuPercent=0, browser, busy=false, paused='', closing=false, status='Preparando prueba local…';
const sessions=[];
let mode='local',entryUrl='https://www.allaccess.com.ar/event/u2',monitorBusy=false;
const maxSessions=()=>mode==='live'?3:50;
function sample(){
  const now=os.cpus();let idle=0,total=0;
  now.forEach((c,i)=>{const old=lastCpu[i];if(!old)return;idle+=c.times.idle-old.times.idle;for(const k of Object.keys(c.times))total+=c.times[k]-old.times[k];});
  lastCpu=now;cpuSamples.push(total?100*(1-idle/total):0);cpuSamples=cpuSamples.slice(-5);
  cpuPercent=cpuSamples.reduce((a,b)=>a+b,0)/cpuSamples.length;
}
function capacity(){
  if(os.freemem()<reserve)return 'Queda poca RAM libre. Se freno la creacion de sesiones.';
  if(cpuPercent>75)return 'CPU del equipo por encima de 75 %. Se freno la creacion.';
  return '';
}
function state(){return {status,busy,paused,cleanup,mode,entryUrl,count:sessions.length,max:maxSessions(),cpu:Math.round(cpuPercent),totalGB:os.totalmem()/GB,freeGB:os.freemem()/GB,reserveGB:reserve/GB,sessions:classifySessions(sessions.map(s=>({id:s.id,verified:s.verified,...s.observation}))),alive:!!browser};}
async function verify(s){
  if(s.live)return;
  await s.page.reload({waitUntil:'domcontentloaded',timeout:15000});
  const values=await s.page.evaluate(()=>({storage:localStorage.getItem('isolation-marker'),cookie:document.cookie.split('; ').find(v=>v.startsWith('isolation-marker='))?.slice('isolation-marker='.length)}));
  if(values.storage!==s.marker || values.cookie!==s.marker)throw new Error('Las marcas de aislamiento no coinciden.');
  s.verified=true;
}
async function add(count){
  if(busy||closing)throw new Error('Hay otra operacion en curso.');
  if(paused)throw new Error('La creacion esta pausada. Revisa recursos y pulsa Reanudar.');
  if(!browser)throw new Error('La prueba termino. Volve a iniciar el programa para crear sesiones.');
  busy=true;
  try{
    for(let i=0;i<count && sessions.length<maxSessions();i++){
      if(closing)break;
      const reason=capacity();if(reason){paused=reason;break;}
      const context=await browser.newContext();
      let committed=false;
      try{
        const page=await context.newPage();
        await page.goto(base+'/probe',{waitUntil:'domcontentloaded',timeout:15000});
        const clean=await page.evaluate(()=>localStorage.getItem('isolation-marker')===null && !document.cookie.includes('isolation-marker='));
        if(!clean)throw new Error('Una sesion nueva heredo datos de otra.');
        const marker=randomBytes(16).toString('hex');
        await page.evaluate(value=>{localStorage.setItem('isolation-marker',value);document.cookie='isolation-marker='+value+'; Path=/; SameSite=Strict';document.querySelector('#marker').textContent=value;},marker);
        const s={id:sessions.length+1,context,page,marker,verified:false,live:false,observation:{queueState:'Prueba local',queueId:null,wait:null,waitMinutes:null}};
        await verify(s);sessions.push(s);committed=true;
        if(mode==='live'){
          s.live=true;
          s.observation.queueState='Abriendo sitio…';
          try{await page.goto(entryUrl,{waitUntil:'domcontentloaded',timeout:30000});}
          catch{ s.observation.queueState='Carga incompleta · revisar imagen'; }
          await inspectSession(s);
        }
        status=sessions.length+' sesiones creadas y verificadas.';
      }finally{if(!committed)await context.close();}
      await new Promise(r=>setTimeout(r,500));
      if(closing)break;
    }
    for(const s of sessions){if(closing)break;await verify(s);}
    if(!closing)status=mode==='live'?sessions.length+' sesiones abiertas. Se observan las páginas sin recargarlas.':sessions.length+' sesiones: cookies y almacenamiento aislados, comprobados tras recargar.';
  }catch(error){if(closing)return;paused='La prueba encontro un error. No se crearan mas sesiones.';throw error;}
  finally{busy=false;}
}
async function inspectSession(s){
  if(closing||!s.live||s.page.isClosed())return;
  try{
    const previousId=s.observation.queueId||s.lastQueueId;
    const observation=await s.page.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText||''}));
    s.observation=observeQueue({...observation,previousId});
    if(s.observation.queueId)s.lastQueueId=s.observation.queueId;
  }catch{s.observation={...s.observation,queueState:'Sin lectura actual · revisar sesión',waitMinutes:null,checkedAt:null};}
}
async function cleanTemp(){
  if(!runTemp)return;
  const resolved=path.resolve(runTemp);
  if(path.dirname(resolved)!==tempParent || !path.basename(resolved).startsWith('qcontroler-'))throw new Error('Ruta de limpieza fuera de la carpeta temporal propia.');
  let real;
  try {real=await fs.realpath(resolved);}catch(e){if(e.code==='ENOENT'){cleanup='Temporales eliminados';return;}throw e;}
  if(real!==resolved)throw new Error('La carpeta temporal cambio de destino. No se elimino.');
  await fs.rm(resolved,{recursive:true,force:true,maxRetries:5,retryDelay:300});
  cleanup='Temporales eliminados';
}
function stop(){
  if(stopPromise)return stopPromise;
  stopPromise=(async()=>{
    closing=true;paused='Cerrando sesiones y limpiando temporales…';
    const current=browser;
    if(current){
      await Promise.allSettled(current.contexts().filter(c=>sessions.some(s=>s.context===c)).map(c=>c.close()));
      await current.close();
      browser=null;
    }
    sessions.length=0;
    try{await cleanTemp();paused='Detenido · temporales eliminados';status='Sesiones cerradas y temporales de esta ejecución eliminados. Reinicia para otra prueba.';}
    catch(e){cleanup='Limpieza pendiente';paused='Sesiones cerradas · no se pudo completar la limpieza';status=e.message;throw e;}
  })();
  return stopPromise;
}
const probe='<!doctype html><meta charset="utf-8"><title>Prueba local de aislamiento</title><body style="font:20px system-ui;background:#10203d;color:white;padding:40px"><h1>Sesion de prueba local</h1><p>Marca propia de este contexto:</p><code id="marker"></code><p>No hay conexion con Boca ni con Queue-it.</p><script>document.querySelector("#marker").textContent=localStorage.getItem("isolation-marker")||"Sesion nueva";</script>';
let base;
const server=http.createServer(async(req,res)=>{
  const json=(code,data)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
  try{
    if(req.headers.host!==new URL(base).host){json(403,{error:'Host no permitido'});return;}
    const url=new URL(req.url,base);
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    if(req.method==='GET' && url.pathname==='/probe'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(probe);return;}
    if(req.method==='GET' && url.pathname==='/ui.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(await fs.readFile(path.join(dir,'ui.js')));return;}
    if(req.method==='GET' && url.pathname==='/'){const html=await fs.readFile(path.join(dir,'index.html'),'utf8');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html.replace('__TOKEN__',token));return;}
    if(req.headers['x-local-token']!==token){json(403,{error:'Acceso local requerido'});return;}
    if(req.method==='GET'&&url.pathname==='/state'){json(200,state());return;}
    if(req.method!=='POST'||req.headers.origin!==base){json(403,{error:'Origen no permitido'});return;}
    if(url.pathname==='/configure'){
      if(busy||sessions.length||closing){json(409,{error:'Configurá el enlace antes de crear sesiones. Para otro evento, finalizá y reiniciá.'});return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){json(400,{error:'Configuración demasiado larga'});return;}}
      const input=JSON.parse(raw);
      if(!['local','live'].includes(input.mode)){json(400,{error:'Modo no válido'});return;}
      if(input.mode==='live')entryUrl=validateEntry(input.url);
      mode=input.mode;status=mode==='live'?'Modo real listo: elegí 2 sesiones para empezar. No se realizará ninguna compra.':'Prueba local lista.';
      json(200,{ok:true});return;
    }
    if(url.pathname==='/add'){
      const target=Number(url.searchParams.get('target'));
      if(!Number.isInteger(target)||target<1||target>maxSessions()){json(400,{error:'Elegí un total entre 1 y '+maxSessions()+'.'});return;}
      const count=target-sessions.length;
      if(count<=0){json(409,{error:'Ese total ya está alcanzado. No se cerraron sesiones.'});return;}
      if(busy||paused||!browser){json(409,{error:paused||'Programa ocupado o detenido'});return;}
      void add(count).catch(e=>{status=e.message;});json(202,{ok:true});return;
    }
    if(url.pathname==='/resume'){const reason=capacity();if(reason){json(409,{error:reason});return;}if(!browser||busy){json(409,{error:'Programa detenido u ocupado'});return;}paused='';json(200,{ok:true});return;}
    if(url.pathname==='/stop'){await stop();json(200,{ok:true});return;}
    if(url.pathname==='/preview'){
      if(busy||!browser){json(409,{error:'Espera a que termine la operacion.'});return;}
      const s=sessions.find(s=>s.id===Number(url.searchParams.get('id')));if(!s){json(404,{error:'Sesion no encontrada'});return;}
      const png=await s.page.screenshot();res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});res.end(png);return;
    }
    json(404,{error:'Ruta no encontrada'});
  }catch(error){json(500,{error:error.message});}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
base='http://127.0.0.1:'+server.address().port;
const sampler=setInterval(()=>{sample();if(browser&&!paused){const reason=capacity();if(reason)paused=reason;}},1000);
const monitor=setInterval(async()=>{if(monitorBusy||closing||mode!=='live')return;monitorBusy=true;try{for(const s of sessions)await inspectSession(s);}finally{monitorBusy=false;}},5000);
const shutdown=async()=>{clearInterval(sampler);clearInterval(monitor);await stop().catch(e=>console.error(e.message));server.close();};
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
try{
  await new Promise(r=>setTimeout(r,1200));
  runTemp=await fs.mkdtemp(path.join(tempParent,'qcontroler-'));
  cleanup='Temporales de esta ejecución activos';
  const rootContext=await chromium.launchPersistentContext(path.join(runTemp,'profile'),{executablePath:chrome,headless:true,downloadsPath:path.join(runTemp,'downloads'),tracesDir:path.join(runTemp,'traces')});
  browser=rootContext.browser();
  console.log('Panel local: '+base);
  if(process.argv.includes('--open'))execFile(chrome,[base],()=>{});
  status='Elegí la cantidad total y pulsá Aplicar. No se crean sesiones automáticamente.';
  console.log(JSON.stringify(state()));
  if(process.argv.includes('--cleanup-test')){
    const testPath=runTemp;
    await fs.writeFile(path.join(testPath,'owned-test.tmp'),'solo esta ejecucion');
    await stop();
    let absent=false;try{await fs.access(testPath);}catch(e){if(e.code==='ENOENT')absent=true;else throw e;}
    if(!absent)throw new Error('La carpeta temporal sigue existiendo.');
    console.log('PASS: Chrome cerrado; carpeta temporal propia eliminada y ausencia verificada.');
    await shutdown();
  }
  if(process.argv.includes('--self-test')){
    await add(5);
    if(sessions.length!==5 || !sessions.every(s=>s.verified))throw new Error('La prueba no pudo crear y verificar cinco sesiones con el margen de recursos disponible.');
    const cookies=await Promise.all(sessions.map(s=>s.context.cookies(base)));
    if(new Set(cookies.map(c=>c.find(v=>v.name==='isolation-marker')?.value)).size!==5)throw new Error('Las cookies no son distintas.');
    console.log('PASS: 5 contextos, cookies distintas, localStorage distinto, persistencia tras recarga.');
    await shutdown();
  }
}catch(error){console.error(error.message);await shutdown();process.exitCode=1;}

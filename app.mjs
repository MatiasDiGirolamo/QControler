import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepareEntry,observeQueue,classifySessions} from './queue.mjs';
import {VERSION,SESSION_LIMIT,DEFAULT_ENTRY,attentionStates,resourceReason,selectedTarget} from './control.mjs';
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
let runTemp,stopPromise,launchPromise,batchPromise,rootContext,starting=false,shuttingDown=false,cleanup='Sin temporales creados';
let lastCpu=os.cpus(), cpuSamples=[], cpuPercent=0, browser, busy=false, paused='', closing=false, status='Preparando prueba local…';
const sessions=[];
let mode='live',entryUrl=DEFAULT_ENTRY,monitorBusy=false;
if(process.argv.includes('--self-test')||process.argv.includes('--cleanup-test')||process.argv.includes('--api-test'))mode='local';
let automatic=false,pauseKind='',healthySamples=0,targetSetting='auto',targetTotal=SESSION_LIMIT,entryNote='';
try{const settings=JSON.parse(await fs.readFile(path.join(dir,'settings.json'),'utf8'));entryUrl=prepareEntry(settings.entryUrl).entryUrl;}catch{}
const maxSessions=()=>SESSION_LIMIT;
function pauseCreation(kind,message){pauseKind=kind;paused=message;healthySamples=0;}
function sample(){
  const now=os.cpus();let idle=0,total=0;
  now.forEach((c,i)=>{const old=lastCpu[i];if(!old)return;idle+=c.times.idle-old.times.idle;for(const k of Object.keys(c.times))total+=c.times[k]-old.times[k];});
  lastCpu=now;cpuSamples.push(total?100*(1-idle/total):0);cpuSamples=cpuSamples.slice(-5);
  cpuPercent=cpuSamples.reduce((a,b)=>a+b,0)/cpuSamples.length;
}
function capacity(){
  return resourceReason({freeBytes:os.freemem(),reserveBytes:reserve,cpu:cpuPercent});
}
function state(){return {version:VERSION,starting,closing,ready:!shuttingDown&&!starting&&!closing,status,busy,paused,pauseKind,automatic,targetSetting,targetTotal,entryNote,cleanup,mode,entryUrl,count:sessions.length,max:maxSessions(),cpu:Math.round(cpuPercent),totalGB:os.totalmem()/GB,freeGB:os.freemem()/GB,reserveGB:reserve/GB,sessions:classifySessions(sessions.map(s=>({id:s.id,verified:s.verified,...s.observation}))),alive:!!browser};}
async function ensureBrowser(){
  if(browser)return;
  if(launchPromise)return launchPromise;
  starting=true;
  launchPromise=(async()=>{
    runTemp=await fs.mkdtemp(path.join(tempParent,'qcontroler-'));
    cleanup='Temporales de esta ejecución activos';
    rootContext=await chromium.launchPersistentContext(path.join(runTemp,'profile'),{executablePath:chrome,headless:true,downloadsPath:path.join(runTemp,'downloads'),tracesDir:path.join(runTemp,'traces')});
    browser=rootContext.browser();
  })();
  try{await launchPromise;}finally{starting=false;launchPromise=null;}
}
function runAutomatic(){
  if(!automatic||busy||starting||batchPromise||closing||paused||shuttingDown)return;
  if(sessions.length>=targetTotal){automatic=false;status='Total alcanzado. Las sesiones siguen observándose.';return;}
  const reason=capacity();if(reason){pauseCreation('resources',reason);return;}
  batchPromise=(async()=>{
    await ensureBrowser();
    if(closing||paused||!automatic)return;
    await add(targetTotal-sessions.length);
    if(automatic&&!paused&&sessions.length>=targetTotal){automatic=false;status='Total alcanzado. Las sesiones siguen observándose.';}
  })().catch(async e=>{
    if(closing)return;
    automatic=false;pauseCreation('error','No se pudo iniciar o crear sesiones: '+e.message);status=paused;
    if(!browser){await cleanTemp().catch(()=>{cleanup='Limpieza pendiente';});runTemp=undefined;}
  }).finally(()=>{batchPromise=null;});
}
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
      if(closing||paused)break;
      const reason=capacity();if(reason){pauseCreation('resources',reason);break;}
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
          if(attentionStates.includes(s.observation.queueState)){
            pauseCreation('site','Se frenó la creación: '+s.observation.queueState+'. Revisá la sesión existente.');
          }
        }
        status=sessions.length+' sesiones creadas y verificadas.';
      }finally{if(!committed)await context.close();}
      await new Promise(r=>setTimeout(r,500));
      if(closing||paused)break;
    }
    for(const s of sessions){if(closing)break;await verify(s);}
    if(!closing)status=mode==='live'?sessions.length+' sesiones abiertas. Se observan las páginas sin recargarlas.':sessions.length+' sesiones: cookies y almacenamiento aislados, comprobados tras recargar.';
  }catch(error){if(closing)return;pauseCreation('error','Error al crear sesiones. Se conservan las ya abiertas.');automatic=false;throw error;}
  finally{busy=false;}
}
async function inspectSession(s){
  if(closing||!s.live||s.page.isClosed())return;
  try{
    const previousId=s.observation.queueId||s.lastQueueId;
    const observation=await s.page.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText||''}));
    s.observation=observeQueue({...observation,previousId});
    if(s.observation.queueId)s.lastQueueId=s.observation.queueId;
    if(attentionStates.includes(s.observation.queueState)&&pauseKind!=='site'){
      pauseCreation('site','Se frenó la creación: '+s.observation.queueState+'. Revisá la sesión '+s.id+'.');
    }
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
  closing=true;automatic=false;pauseKind='stopped';paused='Cerrando Chrome y limpiando temporales…';
  stopPromise=(async()=>{
    try{
      // Si Detener llega durante el arranque, espera ese mismo lanzamiento y lo cierra.
      if(launchPromise)await launchPromise.catch(()=>{});
      const current=browser;
      if(rootContext)await rootContext.close().catch(()=>{});
      if(current?.isConnected())await current.close();
      rootContext=null;browser=null;
      // El cierre de Chrome interrumpe cualquier creación/navegación pendiente.
      if(batchPromise)await batchPromise;
      sessions.length=0;
      await cleanTemp();runTemp=undefined;
      paused='Detenido · Chrome cerrado · temporales eliminados';
      status='Listo para volver a iniciar. Chrome se abrirá únicamente al pulsar Iniciar.';
    }catch(e){
      cleanup='Limpieza pendiente';paused='No se pudo completar el cierre: '+e.message;throw e;
    }finally{closing=false;stopPromise=null;}
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
    if(req.method==='GET' && url.pathname==='/health'){json(200,{app:'QControler',version:VERSION});return;}
    if(req.method==='GET' && url.pathname==='/probe'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(probe);return;}
    if(req.method==='GET' && ['/ui.js','/ui-sync.js'].includes(url.pathname)){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(await fs.readFile(path.join(dir,url.pathname.slice(1))));return;}
    if(req.method==='GET' && url.pathname==='/'){const html=await fs.readFile(path.join(dir,'index.html'),'utf8');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(html.replace('__TOKEN__',token).replaceAll('__VERSION__',VERSION));return;}
    if(req.headers['x-local-token']!==token){json(403,{error:'Acceso local requerido'});return;}
    if(req.method==='GET'&&url.pathname==='/state'){json(200,state());return;}
    if(req.method!=='POST'||req.headers.origin!==base){json(403,{error:'Origen no permitido'});return;}
    if(req.headers['x-client-version']!==VERSION){json(409,{error:'El panel y el programa tienen versiones diferentes. Reiniciá la app y abrí el panel que indique la consola.'});return;}
    if(url.pathname==='/start'){
      if(busy||starting||closing||batchPromise||shuttingDown){json(409,{error:'El programa está iniciando, cerrando u ocupado. Esperá a que termine.'});return;}
      if(cleanup==='Limpieza pendiente'){json(409,{error:'Quedó una limpieza pendiente. Pulsá Detener todo otra vez antes de iniciar.'});return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){json(400,{error:'Enlace demasiado largo'});return;}}
      const input=JSON.parse(raw);
      if(!['local','live'].includes(input.mode)){json(400,{error:'Modo no válido'});return;}
      const total=selectedTarget(input.target);
      const entry=input.mode==='live'?prepareEntry(input.url):{entryUrl,removed:[]};
      if(sessions.length&&(input.mode!==mode||entry.entryUrl!==entryUrl)){json(409,{error:'Ya hay sesiones de otro enlace. Pulsá Detener todo antes de cambiar de evento.'});return;}
      if(sessions.some(s=>attentionStates.includes(s.observation.queueState))){json(409,{error:'Hay sesiones con errores o verificaciones. Revisalas antes de ampliar.'});return;}
      if(input.mode==='live')await fs.writeFile(path.join(dir,'settings.json'),JSON.stringify({entryUrl:entry.entryUrl},null,2)+'\n');
      mode=input.mode;entryUrl=entry.entryUrl;targetSetting=input.target;targetTotal=total;
      entryNote=entry.removed.length?'Se quitaron q/pase personal para que cada sesión solicite su propio identificador. Se conservaron los datos del evento.':'';
      paused='';pauseKind='';healthySamples=0;automatic=true;
      status=mode==='live'?'Creando sesiones aisladas. La prefila y la espera se leen de la página.':'Creando contextos de prueba local; no se abre ningún sitio externo.';
      runAutomatic();json(202,{ok:true,entryUrl,targetTotal,entryNote});return;
    }
    if(url.pathname==='/pause'){automatic=false;pauseCreation('user','Creación pausada por vos. Las sesiones siguen abiertas.');json(200,{ok:true});return;}
    if(url.pathname==='/resume'){const reason=capacity();if(reason){json(409,{error:reason});return;}if(!browser||busy||sessions.some(s=>attentionStates.includes(s.observation.queueState))){json(409,{error:'Programa ocupado, detenido o con sesiones que requieren atención.'});return;}paused='';pauseKind='';automatic=true;runAutomatic();json(200,{ok:true});return;}
    if(url.pathname==='/stop'){await stop();json(200,{ok:true});return;}
    if(url.pathname==='/preview'){
      if(busy||!browser){json(409,{error:'Espera a que termine la operacion.'});return;}
      const s=sessions.find(s=>s.id===Number(url.searchParams.get('id')));if(!s){json(404,{error:'Sesion no encontrada'});return;}
      const png=await s.page.screenshot();res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});res.end(png);return;
    }
    json(404,{error:'Ruta no encontrada'});
  }catch(error){json(500,{error:error.message});}
});
const testMode=process.argv.some(a=>['--api-test','--cleanup-test','--self-test'].includes(a));
const panelPort=testMode?0:38471;
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(panelPort,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
}catch(e){
  if(e.code!=='EADDRINUSE')throw e;
  const existing='http://127.0.0.1:'+panelPort;
  try{
    const health=await(await fetch(existing+'/health',{signal:AbortSignal.timeout(2000)})).json();
    if(health.app!=='QControler')throw new Error('El puerto lo usa otra aplicación.');
    console.log('QControler ya está abierto ('+health.version+'). Reutilizando panel: '+existing);
    if(process.argv.includes('--open'))execFile(chrome,[existing],()=>{});
    process.exit(0);
  }catch{console.error('El puerto '+panelPort+' está ocupado. No se abrió otro navegador.');process.exit(1);}
}
base='http://127.0.0.1:'+server.address().port;
const sampler=setInterval(()=>{
  sample();
  if(closing||shuttingDown)return;
  if((automatic||busy)&&!paused){const reason=capacity();if(reason)pauseCreation('resources',reason);}
  if(automatic&&pauseKind==='resources'&&!busy){
    healthySamples=!capacity()&&os.freemem()>reserve+256*1024*1024&&cpuPercent<60?healthySamples+1:0;
    if(healthySamples>=10){paused='';pauseKind='';healthySamples=0;runAutomatic();}
  }
},1000);
const monitor=setInterval(async()=>{if(monitorBusy||closing||mode!=='live')return;monitorBusy=true;try{for(const s of sessions)await inspectSession(s);}finally{monitorBusy=false;}},5000);
const shutdown=async()=>{shuttingDown=true;clearInterval(sampler);clearInterval(monitor);await stop().catch(e=>console.error(e.message));server.close();};
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
try{
  // Abrir el panel no crea Chrome ni una carpeta temporal de navegador.
  await new Promise(r=>setTimeout(r,1200));
  console.log('Panel local: '+base);
  if(process.argv.includes('--open'))execFile(chrome,[base],()=>{});
  status='Pegá el enlace de prefila de Boca y pulsá Iniciar automático. No se abren páginas hasta iniciar.';
  console.log(JSON.stringify(state()));
  if(process.argv.includes('--api-test')){
    const assert=(await import('node:assert/strict')).default;
    const post=(route,body,version=VERSION)=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Local-Token':token,'X-Client-Version':version,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.equal(state().count,0);assert.equal(state().paused,'');assert.equal(state().version,VERSION);assert.equal(state().alive,false);assert.equal(runTemp,undefined);
    assert.equal((await post('/start',{mode:'local',target:'2'},'old')).status,409);
    assert.equal((await fetch(base+'/state')).status,403);
    assert.equal((await post('/start',{mode:'local',target:'2'})).status,202);
    const deadline=Date.now()+25000;
    while((starting||batchPromise||busy||automatic)&&Date.now()<deadline){if(paused)throw new Error('Prueba API frenada: '+paused);await new Promise(r=>setTimeout(r,100));}
    assert.equal(busy,false);assert.equal(sessions.length,2);assert.ok(sessions.every(s=>s.verified));
    assert.equal((await post('/start',{mode:'live',url:DEFAULT_ENTRY,target:'auto'})).status,409);
    assert.equal(state().mode,'local');assert.equal(state().count,2);
    assert.equal((await post('/pause')).status,200);assert.equal(state().pauseKind,'user');
    assert.equal((await post('/stop')).status,200);assert.equal(state().count,0);assert.equal(state().alive,false);assert.equal(state().cleanup,'Temporales eliminados');
    assert.equal(starting,false);assert.equal(runTemp,undefined);
    // Detener es idempotente y el panel permite volver a iniciar sin reiniciar Node.
    assert.equal((await post('/stop')).status,200);
    assert.equal((await post('/start',{mode:'local',target:'1'})).status,202);
    const againDeadline=Date.now()+25000;
    while((starting||batchPromise||busy||automatic)&&Date.now()<againDeadline){if(paused)throw new Error(paused);await new Promise(r=>setTimeout(r,100));}
    assert.equal(sessions.length,1);assert.equal(state().alive,true);
    assert.equal((await post('/stop')).status,200);assert.equal(state().alive,false);assert.equal(state().ready,true);
    // Detener inmediatamente tras Iniciar también cierra el lanzamiento pendiente.
    assert.equal((await post('/start',{mode:'local',target:'2'})).status,202);
    assert.equal((await post('/stop')).status,200);assert.equal(state().alive,false);assert.equal(sessions.length,0);assert.equal(starting,false);
    console.log('PASS API: panel sin Chrome, inicio, aislamiento, cierre, limpieza, segundo inicio y cancelación durante el arranque.');
    await shutdown();
  }
  if(process.argv.includes('--cleanup-test')){
    await ensureBrowser();
    const testPath=runTemp;
    await fs.writeFile(path.join(testPath,'owned-test.tmp'),'solo esta ejecucion');
    await stop();
    let absent=false;try{await fs.access(testPath);}catch(e){if(e.code==='ENOENT')absent=true;else throw e;}
    if(!absent)throw new Error('La carpeta temporal sigue existiendo.');
    console.log('PASS: Chrome cerrado; carpeta temporal propia eliminada y ausencia verificada.');
    await shutdown();
  }
  if(process.argv.includes('--self-test')){
    await ensureBrowser();
    await add(5);
    if(sessions.length!==5 || !sessions.every(s=>s.verified))throw new Error('La prueba no pudo crear y verificar cinco sesiones con el margen de recursos disponible.');
    const cookies=await Promise.all(sessions.map(s=>s.context.cookies(base)));
    if(new Set(cookies.map(c=>c.find(v=>v.name==='isolation-marker')?.value)).size!==5)throw new Error('Las cookies no son distintas.');
    console.log('PASS: 5 contextos, cookies distintas, localStorage distinto, persistencia tras recarga.');
    await shutdown();
  }
}catch(error){console.error(error.message);await shutdown();process.exitCode=1;}

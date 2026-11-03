import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {botProfile,renderPanel} from './bot-profile.mjs';
import {closeSession,sessionIds} from './session-close.mjs';
import {execFile,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {AttemptLog} from './attempt-log.mjs';
import {AccountAuto} from './account-auto.mjs';
import {PlateaControl} from './platea-control.mjs';
import {prepareEntry,observeQueue,classifySessions} from './queue.mjs';
import {VERSION,SESSION_LIMIT,DEFAULT_ENTRY,attentionStates,resourceReason,selectedTarget} from './control.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const profile=botProfile(process.argv),botKind=profile.kind;
const platea=new PlateaControl(path.join(dir,'platea-ledger.json'));
if(profile.platea)await platea.load();
const extensionDir=path.resolve(dir,'../boca-extension');
const plateaApi=profile.platea?await fs.readFile(path.join(extensionDir,'page-api.js'),'utf8'):'';
const plateaWorker=profile.platea?await fs.readFile(path.join(dir,'platea-worker.js'),'utf8'):'';
const attemptLog=new AttemptLog();
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
const tempParent=await fs.realpath(os.tmpdir());
let runTemp,stopPromise,launchPromise,batchPromise,rootContext,starting=false,shuttingDown=false,cleanup='Sin temporales creados';
let lastCpu=os.cpus(), cpuSamples=[], cpuPercent=0, browser, busy=false, paused='', closing=false, status='Preparando prueba local…';
const sessions=[];
const nextQueueSessionId=sessionIds();
const accountAuto=new AccountAuto();
let mode='live',entryUrl=DEFAULT_ENTRY,monitorBusy=false;
if(process.argv.includes('--self-test')||process.argv.includes('--cleanup-test')||process.argv.includes('--api-test'))mode='local';
let automatic=false,pauseKind='',healthySamples=0,targetSetting=profile.platea?'2':'auto',targetTotal=profile.sessionLimit,entryNote='';
try{const settings=JSON.parse(await fs.readFile(path.join(dir,profile.settingsFile),'utf8'));entryUrl=prepareEntry(settings.entryUrl).entryUrl;}catch{}
const maxSessions=()=>profile.sessionLimit;
function pauseCreation(kind,message){pauseKind=kind;paused=message;healthySamples=0;}
function sample(){
  const now=os.cpus();let idle=0,total=0;
  now.forEach((c,i)=>{const old=lastCpu[i];if(!old)return;idle+=c.times.idle-old.times.idle;for(const k of Object.keys(c.times))total+=c.times[k]-old.times[k];});
  lastCpu=now;cpuSamples.push(total?100*(1-idle/total):0);cpuSamples=cpuSamples.slice(-5);
  cpuPercent=cpuSamples.reduce((a,b)=>a+b,0)/cpuSamples.length;
}
function capacity(){
  return resourceReason({cpu:cpuPercent});
}
function state(){return {features:{closeSession:!profile.platea},botKind,botLabel:profile.label,version:VERSION,starting,closing,ready:!shuttingDown&&!starting&&!closing,status,busy,paused,pauseKind,automatic,targetSetting,targetTotal,entryNote,cleanup,mode,entryUrl,count:sessions.length,max:maxSessions(),cpu:Math.round(cpuPercent),totalGB:os.totalmem()/GB,freeGB:os.freemem()/GB,ramLimitEnabled:false,...(profile.platea?{events:attemptLog.recent(),polling:platea.pollStatus(),retryAt:platea.cooldownUntil,accountAuto:accountAuto.summary(),reservations:platea.summary().map(r=>({...r,sessionAvailable:sessions.some(s=>s.id===r.session&&s.account===r.slot&&!s.page.isClosed()&&Date.parse(r.at)>=s.createdAt)}))}:{}),sessions:classifySessions(sessions.map(s=>({id:s.id,removing:!!s.removing,account:s.account,lastAttempt:s.lastAttempt,access:s.access,autoEnabled:s.autoEnabled,platea:s.platea,verified:s.verified,...s.observation}))),alive:!!browser};}
async function ensureBrowser(){
  if(browser)return;
  if(launchPromise)return launchPromise;
  starting=true;
  launchPromise=(async()=>{
    runTemp=await fs.mkdtemp(path.join(tempParent,'qcontroler-'));
    cleanup='Temporales de esta ejecución activos';
    rootContext=await chromium.launchPersistentContext(path.join(runTemp,'profile'),{executablePath:chrome,headless:mode!=='live',downloadsPath:path.join(runTemp,'downloads'),tracesDir:path.join(runTemp,'traces')});
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
  if(s.live||s.removing)return;
  try{
  await s.page.reload({waitUntil:'domcontentloaded',timeout:15000});
  const values=await s.page.evaluate(()=>({storage:localStorage.getItem('isolation-marker'),cookie:document.cookie.split('; ').find(v=>v.startsWith('isolation-marker='))?.slice('isolation-marker='.length)}));
  if(values.storage!==s.marker || values.cookie!==s.marker)throw new Error('Las marcas de aislamiento no coinciden.');
  s.verified=true;
  }catch(error){if(!closing&&!s.removing)throw error;}
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
        const managedSession={id:profile.platea?sessions.length+1:nextQueueSessionId(),createdAt:Date.now(),...(profile.platea?{account:String(sessions.length+1),autoEnabled:mode==='live'&&accountAuto.enabled,access:'Esperando página',platea:'En espera del mapa'}:{})};
        if(profile.platea&&mode==='live') {
          await context.exposeBinding('__qcPlatea',async({page:caller,frame},action,data)=>{
            if(caller!==page||frame!==page.mainFrame()||new URL(frame.url()).origin!=='https://bocasocios.bocajuniors.com.ar')throw new Error('Origen de platea no permitido');
            if(action==='telemetry'){const event=attemptLog.record(managedSession,data);if(event?.kind==='attempt')managedSession.lastAttempt=event;return {ok:true};}
            if(!['start','stop','check','begin','finish','cooldown','poll-plan','poll-result','prepare','prepared-done'].includes(action))throw new Error('Acción no permitida');
            if(action==='stop')managedSession.autoEnabled=false;
            return platea.command(managedSession,action,data);
          });
          // One ordered script: hook HTTP before the site, panel after DOM readiness.
          await context.addInitScript({content:`if(window===window.top && location.origin==='https://bocasocios.bocajuniors.com.ar'){
window.__qcControllerVersion='${VERSION}';
${plateaApi}
addEventListener('DOMContentLoaded',()=>{${plateaWorker}
},{once:true});
}`});
        }
        await page.goto(base+'/probe',{waitUntil:'domcontentloaded',timeout:15000});
        const clean=await page.evaluate(()=>localStorage.getItem('isolation-marker')===null && !document.cookie.includes('isolation-marker='));
        if(!clean)throw new Error('Una sesion nueva heredo datos de otra.');
        const marker=randomBytes(16).toString('hex');
        await page.evaluate(value=>{localStorage.setItem('isolation-marker',value);document.cookie='isolation-marker='+value+'; Path=/; SameSite=Strict';document.querySelector('#marker').textContent=value;},marker);
        const s=Object.assign(managedSession,{context,page,marker,verified:false,live:false,observation:{queueState:'Prueba local',queueId:null,wait:null,waitMinutes:null}});
        if(profile.platea)page.on('close',()=>{void platea.command(s,'stop').catch(()=>{});});
        await verify(s);sessions.push(s);committed=true;
        if(mode==='live'){
          s.live=true;
          s.observation.queueState='Abriendo sitio…';
          try{await page.goto(entryUrl,{waitUntil:'domcontentloaded',timeout:30000});}
          catch{ s.observation.queueState='Carga incompleta · revisar imagen'; }
          await inspectSession(s);
          if(profile.platea)await accountAuto.tick(s,platea);
          if(attentionStates.includes(s.observation.queueState)){
            pauseCreation('site','Se frenó la creación: '+s.observation.queueState+'. Revisá la sesión existente.');
          }
        }
        status=sessions.length+' sesiones creadas y verificadas.';
      }finally{if(!committed)await context.close();}
      await new Promise(r=>setTimeout(r,500));
      if(closing||paused)break;
    }
    for(const s of sessions){if(closing)break;if(!s.removing&&!s.page.isClosed())await verify(s);}
    if(!closing)status=mode==='live'?sessions.length+' sesiones abiertas. Se observan las páginas sin recargarlas.':sessions.length+' sesiones: cookies y almacenamiento aislados, comprobados tras recargar.';
  }catch(error){if(closing)return;pauseCreation('error','Error al crear sesiones. Se conservan las ya abiertas.');automatic=false;throw error;}
  finally{busy=false;}
}
async function inspectSession(s){
  if(closing||s.removing||!s.live||s.page.isClosed())return;
  try{
    const previousId=s.observation.queueId||s.lastQueueId;
    const observation=await s.page.evaluate(()=>({url:location.href,title:document.title,text:document.body?.innerText||'',queueIdText:document.getElementById('hlLinkToQueueTicket2')?.innerText||'',countdownText:document.getElementById('defaultCountdown')?.textContent||'',waitText:document.getElementById('MainPart_lbWhichIsIn')?.innerText||''}));
    s.observation=observeQueue({...observation,previousId,entryUrl});
    if(s.observation.queueId)s.lastQueueId=s.observation.queueId;
    if(attentionStates.includes(s.observation.queueState)&&pauseKind!=='site'){
      pauseCreation('site','Se frenó la creación: '+s.observation.queueState+'. Revisá la sesión '+s.id+'.');
    }
  }catch{s.observation={...s.observation,queueState:'Sin lectura actual · revisar sesión',waitMinutes:null,checkedAt:null};}
}
async function closeQueueSession(id){
  return closeSession({sessions,id,closing,
    pause:()=>{automatic=false;pauseCreation('user','Creación pausada al cerrar una sesión. Las demás siguen abiertas.');},
    waitForBatch:async()=>{if(batchPromise)await batchPromise;},onEmpty:stop,report:message=>{status=message;}});
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
      if(profile.platea){await platea.browserClosed();for(const s of sessions)await platea.command(s,'stop');}
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
    if(req.method==='GET' && url.pathname==='/health'){json(200,{app:'QControler',version:VERSION,botKind});return;}
    if(req.method==='GET' && url.pathname==='/probe'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(probe);return;}
    if(req.method==='GET' && ['/ui.js','/ui-sync.js',...(profile.platea?['/reservation-alerts.js']:[])].includes(url.pathname)){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});res.end(await fs.readFile(path.join(dir,url.pathname.slice(1))));return;}
    if(req.method==='GET' && url.pathname==='/'){const html=await fs.readFile(path.join(dir,'index.html'),'utf8');res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end(renderPanel(html,profile,{token,version:VERSION}));return;}
    if(req.headers['x-local-token']!==token){json(403,{error:'Acceso local requerido'});return;}
    if(profile.platea&&req.method==='GET'&&url.pathname==='/diagnostics'){res.writeHead(200,{'content-type':'application/x-ndjson; charset=utf-8','cache-control':'no-store','content-disposition':'attachment; filename=platea-registro.jsonl'});res.end(attemptLog.export());return;}
    if(req.method==='GET'&&url.pathname==='/state'){json(200,state());return;}
    if(req.method!=='POST'||req.headers.origin!==base){json(403,{error:'Origen no permitido'});return;}
    if(req.headers['x-client-version']!==VERSION){json(409,{error:'El panel y el programa tienen versiones diferentes. Reiniciá la app y abrí el panel que indique la consola.'});return;}
    if(req.headers['x-bot-kind']!==botKind){json(409,{error:'Este panel pertenece a otro bot. Abrí el panel correcto.'});return;}
    if(url.pathname==='/open-other') {
      const child=spawn(process.execPath,[fileURLToPath(import.meta.url),profile.otherFlag,'--open'],{cwd:dir,detached:true,stdio:'ignore',windowsHide:true});
      child.on('error',()=>{});child.unref();json(202,{ok:true});return;
    }
    if(!profile.platea&&['/accounts','/accounts-clear','/session-account','/session-stop','/session-run','/platea-reviewed'].includes(url.pathname)){json(404,{error:'Esta función está disponible en el panel Platea.'});return;}
    if(url.pathname==='/accounts'||url.pathname==='/accounts-clear') {
      if(url.pathname==='/accounts-clear'){accountAuto.clear();for(const s of sessions)s.autoEnabled=false;json(200,{ok:true});return;}
      if(sessions.length||starting||busy||closing||batchPromise){json(409,{error:'Cargá las cuentas antes de iniciar. Detené las sesiones para cambiar las cuentas.'});return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){json(400,{error:'Datos demasiado largos'});return;}}
      try {accountAuto.configure(JSON.parse(raw));}catch{json(400,{error:'Completá los dos correos electrónicos, las dos contraseñas y el enlace de la ficha o mapa del partido de Boca.'});return;}
      json(200,{ok:true});return;
    }
    if(url.pathname==='/session-close'){
      if(profile.platea){json(404,{error:'El cierre individual está disponible en Filas.'});return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>512){json(400,{error:'Solicitud demasiado larga'});return;}}
      let input;try{input=JSON.parse(raw);}catch{json(400,{error:'Solicitud no válida'});return;}
      if(!Number.isInteger(input.id)||input.id<1){json(400,{error:'Identificador de sesión no válido.'});return;}
      const result=await closeQueueSession(input.id);json(result.code,result);return;
    }
    if(url.pathname==='/start'){
      if(busy||starting||closing||batchPromise||shuttingDown){json(409,{error:'El programa está iniciando, cerrando u ocupado. Esperá a que termine.'});return;}
      if(cleanup==='Limpieza pendiente'){json(409,{error:'Quedó una limpieza pendiente. Pulsá Detener todo otra vez antes de iniciar.'});return;}
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096){json(400,{error:'Enlace demasiado largo'});return;}}
      const input=JSON.parse(raw);
      if(!['local','live'].includes(input.mode)){json(400,{error:'Modo no válido'});return;}
      if(profile.platea&&!['2','auto'].includes(String(input.target))){json(400,{error:'Platea utiliza dos sesiones fijas, una por socio.'});return;}
      const total=profile.platea?2:selectedTarget(input.target);
      const entry=input.mode==='live'?prepareEntry(input.url):{entryUrl,removed:[]};
      if(profile.platea&&input.mode==='live'&&new URL(entry.entryUrl).origin!=='https://bocasocios.bocajuniors.com.ar'){json(400,{error:'En Platea usá la página de inicio de Boca. Para prefila usá el panel Filas.'});return;}
      if(sessions.length&&(input.mode!==mode||entry.entryUrl!==entryUrl)){json(409,{error:'Ya hay sesiones de otro enlace. Pulsá Detener todo antes de cambiar de evento.'});return;}
      if(sessions.some(s=>attentionStates.includes(s.observation.queueState))){json(409,{error:'Hay sesiones con errores o verificaciones. Revisalas antes de ampliar.'});return;}
      if(profile.platea&&input.mode==='live'&&!accountAuto.summary().configured){json(400,{error:'Cargá primero los dos correos electrónicos y contraseñas en el panel Platea. No se abrieron sesiones.'});return;}
      if(input.mode==='live')await fs.writeFile(path.join(dir,profile.settingsFile),JSON.stringify({entryUrl:entry.entryUrl},null,2)+'\n');
      mode=input.mode;entryUrl=entry.entryUrl;targetSetting=input.target;targetTotal=total;
      entryNote=entry.removed.length?'Se quitaron q/pase personal para que cada sesión solicite su propio identificador. Se conservaron los datos del evento.':'';
      paused='';pauseKind='';healthySamples=0;automatic=true;
      status=mode==='live'?'Creando sesiones aisladas. La prefila y la espera se leen de la página.':'Creando contextos de prueba local; no se abre ningún sitio externo.';
      runAutomatic();json(202,{ok:true,entryUrl,targetTotal,entryNote});return;
    }
    if(url.pathname==='/pause'){automatic=false;pauseCreation('user','Creación pausada por vos. Las sesiones siguen abiertas.');json(200,{ok:true});return;}
    if(url.pathname==='/resume'){const reason=capacity();if(reason){json(409,{error:reason});return;}if(!browser||busy||sessions.some(s=>attentionStates.includes(s.observation.queueState))){json(409,{error:'Programa ocupado, detenido o con sesiones que requieren atención.'});return;}paused='';pauseKind='';automatic=true;runAutomatic();json(200,{ok:true});return;}
    if(url.pathname==='/stop'){await stop();json(200,{ok:true});return;}
    if(url.pathname==='/quit'){await stop();json(200,{ok:true});setTimeout(()=>void shutdown(),100);return;}
    if(url.pathname==='/session-account'||url.pathname==='/session-stop'||url.pathname==='/session-run'||url.pathname==='/session-open'||url.pathname==='/platea-reviewed') {
      let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024){json(400,{error:'Solicitud demasiado larga'});return;}}
      const input=JSON.parse(raw);
      if(url.pathname==='/platea-reviewed') {
        if(input.confirmed!==true){json(400,{error:'Confirmá la revisión manual del carrito'});return;}
        if([...platea.owners.keys()].includes(input.account)){json(409,{error:'Detené primero la búsqueda de ese socio.'});return;}
        await platea.review(input.account);json(200,{ok:true});return;
      }
      const s=sessions.find(s=>s.id===Number(input.id));
      if(!s||!s.live||s.page.isClosed()||closing){json(409,{error:'La sesión no está disponible'});return;}
      if(url.pathname==='/session-open'){await s.page.bringToFront();json(200,{ok:true});return;}
      if(url.pathname==='/session-run'){s.autoEnabled=true;s.autoStarted=false;await accountAuto.tick(s,platea);json(200,{ok:true});return;}
      if(url.pathname==='/session-stop') {
        s.autoEnabled=false;
        await platea.command(s,'stop');
        await s.page.evaluate(()=>window.postMessage({type:'la-previa:managed-stop'},location.origin));
        json(200,{ok:true});return;
      }
      if(profile.platea&&input.account!==String(s.id)){json(400,{error:'Cada sesión conserva su socio asignado.'});return;}
      if(!['1','2'].includes(input.account)){json(400,{error:'Elegí Socio 1 o Socio 2'});return;}
      if(platea.owners.get(s.account)?.has(s.id)||platea.summary().some(v=>v.session===s.id&&v.slot===s.account)){json(409,{error:'Detené la búsqueda y revisá cualquier reserva antes de cambiar el socio.'});return;}
      s.autoEnabled=false;s.account=input.account;s.platea='Listo · iniciá desde el mapa';json(200,{ok:true});return;
    }
    if(url.pathname==='/preview'){
      if(busy||!browser){json(409,{error:'Espera a que termine la operacion.'});return;}
      const s=sessions.find(s=>s.id===Number(url.searchParams.get('id')));if(!s){json(404,{error:'Sesion no encontrada'});return;}
      const png=await s.page.screenshot();res.writeHead(200,{'content-type':'image/png','cache-control':'no-store'});res.end(png);return;
    }
    json(404,{error:'Ruta no encontrada'});
  }catch(error){json(500,{error:error.message});}
});
const testMode=process.argv.some(a=>['--api-test','--cleanup-test','--self-test'].includes(a));
const panelPort=testMode?0:profile.port;
try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(panelPort,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
}catch(e){
  if(e.code!=='EADDRINUSE')throw e;
  const existing='http://127.0.0.1:'+panelPort;
  try{
    const health=await(await fetch(existing+'/health',{signal:AbortSignal.timeout(2000)})).json();
    if(health.app!=='QControler'||health.botKind!==botKind)throw new Error('El puerto lo usa otra aplicación.');
    if(health.version!==VERSION){console.error('Sigue abierto '+profile.label+' '+health.version+'. La versión nueva es '+VERSION+'. Cerrá el programa/consola anterior y volvé a iniciar. Cerrar o recargar Chrome no actualiza el proceso.');process.exit(1);}
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
    healthySamples=!capacity()&&cpuPercent<60?healthySamples+1:0;
    if(healthySamples>=10){paused='';pauseKind='';healthySamples=0;runAutomatic();}
  }
},1000);
const monitor=setInterval(async()=>{if(monitorBusy||closing||mode!=='live')return;monitorBusy=true;try{for(const s of sessions){await inspectSession(s);if(!closing)if(profile.platea)await accountAuto.tick(s,platea);}}finally{monitorBusy=false;}},5000);
const shutdown=async()=>{shuttingDown=true;clearInterval(sampler);clearInterval(monitor);await stop().catch(e=>console.error(e.message));server.close();};
process.once('SIGINT',()=>void shutdown());process.once('SIGTERM',()=>void shutdown());
try{
  // Abrir el panel no crea Chrome ni una carpeta temporal de navegador.
  await new Promise(r=>setTimeout(r,1200));
  console.log('Panel '+profile.label+': '+base);
  if(process.argv.includes('--open'))execFile(chrome,[base],()=>{});
  status=profile.platea?'Cargá las cuentas y el partido en este panel de Platea.':'Panel Filas: pegá el enlace e iniciá las sesiones de fila.';
  console.log(JSON.stringify(state()));
  if(process.argv.includes('--api-test')){
    const assert=(await import('node:assert/strict')).default;
    const post=(route,body,version=VERSION)=>fetch(base+route,{method:'POST',headers:{Origin:base,'X-Local-Token':token,'X-Client-Version':version,'X-Bot-Kind':botKind,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.equal(state().count,0);assert.equal(state().paused,'');assert.equal(state().version,VERSION);assert.equal(state().alive,false);assert.equal(runTemp,undefined);
    const accountFixture={accounts:{'1':{user:'test-user-a@example.test',password:'test-password-a'},'2':{user:'test-user-b@example.test',password:'test-password-b'}},matchUrl:'https://bocasocios.bocajuniors.com.ar/matches/878/assist'};
    const html=await(await fetch(base)).text();
    assert.equal(html.includes('id="accounts-form"'),profile.platea);
    assert.equal(state().botKind,botKind);
    if(profile.platea){
      assert.equal((await post('/accounts',accountFixture)).status,200);
      assert.equal(state().accountAuto.configured,true);
      assert.equal(JSON.stringify(state()).includes('test-password'),false);
      assert.equal(JSON.stringify(state()).includes('test-user'),false);
      assert.equal((await post('/accounts-clear')).status,200);
      assert.equal(state().accountAuto.configured,false);
    }else{
      assert.equal((await post('/accounts',accountFixture)).status,404);
      assert.equal((await post('/platea-reviewed',{account:'1',confirmed:true})).status,404);
      assert.equal(state().accountAuto,undefined);
    }
    if(profile.platea){assert.equal((await post('/start',{mode:'live',url:DEFAULT_ENTRY,target:'2'})).status,400);assert.equal(state().count,0);assert.equal(state().alive,false);}
    if(profile.platea){assert.equal((await post('/start',{mode:'local',target:'35'})).status,400);assert.equal(state().alive,false);}
    assert.equal((await post('/start',{mode:'local',target:'2'},'old')).status,409);
    assert.equal((await fetch(base+'/state')).status,403);
    assert.equal((await post('/start',{mode:'local',target:'2'})).status,202);
    const deadline=Date.now()+60000;
    while((starting||batchPromise||busy||automatic)&&Date.now()<deadline){if(paused&&pauseKind!=='resources')throw new Error('Prueba API frenada: '+paused);await new Promise(r=>setTimeout(r,100));}
    assert.equal(busy,false);assert.equal(sessions.length,2);assert.ok(sessions.every(s=>s.verified));
    assert.equal((await post('/accounts',accountFixture)).status,profile.platea?409:404);
    const wrongBot=await fetch(base+'/stop',{method:'POST',headers:{Origin:base,'X-Local-Token':token,'X-Client-Version':VERSION,'X-Bot-Kind':profile.platea?'queue':'platea'}});
    assert.equal(wrongBot.status,409);assert.equal(state().count,2);
    if(!profile.platea){assert.ok(sessions.every(s=>!s.autoEnabled&&!s.account));assert.equal(state().reservations,undefined);}
    if(profile.platea){assert.deepEqual(sessions.map(s=>s.account),['1','2']);attemptLog.record(sessions[0],{kind:'attempt',outcome:'empty',durationMs:20,timings:{preflightMs:10}});const exported=await fetch(base+'/diagnostics',{headers:{'X-Local-Token':token}});assert.equal(exported.status,200);assert.match(await exported.text(),/preflightMs/);}
    const panel=await browser.newPage({viewport:{width:1360,height:900}}),panelErrors=[];
    panel.on('pageerror',error=>panelErrors.push(error.message));
    await panel.goto(base,{waitUntil:'domcontentloaded'});
    await panel.waitForFunction(max=>document.querySelector('#count').textContent==='2 / '+max,maxSessions());
    assert.equal(await panel.locator('#accounts-form').count(),profile.platea?1:0);
    assert.equal(await panel.locator('h1').textContent(),profile.platea?'Dos socios. Dos sesiones.':'Tus filas, en un panel propio.');
    assert.deepEqual(panelErrors,[]);
    if(!profile.platea){
      assert.equal(await panel.locator('.preview-panel').count(),0);
      assert.equal(await panel.locator('[data-close-session]').count(),2);
      const removed=sessions[0],kept=sessions[1];
      await panel.locator('[data-close-session="'+removed.id+'"]').click();
      await panel.waitForFunction(max=>document.querySelector('#count').textContent==='1 / '+max,maxSessions());
      assert.equal(removed.page.isClosed(),true);assert.equal(kept.page.isClosed(),false);
      assert.equal(sessions[0],kept);assert.equal(state().automatic,false);await verify(kept);
      assert.equal((await post('/session-close',{id:-1})).status,400);
      assert.equal((await post('/session-close',{id:999999})).status,404);
      assert.equal((await post('/start',{mode:'local',target:'2'})).status,202);
      const refillDeadline=Date.now()+60000;
      while((starting||batchPromise||busy||automatic)&&Date.now()<refillDeadline){if(paused&&pauseKind!=='resources')throw new Error(paused);await new Promise(r=>setTimeout(r,100));}
      assert.equal(sessions.length,2);assert.equal(sessions[0],kept);
      assert.ok(sessions[1].id>kept.id);assert.equal(new Set(sessions.map(s=>s.id)).size,2);
      await panel.setViewportSize({width:1900,height:900});
      const width=await panel.evaluate(()=>({list:document.querySelector('#sessions').getBoundingClientRect().width,workspace:document.querySelector('.workspace').getBoundingClientRect().width}));
      assert.ok(Math.abs(width.list-width.workspace)<2);
      assert.deepEqual(panelErrors,[]);
      console.log('PASS individual: cierra solo una sesión, conserva la otra, evita IDs repetidos y usa todo el ancho.');
    }
    if(profile.platea){assert.match(await panel.locator('#attempt-log').textContent(),/Preparación/);assert.equal(await panel.locator('#target').inputValue(),'2');}
    if(profile.platea){
      await panel.locator('#reservation-sound').click();
      const testKey='__qc_test_reservation__';
      try{
        platea.ledger[testKey]={slot:'1',session:1,outcome:'reserved',at:new Date().toISOString()};
        await panel.waitForFunction(()=>!document.querySelector('#reservation-alert').hidden);
        assert.match(await panel.locator('#reservation-alert').textContent(),/Reserva confirmada/);
        assert.match(await panel.locator('#reservation-alert-items').textContent(),/Socio 1.*sesión 1/);
        assert.match(await panel.title(),/RESERVA CONFIRMADA/);
        await panel.locator('#reservation-alert-ack').click();
        assert.equal(await panel.locator('#reservation-alert').isHidden(),true);
        assert.equal(platea.ledger[testKey].outcome,'reserved');
        platea.ledger[testKey].outcome='uncertain';
        await panel.waitForFunction(()=>!document.querySelector('#reservation-alert').hidden);
        assert.match(await panel.locator('#reservation-alert-title').textContent(),/incierta/);
        await panel.locator('#reservation-alert-ack').click();
      }finally{delete platea.ledger[testKey];}
    }

    await panel.screenshot({path:path.join(dir,'panel-'+botKind+'-'+VERSION+'.png'),fullPage:true});
    await panel.close();


    assert.equal((await post('/start',{mode:'live',url:DEFAULT_ENTRY,target:'auto'})).status,409);
    assert.equal(state().mode,'local');assert.equal(state().count,2);
    assert.equal((await post('/pause')).status,200);assert.equal(state().pauseKind,'user');
    assert.equal((await post('/stop')).status,200);assert.equal(state().count,0);assert.equal(state().alive,false);assert.equal(state().cleanup,'Temporales eliminados');
    assert.equal(starting,false);assert.equal(runTemp,undefined);
    // Detener es idempotente y el panel permite volver a iniciar sin reiniciar Node.
    assert.equal((await post('/stop')).status,200);
    assert.equal((await post('/start',{mode:'local',target:profile.platea?'2':'1'})).status,202);
    const againDeadline=Date.now()+60000;
    while((starting||batchPromise||busy||automatic)&&Date.now()<againDeadline){if(paused&&pauseKind!=='resources')throw new Error(paused);await new Promise(r=>setTimeout(r,100));}
    assert.equal(sessions.length,profile.platea?2:1);assert.equal(state().alive,true);
    if(!profile.platea){assert.equal((await post('/session-close',{id:sessions[0].id})).status,200);assert.equal(state().count,0);assert.equal(state().alive,false);assert.equal(state().cleanup,'Temporales eliminados');}
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
    const expected=Math.min(5,maxSessions());
    await add(expected);
    if(sessions.length!==expected || !sessions.every(s=>s.verified))throw new Error('La prueba no pudo crear y verificar cinco sesiones con el margen de recursos disponible.');
    const cookies=await Promise.all(sessions.map(s=>s.context.cookies(base)));
    if(new Set(cookies.map(c=>c.find(v=>v.name==='isolation-marker')?.value)).size!==expected)throw new Error('Las cookies no son distintas.');
    console.log('PASS: 5 contextos, cookies distintas, localStorage distinto, persistencia tras recarga.');
    await shutdown();
  }
}catch(error){console.error(error.message);await shutdown();process.exitCode=1;}

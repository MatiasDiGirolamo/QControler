// Managed browser worker. No extension install, overlay, map-color scraping or DOM clicks.
(() => {
  'use strict';
  if(window!==window.top||location.origin!=='https://bocasocios.bocajuniors.com.ar'||window.__qcWorkerLoaded)return;
  window.__qcWorkerLoaded=true;
  let running=false,busy=false,run=0,timer,matchId=null;
  const state={running:false,phase:'waiting',retryAt:0,status:'Esperando acceso al partido'};
  const onMap=()=>location.pathname===`/matches/${matchId}/plateas`||location.pathname===`/matches/${matchId}/plateas/`;
  function request(type,responseType,data={},timeout=5500){return new Promise(resolve=>{
    const id=Date.now()+Math.random();
    const done=value=>{clearTimeout(limit);window.removeEventListener('message',listener);resolve(value);};
    const listener=event=>{if(event.source===window&&event.origin===location.origin&&event.data?.type===responseType&&event.data.id===id)done(event.data);};
    const limit=setTimeout(()=>done({error:'timeout'}),timeout);
    window.addEventListener('message',listener);window.postMessage({type,id,matchId,...data},location.origin);
  });}
  function report(data){void window.__qcPlatea('telemetry',data).catch(()=>{});}
  function stop(message){running=false;run++;clearTimeout(timer);state.running=false;state.phase='stopped';state.status=message;state.retryAt=0;window.postMessage({type:'la-previa:cancel'},location.origin);void window.__qcPlatea('stop').catch(()=>{});}
  function schedule(delay,message){
    if(!running)return;
    clearTimeout(timer);state.phase='waiting';state.retryAt=Date.now()+delay;state.status=message;
    timer=setTimeout(()=>void tick(),delay);
  }
  async function tick(){
    if(!running||busy)return;
    if(!onMap())return stop('Fuera del mapa del partido. Revisá la sesión.');
    if(/captcha|acceso denegado|sesión (?:ha )?(?:expirado|vencida)/i.test(document.body?.innerText||''))return stop('Boca requiere atención en esta sesión.');
    busy=true;let reservationAttempted=false;const token=run,started=Date.now();state.phase='availability';state.retryAt=0;
    try{
      const available=await request('la-previa:poll','la-previa:availability');
      if(!running||run!==token)return;
      if(available.blocked){report({kind:'availability',outcome:'blocked',httpStatus:available.httpStatus});return stop(available.message||'Acceso o cuenta requiere revisión.');}
      if(available.retryAfterMs){if(available.httpStatus)report({kind:'availability',outcome:'retry',httpStatus:available.httpStatus,durationMs:Date.now()-started});schedule(available.retryAfterMs,available.message||'Esperando turno de consulta');return;}
      if(!Array.isArray(available.sections)){report({kind:'availability',outcome:'retry',httpStatus:available.httpStatus,durationMs:Date.now()-started});schedule(20000,'Consulta fallida. Reintento automático en 20 segundos.');return;}
      const free=available.sections.filter(s=>s.activa&&s.libre&&Number.isSafeInteger(s.nid)&&s.nid>0);
      report({kind:'availability',outcome:free.length?'found':'empty',count:free.length,durationMs:Date.now()-started});
      if(!free.length){schedule(3000,'Sin disponibilidad. La búsqueda continúa.');return;}
      if(!available.fastReady)return stop('No se reconoce el cliente HTTP de Boca. Se requiere revisión.');
      const section=free[Math.floor(Math.random()*free.length)];state.phase='reservation';state.status='Disponibilidad detectada. Intentando reservar.';
      const attemptAt=Date.now();
      reservationAttempted=true;const result=await request('la-previa:fast-reserve','la-previa:fast-result',{sectionId:section.nid,detectedAt:attemptAt},45000);
      report({kind:'attempt',outcome:result.outcome||'uncertain',section:section.codigo,durationMs:Date.now()-attemptAt,httpStatus:result.httpStatus,timings:result.timings});
      if(result.outcome==='reserved'){
        const active=running&&run===token;stop('Reserva confirmada. Revisá el carrito y completá el pago.');
        if(active&&onMap())await request('la-previa:navigate','la-previa:navigation',{page:result.canContinue?'purchase':'seats',sectionId:section.nid},10000);
        return;
      }
      if(!running||run!==token)return;
      if(result.outcome==='taken'){schedule(0,'Asiento rechazado y carrito vacío. Volviendo a buscar sin espera adicional.');return;}
      if(['deferred','empty','retry'].includes(result.outcome)){schedule(result.retryAfterMs||(result.outcome==='retry'?20000:3000),result.message||'Continuando la búsqueda.');return;}
      stop(result.message||'Reserva no confirmada. Revisá el carrito antes de otro intento.');
    }catch{if(running&&run===token){if(reservationAttempted){report({kind:'attempt',outcome:'uncertain',durationMs:Date.now()-started});stop('Error durante el intento. Revisá el carrito; no se repite la reserva.');}else schedule(20000,'Error temporal. Reintento automático en 20 segundos.');}}
    finally{busy=false;}
  }
  window.__qcAutoStart=async expectedMatch=>{
    if(!/^\d+$/.test(String(expectedMatch)))return false;
    matchId=String(expectedMatch);if(!onMap())return false;
    if(running)return true;if(busy)return false;
    const allowed=await window.__qcPlatea('start');if(!allowed.ok){state.status=allowed.message;return false;}
    running=true;run++;state.running=true;void tick();return true;
  };
  window.__qcWorkerState=()=>({...state});
  window.__qcSetAccess=message=>{if(!running)state.status=String(message).slice(0,250);};
  window.addEventListener('message',event=>{if(event.source===window&&event.origin===location.origin&&event.data?.type==='la-previa:managed-stop')stop('Detenido por el usuario.');});
})();

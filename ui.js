'use strict';
const byId=id=>document.getElementById(id);
let working=false,lastSignature='',previewUrl,currentCount=0,chosen=null,toastTimer,lastState,initialized=false;
const snapshots=new SnapshotGate();
const needsAttention=s=>['Requiere atención','Error de carga','Fila finalizada','Fila vencida'].includes(s.queueState);
function notify(message){byId('toast').textContent=message;byId('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>byId('toast').hidden=true,6500);}
const reservationAlerts=botKind==='platea'?new ReservationAlerts(sessionStorage):null;
let reservationAudio,reservationAlarm,reservationAlertSignature='';
async function armReservationSound(test=false){
  try{reservationAudio||=new AudioContext();await reservationAudio.resume();byId('reservation-sound-status').textContent=reservationAudio.state==='running'?'Sonido activado · mantené abierto el panel':'El navegador necesita que actives el sonido';if(test)playReservationSound();}catch{byId('reservation-sound-status').textContent='Sonido no disponible. Los avisos quedan visibles en este panel.';}
}
function playReservationSound(){
  if(reservationAudio?.state!=='running')return;
  try{for(const offset of [0,.35,.7]){const oscillator=reservationAudio.createOscillator(),gain=reservationAudio.createGain(),t=reservationAudio.currentTime+offset;oscillator.frequency.value=880;gain.gain.setValueAtTime(.15,t);gain.gain.exponentialRampToValueAtTime(.001,t+.25);oscillator.connect(gain).connect(reservationAudio.destination);oscillator.start(t);oscillator.stop(t+.26);}}catch{}
}
function renderReservationAlerts(records){
  const fresh=reservationAlerts.update(records),pending=reservationAlerts.pending(records);
  const signature=JSON.stringify(pending);
  if(signature!==reservationAlertSignature){
    reservationAlertSignature=signature;
    const banner=byId('reservation-alert');banner.hidden=!pending.length;
    const confirmed=pending.some(r=>r.outcome==='reserved');
    byId('reservation-alert-title').textContent=confirmed?'¡Reserva confirmada! Completá el pago':'Reserva incierta · revisá el carrito';
    document.title=pending.length?(confirmed?'¡RESERVA CONFIRMADA!':'REVISAR RESERVA')+' · QController Platea':'QController · Platea';
    byId('reservation-alert-items').replaceChildren();
    for(const r of pending){const row=document.createElement('p');row.textContent='Socio '+r.slot+' · sesión '+r.session+' · '+(r.outcome==='reserved'?'asiento confirmado en el carrito':'resultado incierto; no se vuelve a reservar automáticamente')+' ';const open=document.createElement('button');open.className='primary';open.textContent=r.sessionAvailable===false?'Sesión original cerrada':'Abrir sesión '+r.session;open.disabled=r.sessionAvailable===false;open.onclick=()=>action('/session-open',{id:r.session});row.append(open);byId('reservation-alert-items').append(row);}
  }
  if(fresh.length){playReservationSound();notify(fresh.some(r=>r.outcome==='reserved')?'¡Boca confirmó una reserva! Revisá el aviso del panel.':'Hay una reserva incierta. Revisá el carrito.');}
  if(pending.length&&!reservationAlarm)reservationAlarm=setInterval(playReservationSound,15000);
  if(!pending.length&&reservationAlarm){clearInterval(reservationAlarm);reservationAlarm=null;}
}
function hint(){if(botKind==='platea'){byId('target-hint').textContent='Dos sesiones fijas, una por socio. Control y avisos desde esta app.';return;}const auto=byId('target').value==='auto';const n=Math.max(0,(auto?50:Number(byId('target').value))-currentCount);byId('target-hint').textContent=auto?'Agrega sesiones gradualmente, hasta 50, sin mínimo de RAM; sujeto al límite de CPU.':n?'Se agregarán '+n+' sesiones al iniciar.':'Ese total ya está alcanzado. No se cerrarán sesiones.';}
async function request(route,method='GET',body){const res=await fetch(route,{method,signal:AbortSignal.timeout(method==='GET'?5000:30000),headers:{'X-Local-Token':token,'X-Client-Version':appVersion,'X-Bot-Kind':botKind,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!res.ok){const data=await res.json();throw new Error(data.error||'Error local');}return res;}
async function showSession(session){try{const res=await request('/preview?id='+session.id,'POST');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(await res.blob());byId('preview').src=previewUrl;byId('preview').hidden=false;byId('preview-empty').hidden=true;byId('preview-title').textContent='Sesión '+String(session.id).padStart(2,'0');chosen=session.id;for(const card of byId('sessions').children)card.setAttribute('aria-pressed',String(Number(card.dataset.id)===chosen));}catch(e){notify(e.message);}}
function renderSessions(s){
  const signature=JSON.stringify({sessions:s.sessions.map(({checkedAt,...rest})=>rest),working,closing:s.closing,canClose:s.features?.closeSession});
  if(signature===lastSignature)return;lastSignature=signature;byId('sessions').replaceChildren();
  for(const session of s.sessions){
    const card=document.createElement('article');card.className='session';card.dataset.id=session.id;if(botKind==='platea')card.setAttribute('aria-pressed',String(chosen===session.id));
    const top=document.createElement(botKind==='queue'?'div':'button');top.className='session-top';top.textContent='Sesión '+String(session.id).padStart(2,'0')+(botKind==='platea'?' · ver imagen ↗':'');if(botKind==='platea')top.onclick=()=>showSession(session);
    const tag=document.createElement('span');tag.className='verified';tag.textContent=session.verified?'● Aislamiento local verificado':'○ Verificando';card.append(top,tag);
    const state=document.createElement('div');state.className='queue-data';state.textContent=session.queueState||'Preparando';card.append(state);
    if(s.mode==='live'){
      if(botKind==='platea'){
      const account=document.createElement('strong');account.textContent='Socio '+session.account;card.append(account);
      const platea=document.createElement('div');platea.className='queue-data';platea.textContent=session.platea||'Platea en espera';card.append(platea);
      const access=document.createElement('div');access.className='queue-data';access.textContent=session.access||'';card.append(access);
      const open=document.createElement('button');open.className='quiet';open.textContent='Abrir sesión / ingresar';open.onclick=()=>action('/session-open',{id:session.id});card.append(open);
      const resume=document.createElement('button');resume.className='quiet';resume.textContent='Iniciar / reanudar búsqueda';resume.onclick=()=>action('/session-run',{id:session.id});card.append(resume);
      if(session.lastAttempt){const last=document.createElement('p');last.className='queue-data';last.textContent='Último intento: '+session.lastAttempt.outcome+' · '+session.lastAttempt.durationMs+' ms';card.append(last);}
      const halt=document.createElement('button');halt.className='quiet';halt.textContent='Detener búsqueda';halt.onclick=()=>action('/session-stop',{id:session.id});card.append(halt);
      }
      if(botKind==='queue'){
      const wait=document.createElement('div');wait.className='wait-value';wait.textContent=session.queueState==='Prefila'?(session.openingTime?'Apertura de fila: '+session.openingTime:'Prefila · esperando la apertura'):(session.wait?'Espera para tu turno: '+session.wait:'Espera para tu turno: sin dato');card.append(wait);
      if(session.queueState==='Prefila'&&session.prefilaCountdown){const countdown=document.createElement('div');countdown.className='queue-data';countdown.textContent='Para abrir la fila: '+session.prefilaCountdown;card.append(countdown);}
      if(session.siteUpdatedAt){const updated=document.createElement('div');updated.className='queue-data';updated.textContent='Actualizado por la fila: '+session.siteUpdatedAt;card.append(updated);}
      const id=document.createElement('code');id.className='queue-id';id.textContent=session.queueId||'Sin identificador de fila asignado';card.append(id);
      const unique=document.createElement('div');unique.className='queue-data'+(session.duplicate?' duplicate':'');unique.textContent=needsAttention(session)?'Requiere revisión · no se cuenta como posición disponible':session.queueState==='Prefila'?'Prefila · todavía no informa una posición definitiva':session.queueId&&session.checkedAt?(session.duplicate?'⚠ Identificador duplicado':'✓ Identificador distinto entre estas sesiones'):'No se cuenta como posición independiente';card.append(unique);
      const field=document.createElement('input');field.className='queue-url';field.readOnly=true;field.setAttribute('aria-label','URL actual de sesión '+session.id);
      const copyLink=queueLinkFor(session,s.entryUrl);
      try{const url=new URL(session.currentUrl);url.searchParams.delete('queueittoken');field.value=copyLink||url.href;}catch{field.value='Leyendo dirección…';}card.append(field);
      const copy=document.createElement('button');copy.className='quiet';copy.textContent=session.queueState==='Prefila'?'Copiar enlace de esta sesión':'Copiar enlace de fila';copy.disabled=!copyLink||!session.checkedAt||needsAttention(session);
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(copyLink);notify('Enlace copiado. La transferencia debe comprobarse; conservá la sesión original.');}catch{field.focus();field.select();notify('Seleccioné el enlace. Copialo con Ctrl+C.');}};card.append(copy);
      const checked=document.createElement('div');checked.className='queue-data';checked.dataset.checked=session.id;card.append(checked);
      }
    }
    if(botKind==='queue'){
      const close=document.createElement('button');close.className='quiet danger close-session';close.textContent='Cerrar sesión';close.dataset.closeSession=session.id;
      close.setAttribute('aria-label','Cerrar sesión '+String(session.id).padStart(2,'0'));
      close.disabled=working||s.closing||session.removing||!s.features?.closeSession;
      close.title=s.features?.closeSession?'Cierra únicamente esta sesión.':'Reiniciá Filas para cargar la opción de cierre individual.';
      close.onclick=()=>{if(!working)action('/session-close',{id:session.id});};card.append(close);
    }
    byId('sessions').append(card);
  }
  if(!s.count&&byId('preview')){byId('preview').hidden=true;byId('preview-empty').hidden=false;byId('preview-title').textContent='Vista de sesión';chosen=null;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
}
async function refresh(){const ticket=snapshots.begin();try{
  const s=await(await request('/state')).json();if(!snapshots.accept(ticket))return;lastState=s;currentCount=s.count;
  if(s.version!==appVersion||s.botKind!==botKind){
    byId('message').textContent='Hay una versión anterior del programa abierta. Reiniciá la app y usá el panel de la consola. Recargar una pestaña vieja no actualiza el programa.';
    byId('badge').textContent='Reiniciar app';byId('badge').dataset.state='paused';
    for(const id of ['start','target','mode','resume','stop','entry-url'])byId(id).disabled=true;
    return;
  }
  if(!initialized){byId('mode').value=s.mode;byId('entry-url').value=s.entryUrl;byId('target').value=String(s.targetSetting);initialized=true;}
  if(botKind==='platea'){
  byId('accounts-status').textContent=s.accountAuto?.configured?(s.accountAuto.enabled?'Dos cuentas cargadas · acceso e inicio de Platea automáticos · '+s.accountAuto.matchUrl:'Cuentas cargadas · automático desactivado'):'Cargá los dos correos y contraseñas antes de iniciar Platea.';
  byId('accounts-save').disabled=working||s.count>0||s.starting||s.busy||s.closing;
  for(const id of ['account-1-user','account-1-password','account-2-user','account-2-password','match-url'])byId(id).disabled=s.count>0||s.starting||s.busy||s.closing;
  }
  hint();byId('count').textContent=s.count+' / '+s.max;byId('ram').textContent=s.freeGB.toFixed(1)+' GB';byId('reserve').textContent='Sin mínimo de RAM · '+s.totalGB.toFixed(1)+' GB totales';byId('cpu').textContent=s.cpu+' %';
  byId('message').textContent=(s.paused||s.status)+(s.pauseKind==='resources'&&s.automatic?' Reintento automático cuando haya margen estable.':'');
  if(botKind==='platea'&&s.retryAt>Date.now())byId('message').textContent='Boca limitó las consultas. Reanudación automática en '+Math.ceil((s.retryAt-Date.now())/1000)+' s. Las sesiones se conservan.';
  const active=s.automatic||s.busy||s.starting;
  const limit=byId('target').value==='auto'?s.max:Number(byId('target').value);
  byId('start').textContent=botKind==='platea'?(active?'Preparando las dos sesiones…':s.count?'Dos sesiones abiertas':'Iniciar las dos sesiones'):active?'Pausar creación':s.count?'Continuar creación ↗':'Iniciar automático ↗';
  byId('start').disabled=working||s.closing||s.cleanup==='Limpieza pendiente'||(!active&&(s.pauseKind==='site'||s.count>=limit||(botKind==='platea'&&s.mode==='live'&&!s.accountAuto?.configured)));
  byId('target').disabled=working||active||s.closing;
  byId('resume').hidden=!s.paused||s.automatic||!s.alive||s.pauseKind==='site';byId('resume').disabled=working||s.busy||!s.alive||s.sessions.some(needsAttention);
  byId('stop').disabled=s.closing||(!s.alive&&!s.starting&&!s.busy&&!s.automatic&&s.cleanup!=='Limpieza pendiente');
  for(const id of ['mode','entry-url'])byId(id).disabled=working||active||s.count>0||s.closing;
  byId('entry-url').required=byId('mode').value==='live';
  byId('mode-label').textContent=(botKind==='platea'?'Platea':'Filas')+(s.mode==='local'?' · prueba local':'');
  const url=byId('entry-url').value.trim();let info='Pegá el enlace completo de la prefila del próximo evento.';
  try{const u=new URL(url);if(u.hostname==='bocajuniors.queue-it.net')info='Boca · evento '+(u.searchParams.get('e')||'sin identificar')+' · se conservan destino e idioma del enlace.';else if(u.hostname==='bocasocios.bocajuniors.com.ar')info='Boca Socios. Para una prefila concreta, pegá su enlace cuando esté publicado.';else info='Entrada: '+u.hostname;}catch{}
  byId('config-summary').textContent=byId('mode').value==='local'?'Prueba local: verifica aislamiento sin abrir sitios externos.':botKind==='platea'?'Página de inicio de Boca. El partido se configura arriba, junto a las cuentas.':info;
  byId('entry-note').hidden=!s.entryNote;byId('entry-note').textContent=s.entryNote;
  byId('badge').textContent=s.closing?'Cerrando':s.starting?'Iniciando Chrome':s.pauseKind==='site'?'Requiere atención':s.pauseKind==='resources'&&s.automatic?'Esperando recursos':s.paused&&s.pauseKind!=='stopped'?'Creación pausada':!s.alive?'Chrome cerrado':active?'Creando sesiones':'Listo';byId('badge').dataset.state=!s.alive?'stopped':s.paused?'paused':'ready';
  byId('session-fill').style.width=s.count/s.max*100+'%';byId('ram-fill').style.width=Math.min(100,s.freeGB/s.totalGB*100)+'%';byId('cpu-fill').style.width=Math.min(100,s.cpu)+'%';byId('empty').hidden=s.count>0;
  const unique=s.sessions.filter(v=>v.queueId&&!v.duplicate&&v.checkedAt&&['En fila','Turno disponible'].includes(v.queueState)).length;
  const observed=s.sessions.filter(v=>v.queueId&&!v.duplicate&&v.checkedAt).length;
  byId('session-summary').textContent=botKind==='platea'?s.count+' monitores · '+(s.polling?.count||0)+' consultas · última respuesta válida: '+(s.polling?.lastSuccessAt?new Date(s.polling.lastSuccessAt).toLocaleTimeString():'todavía ninguna')+' · '+(s.polling?.queuedAccounts||0)+' cuentas esperando turno':s.mode==='live'?observed+' identificadores distintos observados · '+unique+' con lectura de fila · orden por turno y espera':s.count?s.sessions.filter(v=>v.verified).length+' de '+s.count+' con aislamiento verificado':'Cada contexto empieza limpio.';
  if(botKind==='platea'){
    const labels={empty:'Sin disponibilidad',found:'Disponibilidad detectada',reserved:'Reserva confirmada',uncertain:'Reserva incierta',blocked:'Acceso/cuenta requiere revisión',retry:'Consulta fallida · reintento',taken:'Asiento agotado',deferred:'Turno de reserva ocupado',stopped:'Detenido',unavailable:'Cliente no disponible',busy:'Intento en curso'};
    const timingLabels={memberMs:'Socio',cartBeforeMs:'Carrito previo',seatsMs:'Asientos',preflightMs:'Preparación',coordinationMs:'Bloqueo de reserva',detectToPostMs:'Detección a inicio de solicitud',reserveMs:'Llamada HTTP de reserva',assignmentMs:'Asignación',confirmationMs:'Confirmación',totalMs:'Total'};
    byId('attempt-log').textContent=(s.events||[]).slice().reverse().map(e=>new Date(e.at).toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'})+' · Socio '+e.account+' · '+(labels[e.outcome]||e.outcome)+(e.section?' · sector '+e.section:'')+(e.durationMs!=null?' · '+e.durationMs+' ms':'')+(e.httpStatus?' · HTTP '+e.httpStatus:'')+(e.timings?'\n  '+Object.entries(e.timings).map(([key,value])=>(timingLabels[key]||key)+'='+value+' ms').join(' · '):'')).join('\n')||'Esperando consultas…';
  }
  if(reservationAlerts)renderReservationAlerts(s.reservations||[]);
  const reservations=byId('reservations');if(reservations)reservations.replaceChildren();
  for(const r of reservations?s.reservations||[]:[]){
    const row=document.createElement('p');row.textContent='Socio '+r.slot+' · sesión '+r.session+' · '+({pending:'Reserva pendiente de confirmación',reserved:'Reserva confirmada',uncertain:'Reserva incierta'}[r.outcome]||r.outcome)+' ';
    const review=document.createElement('button');review.className='quiet';review.textContent='Carrito revisado: habilitar otra búsqueda';review.onclick=()=>{if(confirm('Confirmá que revisaste el carrito de este socio, que no hay una reserva o compra pendiente y que querés habilitar otra búsqueda. Esto no cancela entradas.'))action('/platea-reviewed',{account:r.slot,confirmed:true});};row.append(review);reservations.append(row);
  }
  renderSessions(s);
  for(const session of s.sessions){const node=byId('sessions').querySelector('[data-checked="'+session.id+'"]');if(node)node.textContent=session.checkedAt?'Última lectura: '+new Date(session.checkedAt).toLocaleTimeString():'Lectura actual no disponible';}
}catch(e){if(!snapshots.accept(ticket))return;byId('message').textContent='Sin conexión con el programa. Revisá la consola.';byId('badge').textContent='Desconectado';byId('badge').dataset.state='stopped';for(const id of ['start','target','mode','resume','stop'])byId(id).disabled=true;}}
async function action(route,body){snapshots.invalidate();working=true;byId('start').disabled=true;try{await request(route,'POST',body);}catch(e){notify(e.name==='TimeoutError'?'La operación está tardando. Se seguirá consultando el estado del programa.':e.message);}finally{snapshots.invalidate();working=false;await refresh();}}
byId('target').onchange=()=>refresh();byId('mode').onchange=()=>refresh();byId('entry-url').oninput=()=>refresh();
byId('start-form').onsubmit=event=>{
  event.preventDefault();
  if(botKind==='platea')void armReservationSound();
  if(working)return;
  if(lastState?.automatic||lastState?.busy||lastState?.starting){action('/pause');return;}
  action('/start',{mode:byId('mode').value,url:byId('entry-url').value.trim(),target:byId('target').value});
};
byId('resume').onclick=()=>action('/resume');byId('stop').onclick=()=>{
  if(lastState?.mode==='live'&&lastState.count&&!confirm(botKind==='platea'?'Esto cierra solo las sesiones de Platea. Podés perder el acceso a reservas pendientes. ¿Finalizar?':'Esto cierra solo las sesiones de Filas. Podés perder posiciones. ¿Finalizar?'))return;
  action('/stop');
};
if(botKind==='platea'){
byId('download-log').onclick=async()=>{try{const response=await request('/diagnostics');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='platea-registro.jsonl';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{notify('No pude descargar el registro.');}};
byId('reservation-sound').onclick=()=>armReservationSound(true);
byId('reservation-alert-ack').onclick=()=>{reservationAlerts.acknowledge(lastState?.reservations||[]);renderReservationAlerts(lastState?.reservations||[]);};
byId('accounts-form').onsubmit=async event=>{
  event.preventDefault();if(working)return;
  const input={accounts:{'1':{user:byId('account-1-user').value,password:byId('account-1-password').value},'2':{user:byId('account-2-user').value,password:byId('account-2-password').value}},matchUrl:byId('match-url').value.trim()};
  snapshots.invalidate();working=true;
  try{await request('/accounts','POST',input);for(const slot of ['1','2']){byId('account-'+slot+'-password').value='';byId('account-'+slot+'-user').value='';}notify('Cuentas cargadas. Elegí la cantidad e iniciá las sesiones.');}
  catch{notify('No se pudieron cargar las cuentas. Completá los dos correos y contraseñas y un enlace válido de partido, antes de iniciar.');}
  finally{input.accounts=null;snapshots.invalidate();working=false;await refresh();}
};
byId('accounts-clear').onclick=async()=>{for(const slot of ['1','2']){byId('account-'+slot+'-password').value='';byId('account-'+slot+'-user').value='';}await action('/accounts-clear');};
}
byId('open-other').onclick=()=>action('/open-other');
byId('quit').onclick=async()=>{if(lastState?.count&&!confirm('Esto cierra las sesiones de este bot y termina su programa. Podés perder el acceso a una fila o carrito pendiente. ¿Cerrar?'))return;byId('quit').disabled=true;snapshots.invalidate();try{await request('/quit','POST');snapshots.invalidate();clearInterval(refreshTimer);document.title='QController cerrado';byId('message').textContent='Programa cerrado. Podés cerrar esta pestaña. Para volver a usarlo, ejecutá su archivo INICIAR.';byId('badge').textContent='Programa cerrado';for(const id of ['start','resume','stop','open-other'])byId(id).disabled=true;}catch(e){notify('No pude cerrar el programa: '+e.message);byId('quit').disabled=false;}};
refresh();const refreshTimer=setInterval(refresh,2000);

'use strict';
const byId=id=>document.getElementById(id);
let working=false,lastSignature='',previewUrl,currentCount=0,chosen=null,toastTimer,lastState,initialized=false;
const snapshots=new SnapshotGate();
const needsAttention=s=>['Requiere atención','Error de carga','Fila finalizada'].includes(s.queueState);
function notify(message){byId('toast').textContent=message;byId('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>byId('toast').hidden=true,6500);}
function hint(){const auto=byId('target').value==='auto';const n=Math.max(0,(auto?50:Number(byId('target').value))-currentCount);byId('target-hint').textContent=auto?'Agrega sesiones gradualmente, hasta 50, según RAM y CPU.':n?'Se agregarán '+n+' sesiones al iniciar.':'Ese total ya está alcanzado. No se cerrarán sesiones.';}
async function request(route,method='GET',body){const res=await fetch(route,{method,signal:AbortSignal.timeout(method==='GET'?5000:30000),headers:{'X-Local-Token':token,'X-Client-Version':appVersion,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!res.ok){const data=await res.json();throw new Error(data.error||'Error local');}return res;}
async function showSession(session){try{const res=await request('/preview?id='+session.id,'POST');if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(await res.blob());byId('preview').src=previewUrl;byId('preview').hidden=false;byId('preview-empty').hidden=true;byId('preview-title').textContent='Sesión '+String(session.id).padStart(2,'0');chosen=session.id;for(const card of byId('sessions').children)card.setAttribute('aria-pressed',String(Number(card.dataset.id)===chosen));}catch(e){notify(e.message);}}
function renderSessions(s){
  const signature=JSON.stringify(s.sessions.map(({checkedAt,...rest})=>rest));
  if(signature===lastSignature)return;lastSignature=signature;byId('sessions').replaceChildren();
  for(const session of s.sessions){
    const card=document.createElement('article');card.className='session';card.dataset.id=session.id;card.setAttribute('aria-pressed',String(chosen===session.id));
    const top=document.createElement('button');top.className='session-top';top.textContent='Sesión '+String(session.id).padStart(2,'0')+' · ver imagen ↗';top.onclick=()=>showSession(session);
    const tag=document.createElement('span');tag.className='verified';tag.textContent=session.verified?'● Aislamiento local verificado':'○ Verificando';card.append(top,tag);
    const state=document.createElement('div');state.className='queue-data';state.textContent=session.queueState||'Preparando';card.append(state);
    if(s.mode==='live'){
      const wait=document.createElement('div');wait.className='wait-value';wait.textContent=session.wait?'Espera informada: '+session.wait:'Espera: sin dato';card.append(wait);
      if(session.siteUpdatedAt){const updated=document.createElement('div');updated.className='queue-data';updated.textContent='Actualizado por la fila: '+session.siteUpdatedAt;card.append(updated);}
      const id=document.createElement('code');id.className='queue-id';id.textContent=session.queueId||'Sin identificador de fila asignado';card.append(id);
      const unique=document.createElement('div');unique.className='queue-data'+(session.duplicate?' duplicate':'');unique.textContent=needsAttention(session)?'Requiere revisión · no se cuenta como posición disponible':session.queueState==='Prefila'?'Prefila · todavía no informa una posición definitiva':session.queueId&&session.checkedAt?(session.duplicate?'⚠ Identificador duplicado':'✓ Identificador distinto entre estas sesiones'):'No se cuenta como posición independiente';card.append(unique);
      const field=document.createElement('input');field.className='queue-url';field.readOnly=true;field.setAttribute('aria-label','URL actual de sesión '+session.id);
      try{const url=new URL(session.currentUrl);url.searchParams.delete('queueittoken');field.value=session.queueLink||url.href;}catch{field.value='Leyendo dirección…';}card.append(field);
      const copy=document.createElement('button');copy.className='quiet';copy.textContent='Copiar enlace de fila';copy.disabled=!session.queueId||!session.checkedAt||needsAttention(session);
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(session.queueLink||session.currentUrl);notify('Enlace copiado. La transferencia debe comprobarse; conservá la sesión original.');}catch{field.focus();field.select();notify('Seleccioné el enlace. Copialo con Ctrl+C.');}};card.append(copy);
      const checked=document.createElement('div');checked.className='queue-data';checked.dataset.checked=session.id;card.append(checked);
    }
    byId('sessions').append(card);
  }
  if(!s.count){byId('preview').hidden=true;byId('preview-empty').hidden=false;byId('preview-title').textContent='Vista de sesión';chosen=null;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
}
async function refresh(){const ticket=snapshots.begin();try{
  const s=await(await request('/state')).json();if(!snapshots.accept(ticket))return;lastState=s;currentCount=s.count;
  if(s.version!==appVersion){
    byId('message').textContent='Hay una versión anterior del programa abierta. Reiniciá la app y usá el panel de la consola. Recargar una pestaña vieja no actualiza el programa.';
    byId('badge').textContent='Reiniciar app';byId('badge').dataset.state='paused';
    for(const id of ['start','target','mode','resume','stop','entry-url'])byId(id).disabled=true;
    return;
  }
  if(!initialized){byId('mode').value=s.mode;byId('entry-url').value=s.entryUrl;byId('target').value=String(s.targetSetting);initialized=true;}
  hint();byId('count').textContent=s.count+' / '+s.max;byId('ram').textContent=s.freeGB.toFixed(1)+' GB';byId('reserve').textContent='Reserva mínima: '+s.reserveGB.toFixed(1)+' GB de '+s.totalGB.toFixed(1)+' GB';byId('cpu').textContent=s.cpu+' %';
  byId('message').textContent=(s.paused||s.status)+(s.pauseKind==='resources'&&s.automatic?' Reintento automático cuando haya margen estable.':'');
  const active=s.automatic||s.busy||s.starting;
  const limit=byId('target').value==='auto'?s.max:Number(byId('target').value);
  byId('start').textContent=active?'Pausar creación':s.count?'Continuar creación ↗':'Iniciar automático ↗';
  byId('start').disabled=working||s.closing||s.cleanup==='Limpieza pendiente'||(!active&&(s.pauseKind==='site'||s.count>=limit));
  byId('target').disabled=working||active||s.closing;
  byId('resume').hidden=!s.paused||s.automatic||!s.alive||s.pauseKind==='site';byId('resume').disabled=working||s.busy||!s.alive||s.sessions.some(needsAttention);
  byId('stop').disabled=s.closing||(!s.alive&&!s.starting&&!s.busy&&!s.automatic&&s.cleanup!=='Limpieza pendiente');
  for(const id of ['mode','entry-url'])byId(id).disabled=working||active||s.count>0||s.closing;
  byId('entry-url').required=byId('mode').value==='live';
  byId('mode-label').textContent=s.mode==='live'?'Boca / fila real':'Prueba local';
  const url=byId('entry-url').value.trim();let info='Pegá el enlace completo de la prefila del próximo evento.';
  try{const u=new URL(url);if(u.hostname==='bocajuniors.queue-it.net')info='Boca · evento '+(u.searchParams.get('e')||'sin identificar')+' · se conservan destino e idioma del enlace.';else if(u.hostname==='bocasocios.bocajuniors.com.ar')info='Boca Socios. Para una prefila concreta, pegá su enlace cuando esté publicado.';else info='Entrada: '+u.hostname;}catch{}
  byId('config-summary').textContent=byId('mode').value==='local'?'Prueba local: verifica aislamiento sin abrir sitios externos.':info;
  byId('entry-note').hidden=!s.entryNote;byId('entry-note').textContent=s.entryNote;
  byId('badge').textContent=s.closing?'Cerrando':s.starting?'Iniciando Chrome':s.pauseKind==='site'?'Requiere atención':s.pauseKind==='resources'&&s.automatic?'Esperando recursos':s.paused&&s.pauseKind!=='stopped'?'Creación pausada':!s.alive?'Chrome cerrado':active?'Creando sesiones':'Listo';byId('badge').dataset.state=!s.alive?'stopped':s.paused?'paused':'ready';
  byId('session-fill').style.width=s.count/s.max*100+'%';byId('ram-fill').style.width=Math.min(100,s.freeGB/s.totalGB*100)+'%';byId('cpu-fill').style.width=Math.min(100,s.cpu)+'%';byId('empty').hidden=s.count>0;
  const unique=s.sessions.filter(v=>v.queueId&&!v.duplicate&&v.checkedAt&&['En fila','Turno disponible'].includes(v.queueState)).length;
  const observed=s.sessions.filter(v=>v.queueId&&!v.duplicate&&v.checkedAt).length;
  byId('session-summary').textContent=s.mode==='live'?observed+' identificadores distintos observados · '+unique+' con lectura de fila · orden por turno y espera':s.count?s.sessions.filter(v=>v.verified).length+' de '+s.count+' con aislamiento verificado':'Cada contexto empieza limpio.';
  renderSessions(s);
  for(const session of s.sessions){const node=byId('sessions').querySelector('[data-checked="'+session.id+'"]');if(node)node.textContent=session.checkedAt?'Última lectura: '+new Date(session.checkedAt).toLocaleTimeString():'Lectura actual no disponible';}
}catch(e){if(!snapshots.accept(ticket))return;byId('message').textContent='Sin conexión con el programa. Revisá la consola.';byId('badge').textContent='Desconectado';byId('badge').dataset.state='stopped';for(const id of ['start','target','mode','resume','stop'])byId(id).disabled=true;}}
async function action(route,body){snapshots.invalidate();working=true;byId('start').disabled=true;try{await request(route,'POST',body);}catch(e){notify(e.name==='TimeoutError'?'La operación está tardando. Se seguirá consultando el estado del programa.':e.message);}finally{snapshots.invalidate();working=false;await refresh();}}
byId('target').onchange=()=>refresh();byId('mode').onchange=()=>refresh();byId('entry-url').oninput=()=>refresh();
byId('start-form').onsubmit=event=>{
  event.preventDefault();
  if(working)return;
  if(lastState?.automatic||lastState?.busy||lastState?.starting){action('/pause');return;}
  action('/start',{mode:byId('mode').value,url:byId('entry-url').value.trim(),target:byId('target').value});
};
byId('resume').onclick=()=>action('/resume');byId('stop').onclick=()=>{
  if(lastState?.mode==='live'&&lastState.count&&!confirm('Esto cierra las sesiones y elimina sus temporales. Podés perder posiciones de fila. ¿Finalizar?'))return;
  action('/stop');
};
refresh();setInterval(refresh,2000);

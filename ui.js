'use strict';
const byId=id=>document.getElementById(id);
let working=false,lastSignature='',previewUrl,currentCount=0,chosen=null,toastTimer,lastState,initialized=false;
function notify(message){byId('toast').textContent=message;byId('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>byId('toast').hidden=true,6500);}
function hint(){const n=Math.max(0,Number(byId('target').value)-currentCount);byId('target-hint').textContent=n?'Se agregarán '+n+' sesiones al pulsar Aplicar.':'Ese total ya está alcanzado. No se cerrarán sesiones.';}
async function request(route,method='GET',body){const res=await fetch(route,{method,headers:{'X-Local-Token':token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});if(!res.ok){const data=await res.json();throw new Error(data.error||'Error local');}return res;}
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
      const id=document.createElement('code');id.className='queue-id';id.textContent=session.queueId||'Sin identificador de fila asignado';card.append(id);
      const unique=document.createElement('div');unique.className='queue-data'+(session.duplicate?' duplicate':'');unique.textContent=session.queueId&&session.checkedAt?(session.duplicate?'⚠ Identificador duplicado':'✓ Identificador distinto entre estas sesiones'):'No se cuenta como posición independiente';card.append(unique);
      const field=document.createElement('input');field.className='queue-url';field.readOnly=true;field.setAttribute('aria-label','URL actual de sesión '+session.id);
      try{const url=new URL(session.currentUrl);url.searchParams.delete('queueittoken');field.value=url.href;}catch{field.value='Leyendo dirección…';}card.append(field);
      const copy=document.createElement('button');copy.className='quiet';copy.textContent='Copiar enlace de fila';copy.disabled=!session.queueId||!session.checkedAt;
      copy.onclick=async()=>{try{await navigator.clipboard.writeText(session.currentUrl);notify('Enlace copiado. La transferencia debe comprobarse; conservá la sesión original.');}catch{field.focus();field.select();notify('Seleccioné el enlace. Copialo con Ctrl+C.');}};card.append(copy);
      const checked=document.createElement('div');checked.className='queue-data';checked.dataset.checked=session.id;card.append(checked);
    }
    byId('sessions').append(card);
  }
  if(!s.count){byId('preview').hidden=true;byId('preview-empty').hidden=false;byId('preview-title').textContent='Vista de sesión';chosen=null;if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}}
}
async function refresh(){try{
  const s=await(await request('/state')).json();lastState=s;currentCount=s.count;
  if(!initialized){byId('mode').value=s.mode;byId('entry-url').value=s.entryUrl;initialized=true;}
  for(const option of byId('target').options)option.disabled=Number(option.value)>s.max;
  if(Number(byId('target').value)>s.max)byId('target').value='2';
  hint();byId('count').textContent=s.count+' / '+s.max;byId('ram').textContent=s.freeGB.toFixed(1)+' GB';byId('reserve').textContent='Reserva mínima: '+s.reserveGB.toFixed(1)+' GB de '+s.totalGB.toFixed(1)+' GB';byId('cpu').textContent=s.cpu+' %';byId('message').textContent=s.paused||s.status;
  const dirty=byId('mode').value!==s.mode||(s.mode==='live'&&byId('entry-url').value.trim()!==s.entryUrl);
  byId('apply').disabled=working||s.busy||!!s.paused||!s.alive||s.count>=s.max||Number(byId('target').value)<=s.count||dirty;
  byId('target').disabled=working||s.busy||!s.alive;byId('resume').disabled=working||!s.paused||s.busy||!s.alive;byId('resume').hidden=!s.paused||!s.alive;byId('stop').disabled=working||!s.alive;
  for(const id of ['mode','entry-url','configure'])byId(id).disabled=working||s.busy||s.count>0||!s.alive;
  byId('entry-url').hidden=byId('mode').value!=='live';document.querySelector('label[for="entry-url"]').hidden=byId('entry-url').hidden;
  byId('mode-label').textContent=s.mode==='live'?'Web real · piloto':'Prueba local';
  byId('config-summary').textContent=dirty?'Hay cambios sin guardar. Pulsá Guardar modo y enlace.':s.mode==='live'?'Configurado: '+s.entryUrl+' · La fila se observa sin recargar.':'Prueba local: no se conecta a sitios externos.';
  byId('badge').textContent=!s.alive?'Detenido':s.paused?'Creación pausada':s.busy?'Creando sesiones':'Listo';byId('badge').dataset.state=!s.alive?'stopped':s.paused?'paused':'ready';byId('session-fill').style.width=s.count/s.max*100+'%';byId('ram-fill').style.width=Math.min(100,s.freeGB/s.totalGB*100)+'%';byId('cpu-fill').style.width=Math.min(100,s.cpu)+'%';byId('empty').hidden=s.count>0;
  const unique=s.sessions.filter(v=>v.queueId&&!v.duplicate&&v.checkedAt).length;
  byId('session-summary').textContent=s.mode==='live'?unique+' identificadores únicos · ordenados por turno o espera numérica disponible':s.count?s.sessions.filter(v=>v.verified).length+' de '+s.count+' con aislamiento verificado':'Cada contexto empieza limpio.';
  renderSessions(s);
  for(const session of s.sessions){const node=byId('sessions').querySelector('[data-checked="'+session.id+'"]');if(node)node.textContent=session.checkedAt?'Última lectura: '+new Date(session.checkedAt).toLocaleTimeString():'Lectura actual no disponible';}
}catch(e){byId('message').textContent='Sin conexión con el programa. Revisá la consola.';byId('badge').textContent='Desconectado';byId('badge').dataset.state='stopped';for(const id of ['apply','target','resume','stop','configure'])byId(id).disabled=true;}}
async function action(route,body){working=true;byId('apply').disabled=true;try{await request(route,'POST',body);}catch(e){notify(e.message);}finally{working=false;await refresh();}}
byId('target').onchange=()=>{hint();refresh();};
byId('mode').onchange=()=>refresh();byId('entry-url').oninput=()=>refresh();
byId('configure').onclick=()=>action('/configure',{mode:byId('mode').value,url:byId('entry-url').value.trim()});
byId('apply').onclick=()=>action('/add?target='+encodeURIComponent(byId('target').value));
byId('resume').onclick=()=>action('/resume');byId('stop').onclick=()=>{
  if(lastState?.mode==='live'&&lastState.count&&!confirm('Esto cierra las sesiones y elimina sus temporales. Podés perder posiciones de fila. ¿Finalizar?'))return;
  action('/stop');
};
refresh();setInterval(refresh,2000);

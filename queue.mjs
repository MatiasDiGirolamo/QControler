const idPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function prepareEntry(value){
  const url=new URL(String(value).trim());
  if(/^\/(?:softblock|hardblock)(?:\/|$)/i.test(url.pathname))throw new Error('Pegá el enlace original de la prefila, no la página de verificación.');
  const removed=[];
  for(const key of [...url.searchParams.keys()]){
    if(['q','queueittoken'].includes(key.toLowerCase())){removed.push(key);url.searchParams.delete(key);}
  }
  url.hash='';
  const entryUrl=validateEntry(url.href);
  if(url.hostname.endsWith('.queue-it.net')&&(!url.searchParams.get('c')||!url.searchParams.get('e')))throw new Error('El enlace de Queue-it debe incluir c y e. Copiá la URL completa de la prefila.');
  return {entryUrl,removed,customer:url.searchParams.get('c'),event:url.searchParams.get('e'),language:url.searchParams.get('cid'),destination:url.searchParams.get('t')};
}
export function validateEntry(value){
  const url=new URL(value);
  const allowed=url.hostname==='www.allaccess.com.ar'||url.hostname==='allaccess.com.ar'||url.hostname==='bocasocios.bocajuniors.com.ar'||url.hostname.endsWith('.queue-it.net');
  if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed)throw new Error('Usá un enlace HTTPS oficial de All Access, Boca Socios o Queue-it.');
  if(url.searchParams.has('q')||url.searchParams.has('queueittoken'))throw new Error('Ese enlace contiene una posición o un pase personal. Usá la entrada oficial sin q ni queueittoken.');
  return url.href;
}
export function observeQueue({url,text,title='',previousId=null}){
  const location=new URL(url), isQueue=location.hostname.endsWith('.queue-it.net');
  const normalized=text.replace(/\u00a0/g,' ').replace(/\r\n?/g,'\n');
  const q=location.searchParams.get('q');
  const visibleId=normalized.match(/(?:Queue ID|ID de (?:la )?fila|identificador de (?:la )?fila|Numero in coda|ID della coda)\s*:?\s*([0-9a-f-]{36})/i)?.[1];
  const candidate=q||visibleId;
  const queueId=isQueue&&candidate&&idPattern.test(candidate)&&!/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(candidate)?candidate.toLowerCase():null;
  let state='Sitio abierto';
  if(/ERR_TOO_MANY_REDIRECTS|ERR_CONNECTION|ERR_NAME_NOT_RESOLVED|chrome-error:|no se puede acceder a este sitio|this site can.t be reached/i.test(normalized+' '+url))state='Error de carga';
  else if((isQueue&&/^\/(?:softblock|hardblock)(?:\/|$)/i.test(location.pathname))||/access denied|acceso denegado|verify (?:that )?you are human|verifica.{0,20}(?:humano|persona)|captcha|verifica.{0,20}umano/i.test(normalized))state='Requiere atención';
  else if(isQueue){
    if(/waiting room has ended|fila.{0,20}(?:finalizada|terminada)|coda.{0,15}terminata/i.test(normalized))state='Fila finalizada';
    else if(/(?:it is|it's) your turn|es tu turno|lleg[oó] tu turno|being redirected|redirigiendo|[èe] il tuo turno|[èe] arrivato il tuo turno|reindirizzamento/i.test(normalized))state='Turno disponible';
    else if(/(?:line|queue) is paused|fila.{0,15}pausada|coda.{0,15}(?:pausa|sospesa)/i.test(normalized))state='Fila pausada';
    else if(/event will begin|evento comenzar[aá]|venta comenzar[aá]|comienza en|countdown|sala de espera|waiting room will open|evento inizier[aà]|vendita inizier[aà]/i.test(normalized))state='Prefila';
    else state='En fila';
  }else if(previousId)state='Salió de Queue-it · verificar destino';
  const waitMatch=normalized.match(/(?:Entrar[aá]s dentro de|your estimated wait time(?: is)?|estimated wait time|tiempo (?:de espera )?estimado(?: de espera)?|tu tiempo de espera|tiempo aproximado de espera|Potrai accedere al servizio in|tempo (?:di attesa stimato|stimato di attesa))\s*:?\s*([^\n]{1,90})/i);
  const wait=waitMatch?.[1]?.split(/ACTUALIZADO\s*:/i)[0]?.trim()||null;
  const siteUpdatedAt=normalized.match(/\bACTUALIZADO\s*:\s*((?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d)\b/i)?.[1]||null;
  let waitMinutes=null;
  if(wait){
    const m=wait.match(/(\d+)\s*(?:min|minute|minuto|minuti)/i),h=wait.match(/(\d+)\s*(?:hour|hora|ore|ora)/i);
    if(m||h)waitMinutes=(h?Number(h[1])*60:0)+(m?Number(m[1]):0);
    if(/less than (?:a|one|1) minute|menos de (?:un|1) minuto|meno di (?:un|1) minuto/i.test(wait))waitMinutes=1;
    if(/more than|más de|mas de|pi[uù] di/i.test(wait))waitMinutes=null;
  }
  const queueLink=queueId&&!['Requiere atención','Error de carga','Fila finalizada'].includes(state)?new URL(url):null;
  if(queueLink)queueLink.searchParams.set('q',queueId);
  return {currentUrl:url,queueLink:queueLink?.href||null,title,queueId,customer:isQueue?location.searchParams.get('c'):null,event:isQueue?location.searchParams.get('e'):null,queueState:state,wait,waitMinutes,siteUpdatedAt,checkedAt:new Date().toISOString()};
}
export function classifySessions(items){
  const key=s=>s.queueId?[s.customer,s.event,s.queueId].join('|'):null;
  const counts=new Map();for(const s of items){const k=key(s);if(k)counts.set(k,(counts.get(k)||0)+1);}
  const result=items.map(s=>({...s,duplicate:!!key(s)&&counts.get(key(s))>1}));
  return result.sort((a,b)=>{
    const score=s=>['Requiere atención','Error de carga','Fila finalizada'].includes(s.queueState)?4:s.queueState==='Turno disponible'&&!s.duplicate?0:s.queueState==='En fila'&&s.queueId&&!s.duplicate&&s.waitMinutes!==null&&s.waitMinutes!==undefined?1:s.queueState==='En fila'&&s.queueId&&!s.duplicate?2:3;
    return score(a)-score(b)||(a.waitMinutes??Infinity)-(b.waitMinutes??Infinity)||a.id-b.id;
  });
}

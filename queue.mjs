const idPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function validateEntry(value){
  const url=new URL(value);
  const allowed=url.hostname==='www.allaccess.com.ar'||url.hostname==='allaccess.com.ar'||url.hostname==='bocasocios.bocajuniors.com.ar'||url.hostname.endsWith('.queue-it.net');
  if(url.protocol!=='https:'||url.username||url.password||url.port||!allowed)throw new Error('Usá un enlace HTTPS oficial de All Access, Boca Socios o Queue-it.');
  if(url.searchParams.has('q')||url.searchParams.has('queueittoken'))throw new Error('Ese enlace contiene una posición o un pase personal. Usá la entrada oficial sin q ni queueittoken.');
  return url.href;
}
export function observeQueue({url,text,title='',previousId=null}){
  const location=new URL(url), isQueue=location.hostname.endsWith('.queue-it.net');
  const normalized=text.replace(/\u00a0/g,' ');
  const q=location.searchParams.get('q');
  const visibleId=normalized.match(/(?:Queue ID|ID de (?:la )?fila|identificador de (?:la )?fila)\s*:?\s*([0-9a-f-]{36})/i)?.[1];
  const candidate=q||visibleId;
  const queueId=isQueue&&candidate&&idPattern.test(candidate)&&!/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(candidate)?candidate.toLowerCase():null;
  let state='Sitio abierto';
  if(/access denied|acceso denegado|verify (?:that )?you are human|verifica.{0,20}(?:humano|persona)|captcha/i.test(normalized))state='Requiere atención';
  else if(isQueue){
    if(/(?:it is|it's) your turn|es tu turno|lleg[oó] tu turno|being redirected|redirigiendo/i.test(normalized))state='Turno disponible';
    else if(/(?:line|queue) is paused|fila.{0,15}pausada/i.test(normalized))state='Fila pausada';
    else if(/event will begin|evento comenzar[aá]|venta comenzar[aá]|comienza en|countdown|sala de espera|waiting room will open/i.test(normalized))state='Prefila';
    else state='En fila';
  }else if(previousId)state='Salió de Queue-it · verificar destino';
  const waitMatch=normalized.match(/(?:your estimated wait time(?: is)?|estimated wait time|tiempo (?:de espera )?estimado(?: de espera)?|tu tiempo de espera|tiempo aproximado de espera)\s*:?\s*([^\n]{1,90})/i);
  const wait=waitMatch?.[1]?.trim()||null;
  let waitMinutes=null;
  if(wait){
    const m=wait.match(/(\d+)\s*(?:min|minute|minuto)/i),h=wait.match(/(\d+)\s*(?:hour|hora)/i);
    if(m||h)waitMinutes=(h?Number(h[1])*60:0)+(m?Number(m[1]):0);
    if(/less than (?:a|one|1) minute|menos de (?:un|1) minuto/i.test(wait))waitMinutes=1;
    if(/more than|más de|mas de/i.test(wait))waitMinutes=null;
  }
  return {currentUrl:url,title,queueId,customer:isQueue?location.searchParams.get('c'):null,event:isQueue?location.searchParams.get('e'):null,queueState:state,wait,waitMinutes,checkedAt:new Date().toISOString()};
}
export function classifySessions(items){
  const key=s=>s.queueId?[s.customer,s.event,s.queueId].join('|'):null;
  const counts=new Map();for(const s of items){const k=key(s);if(k)counts.set(k,(counts.get(k)||0)+1);}
  const result=items.map(s=>({...s,duplicate:!!key(s)&&counts.get(key(s))>1}));
  return result.sort((a,b)=>{
    const score=s=>s.queueState==='Turno disponible'&&!s.duplicate?0:s.queueId&&!s.duplicate&&s.waitMinutes!==null&&s.waitMinutes!==undefined?1:s.queueId&&!s.duplicate?2:3;
    return score(a)-score(b)||(a.waitMinutes??Infinity)-(b.waitMinutes??Infinity)||a.id-b.id;
  });
}

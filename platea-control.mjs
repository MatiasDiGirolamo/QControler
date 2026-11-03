import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';

// A single writer, including disk persistence, serializes competing contexts.
export class PlateaControl {
  constructor(file,{now=Date.now}={}) { this.file=file; this.now=now;this.ledger={}; this.owners=new Map(); this.active=new Map(); this.tail=Promise.resolve();this.cooldownUntil=0;this.availability=new Map();this.pollQueue=new Map();this.nextPollAt=0;this.activePoll=null;this.preparing=new Map();this.pollCount=0;this.lastPollSuccess=0; }
  async load() {
    try {
      this.ledger=JSON.parse(await fs.readFile(this.file,'utf8'));
      if(!this.ledger||Array.isArray(this.ledger)||typeof this.ledger!=='object')throw new Error('Registro inválido');
    } catch(e) { if(e.code!=='ENOENT')throw e; }
  }
  serial(fn) { const next=this.tail.then(fn); this.tail=next.catch(()=>{}); return next; }
  async save() {
    const tmp=this.file+'.tmp';
    const handle=await fs.open(tmp,'w');
    try { await handle.writeFile(JSON.stringify(this.ledger,null,2)+'\n'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmp,this.file);
  }
  async command(s,action,data={}) { return this.serial(async()=>{
    const slot=s.account;
    if(action==='poll-plan') {
      if(!this.owners.get(slot)?.has(s.id))return {ok:false,message:'La búsqueda está detenida.'};
      if(this.cooldownUntil>this.now())return {ok:false,retry:true,retryAfterMs:this.cooldownUntil-this.now(),message:'Esperando el límite de Boca.'};
      if(!Number.isSafeInteger(Number(data.matchId))||Number(data.matchId)<=0)throw new Error('Partido no válido');
      const key=slot+'|'+data.matchId,entry=this.availability.get(key),now=this.now();
      if(entry?.result&&entry.until>now){s.platea='Buscando';return {ok:true,cached:true,result:entry.result};}
      if(this.activePoll?.until<=now)this.activePoll=null;
      if(entry?.lease&&entry.until>now){s.platea='Esperando turno de consulta';return {ok:false,retry:true,retryAfterMs:250,message:'Otra ventana está actualizando disponibilidad de este socio.'};}
      for(const [queued,lastSeen] of this.pollQueue)if(now-lastSeen>10000||!this.owners.get(queued.split('|')[0])?.size)this.pollQueue.delete(queued);
      this.pollQueue.set(key,now); // Updating a Map value preserves FIFO order.
      const otherTurn=this.pollQueue.keys().next().value!==key&&now<this.nextPollAt+500;
      if(this.activePoll||now<this.nextPollAt||otherTurn){s.platea='Esperando turno de consulta';return {ok:false,retry:true,retryAfterMs:Math.max(250,this.nextPollAt-now),message:'Búsqueda alternada: esperando el próximo turno de consulta.'};}
      this.pollQueue.delete(key);
      const lease=randomUUID();this.pollCount++;this.nextPollAt=now+2000;this.activePoll={lease,until:now+6000};s.platea='Buscando';
      this.availability.set(key,{lease,session:s.id,until:now+6000});return {ok:true,lease};
    }
    if(action==='poll-result') {
      const key=slot+'|'+data.matchId,entry=this.availability.get(key);
      if(!entry||entry.lease!==data.lease||entry.session!==s.id)return {ok:false};
      if(this.activePoll?.lease===data.lease)this.activePoll=null;
      this.availability.delete(key);
      if(entry.until>this.now()&&this.owners.get(slot)?.has(s.id)&&Array.isArray(data.result?.sections)) {
        this.lastPollSuccess=this.now();
        const sections=data.result.sections.slice(0,300).map(v=>({nid:Number.isSafeInteger(v.nid)&&v.nid>0?v.nid:null,codigo:String(v.codigo).slice(0,50),activa:v.activa===true,libre:v.libre===true}));
        this.availability.set(key,{result:{sections},until:this.now()+1000});
      }
      return {ok:true};
    }
    if(action==='prepare') {
      if(!this.owners.get(slot)?.has(s.id))return {ok:false,message:'La búsqueda está detenida.'};
      if(this.cooldownUntil>this.now())return {ok:false,retry:true,retryAfterMs:this.cooldownUntil-this.now(),message:'Esperando el límite de Boca.'};
      const entry=Object.values(this.ledger).find(v=>v.slot===slot);
      if(entry)return {ok:false,retry:entry.outcome==='pending'&&this.active.has(entry.lease),message:'Este socio tiene un intento o una reserva pendiente.'};
      const current=this.preparing.get(slot);
      if(current?.until>this.now())return {ok:false,retry:true,message:'Otra sesión está preparando la reserva. La búsqueda continúa.'};
      const lease=randomUUID();this.preparing.set(slot,{lease,session:s.id,until:this.now()+60000});return {ok:true,lease};
    }
    if(action==='prepared-done') {
      const entry=this.preparing.get(slot);
      if(entry?.session!==s.id||entry?.lease!==data.lease)return {ok:false};
      this.preparing.delete(slot);return {ok:true};
    }
    if(action==='cooldown') {
      const now=this.now(),requested=Math.min(86400000,Math.max(0,Number(data.retryAfterMs)||0));
      if(this.cooldownUntil<=now)this.cooldownUntil=now+Math.max(requested,20000);
      else this.cooldownUntil=Math.max(this.cooldownUntil,now+requested);
      s.platea='Esperando límite de Boca · reintento automático';
      return {ok:true,retryAfterMs:this.cooldownUntil-now};
    }
    if(action==='stop') { const searches=this.owners.get(slot);searches?.delete(s.id);if(searches?.size===0)this.owners.delete(slot);if(this.preparing.get(slot)?.session===s.id)this.preparing.delete(slot);s.platea='Detenido'; return {ok:true}; }
    if(action==='start'||action==='check') {
      if(!['1','2'].includes(slot))return {ok:false,message:'Asigná Socio 1 o Socio 2 desde el panel.'};
      if(Object.values(this.ledger).some(v=>v.slot===slot&&!(v.outcome==='pending'&&this.active.has(v.lease))))return {ok:false,message:'Cuenta bloqueada: revisá el carrito y el registro de reservas.'};
      const searches=this.owners.get(slot)||new Set();
      if(action==='check'&&!searches.has(s.id))return {ok:false,message:'Iniciá la búsqueda para esta cuenta.'};
      searches.add(s.id);this.owners.set(slot,searches);
      if(this.cooldownUntil>this.now()){s.platea='Esperando límite de Boca · reintento automático';return {ok:action==='start',retry:true,retryAfterMs:this.cooldownUntil-this.now(),message:'Boca limitó las consultas. Se reanudan automáticamente después de la espera.'};}
      s.platea='Buscando';return {ok:true};
    }
    if(action==='begin') {
      if(!this.owners.get(slot)?.has(s.id))return {ok:false,message:'La búsqueda ya no está habilitada.'};
      if(this.cooldownUntil>this.now())return {ok:false,retry:true,retryAfterMs:this.cooldownUntil-this.now(),message:'Esperando el límite de consultas de Boca.'};
      if(!/^\d+$/.test(String(data.memberId))||Number(data.memberId)<=0)return {ok:false,message:'No pude identificar al socio.'};
      const key=String(data.memberId); // Actual member identity also protects mislabeled slots.
      const existing=this.ledger[key]||Object.values(this.ledger).find(v=>v.slot===slot);
      if(existing)return existing.outcome==='pending'&&this.active.has(existing.lease)
        ?{ok:false,retry:true,message:'Otra sesión está intentando reservar para este socio. La búsqueda continúa.'}
        :{ok:false,message:'Este socio tiene una reserva pendiente de revisión.'};
      const lease=randomUUID();
      this.ledger[key]={lease,slot,session:s.id,outcome:'pending',at:new Date().toISOString()};
      await this.save(); // Never authorize a POST if persistence failed.
      this.active.set(lease,key); s.platea='Reserva en curso'; return {ok:true,lease};
    }
    if(action==='finish') {
      const key=this.active.get(data.lease), entry=this.ledger[key];
      if(!entry||entry.session!==s.id)return {ok:false};
      if(data.outcome==='taken'||data.outcome==='stopped')delete this.ledger[key];
      else entry.outcome=data.outcome==='reserved'?'reserved':'uncertain';
      await this.save(); this.active.delete(data.lease);
      if(data.outcome==='taken')for(const [cacheKey,cached] of this.availability)if(cacheKey.startsWith(slot+'|')&&cached.result)this.availability.delete(cacheKey);
      s.platea=data.outcome==='reserved'?'Reserva confirmada · pago manual':data.outcome==='taken'?'Asiento agotado · buscando':data.outcome==='stopped'?'Detenido':'Reserva incierta · revisar carrito';
      return {ok:true};
    }
    throw new Error('Acción de platea no válida');
  }); }
  async review(slot) { return this.serial(async()=>{
    if(!['1','2'].includes(slot))throw new Error('Socio no válido');
    const entries=Object.entries(this.ledger).filter(([,v])=>v.slot===slot);
    if(entries.some(([,v])=>this.active.has(v.lease)))throw new Error('Hay una reserva en curso. Esperá su resultado.');
    for(const [key] of entries)delete this.ledger[key];
    await this.save(); this.owners.delete(slot);
  }); }
  summary() { return Object.values(this.ledger).map(({slot,session,outcome,at})=>({slot,session,outcome,at})); }
  pollStatus(){return {inFlight:this.activePoll?.until>this.now()?1:0,queuedAccounts:this.pollQueue.size,spacingMs:2000,count:this.pollCount,lastSuccessAt:this.lastPollSuccess};}
  async browserClosed() { return this.serial(async()=>{
    for(const key of this.active.values())if(this.ledger[key])this.ledger[key].outcome='uncertain';
    if(this.active.size)await this.save();
    this.active.clear();this.owners.clear();this.availability.clear();this.pollQueue.clear();this.activePoll=null;this.nextPollAt=0;this.preparing.clear();this.pollCount=0;this.lastPollSuccess=0;
  }); }
}

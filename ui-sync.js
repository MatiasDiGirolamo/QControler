'use strict';
// Formatea también las observaciones de un programa anterior sin cerrar sus sesiones.
function queueLinkFor(session,entryUrl=''){
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(session.queueId||'')||/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(session.queueId))return null;
  try{
    const current=new URL(session.currentUrl||session.queueLink);
    if(!current.hostname.endsWith('.queue-it.net')||/^\/(?:error|softblock|hardblock)(?:\/|$)/i.test(current.pathname))return null;
    let link=current;
    if(current.hostname==='bocajuniors.queue-it.net'){
      let source=current;try{const entry=new URL(entryUrl);if(entry.hostname===current.hostname&&(!current.searchParams.get('e')||entry.searchParams.get('e')===current.searchParams.get('e')))source=entry;}catch{}
      link=new URL('/',current.origin);
      for(const key of ['c','e','t','cid']){const value=current.searchParams.get(key)||source.searchParams.get(key)||(key==='cid'?'es-ES':'');if(value)link.searchParams.set(key,value);}
    }
    link.searchParams.delete('q');link.searchParams.delete('queueittoken');link.hash='';link.searchParams.set('q',session.queueId.toLowerCase());
    return link.href;
  }catch{return null;}
}
class SnapshotGate {
  epoch=0;
  issued=0;
  applied=0;
  invalidate(){this.epoch++;}
  begin(){return {epoch:this.epoch,sequence:++this.issued};}
  accept(ticket){
    if(ticket.epoch!==this.epoch||ticket.sequence<this.applied)return false;
    this.applied=ticket.sequence;
    return true;
  }
}

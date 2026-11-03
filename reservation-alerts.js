(function(root){
  'use strict';
  class ReservationAlerts {
    constructor(storage){
      this.storage=storage;this.seen=new Set();this.ack=new Set();
      try{const data=JSON.parse(storage?.getItem('qc:reservation-alerts')||'{}');this.seen=new Set(data.seen||[]);this.ack=new Set(data.ack||[]);}catch{}
    }
    key(r){return [r.slot,r.session,r.at,r.outcome].join('|');}
    relevant(records){return records.filter(r=>['reserved','uncertain'].includes(r.outcome));}
    save(){try{this.storage?.setItem('qc:reservation-alerts',JSON.stringify({seen:[...this.seen],ack:[...this.ack]}));}catch{}}
    update(records){const fresh=this.relevant(records).filter(r=>!this.seen.has(this.key(r)));for(const r of fresh)this.seen.add(this.key(r));this.save();return fresh;}
    pending(records){return this.relevant(records).filter(r=>!this.ack.has(this.key(r)));}
    acknowledge(records){for(const r of this.relevant(records))this.ack.add(this.key(r));this.save();}
  }
  root.ReservationAlerts=ReservationAlerts;
  if(typeof module!=='undefined')module.exports={ReservationAlerts};
})(typeof globalThis!=='undefined'?globalThis:this);

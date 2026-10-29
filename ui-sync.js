'use strict';
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

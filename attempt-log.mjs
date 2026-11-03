const outcomes=new Set(['found','empty','blocked','retry','reserved','uncertain','taken','deferred','stopped','unavailable','busy']);
const timingKeys=['memberMs','cartBeforeMs','seatsMs','preflightMs','coordinationMs','detectToPostMs','reserveMs','assignmentMs','confirmationMs','totalMs'];
export class AttemptLog {
  constructor(){this.events=[];this.sequence=0;}
  record(session,input={}){
    if(!['availability','attempt'].includes(input.kind)||!outcomes.has(input.outcome))return;
    const event={id:++this.sequence,at:new Date().toISOString(),session:session.id,account:session.account,kind:input.kind,outcome:input.outcome};
    for(const key of ['durationMs','count','httpStatus'])if(Number.isFinite(input[key])&&input[key]>=0)event[key]=Math.round(input[key]);
    if(typeof input.section==='string')event.section=input.section.replace(/[^a-z0-9 _-]/gi,'').slice(0,40);
    if(input.timings&&typeof input.timings==='object'){
      event.timings={};for(const key of timingKeys)if(Number.isFinite(input.timings[key])&&input.timings[key]>=0)event.timings[key]=Math.round(input.timings[key]);
    }
    this.events.push(event);if(this.events.length>1000)this.events.shift();return event;
  }
  recent(){return this.events.slice(-100);}
  export(){return this.events.map(e=>JSON.stringify(e)).join('\n')+'\n';}
}

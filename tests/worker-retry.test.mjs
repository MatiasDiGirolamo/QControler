import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const source=await fs.readFile(new URL('../platea-worker.js',import.meta.url),'utf8');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function worker(outcomes){
  const listeners=new Set(),timers=[],events=[];let attempts=0,stops=0;
  const window={};window.top=window;
  window.__qcPlatea=async(action,data)=>{if(action==='telemetry')events.push(data);if(action==='stop')stops++;return {ok:true};};
  window.addEventListener=(_,fn)=>listeners.add(fn);window.removeEventListener=(_,fn)=>listeners.delete(fn);
  window.postMessage=data=>{
    let reply;
    if(data.type==='la-previa:poll')reply={type:'la-previa:availability',id:data.id,fastReady:true,sections:[{nid:798,codigo:'H',activa:true,libre:true}]};
    if(data.type==='la-previa:fast-reserve'){reply={type:'la-previa:fast-result',id:data.id,outcome:outcomes[attempts++]};}
    if(data.type==='la-previa:navigate')reply={type:'la-previa:navigation',id:data.id,ok:true};
    if(reply)queueMicrotask(()=>{for(const fn of [...listeners])fn({source:window,origin:'https://bocasocios.bocajuniors.com.ar',data:reply});});
  };
  vm.runInNewContext(source,{window,location:{origin:'https://bocasocios.bocajuniors.com.ar',pathname:'/matches/878/plateas'},document:{body:{innerText:''}},setTimeout:(fn,ms)=>{const timer={fn,ms,cancelled:false};timers.push(timer);return timer;},clearTimeout:timer=>{if(timer)timer.cancelled=true;}});
  return {window,timers,events,attempts:()=>attempts,stops:()=>stops};
}
test('rechazo verificado con carrito vacío vuelve a buscar sin tres segundos extra',async()=>{
  const w=worker(['taken','reserved']);await w.window.__qcAutoStart('878');await flush();await flush();
  const next=w.timers.filter(t=>!t.cancelled);assert.equal(next.length,1);assert.equal(next[0].ms,0);
  next[0].fn();await flush();await flush();
  assert.equal(w.attempts(),2);assert.equal(w.window.__qcWorkerState().running,false);assert.ok(w.events.some(e=>e.outcome==='reserved'));
});
test('un resultado incierto nunca activa el reintento inmediato',async()=>{
  const w=worker(['uncertain']);await w.window.__qcAutoStart('878');await flush();await flush();
  assert.equal(w.attempts(),1);assert.equal(w.window.__qcWorkerState().running,false);assert.equal(w.timers.filter(t=>!t.cancelled).length,0);assert.equal(w.stops(),1);
});

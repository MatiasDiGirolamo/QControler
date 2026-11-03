import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {PlateaControl} from '../platea-control.mjs';

async function setup(t){
  const parent=path.dirname(fileURLToPath(import.meta.url));
  const dir=await fs.mkdtemp(path.join(parent,'.qc-platea-test-'));
  if(path.dirname(path.resolve(dir))!==parent)throw new Error('Test directory outside workspace');
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const control=new PlateaControl(path.join(dir,'ledger.json'));await control.load();return control;
}
test('todas las sesiones de ambos socios buscan a la vez; detener una no frena las otras',async t=>{
  const c=await setup(t),a={id:1,account:'1'},b={id:2,account:'1'},d={id:3,account:'2'};
  assert.equal((await c.command({id:4},'start')).ok,false);
  const results=await Promise.all([c.command(a,'start'),c.command(b,'start')]);
  assert.deepEqual(results.map(r=>r.ok),[true,true]);
  assert.equal((await c.command(d,'start')).ok,true);
  await c.command(a,'stop');assert.equal((await c.command(b,'check')).ok,true);assert.equal((await c.command(a,'check')).ok,false);
});
test('misma identidad en dos grupos: solo un POST autorizado y bloqueo persiste al reiniciar',async t=>{
  const c=await setup(t),a={id:1,account:'1'},b={id:2,account:'2'};
  await c.command(a,'start');await c.command(b,'start');
  const results=await Promise.all([c.command(a,'begin',{memberId:42}),c.command(b,'begin',{memberId:42})]);
  assert.deepEqual(results.map(r=>r.ok),[true,false]);
  await c.command(a,'stop');assert.equal((await c.command(a,'start')).ok,true);
  await assert.rejects(c.review('1'),/curso/);
  const next=new PlateaControl(c.file);await next.load();
  assert.equal((await next.command(a,'start')).ok,false);
  await next.command(b,'start');assert.equal((await next.command(b,'begin',{memberId:42})).ok,false);
  await next.review('1');assert.equal((await next.command(a,'start')).ok,true);
});
for(const outcome of ['reserved','uncertain','taken','stopped'])test('resultado '+outcome+' controla la posibilidad de otro intento',async t=>{
  const c=await setup(t),a={id:1,account:'1'};await c.command(a,'start');
  const {lease}=await c.command(a,'begin',{memberId:42});
  await c.command(a,'finish',{lease,outcome});
  assert.equal(c.summary().length,['taken','stopped'].includes(outcome)?0:1);
  assert.equal((await c.command(a,'check')).ok,['taken','stopped'].includes(outcome));
});
test('fallo de escritura nunca concede permiso para reservar',async t=>{
  const c=await setup(t),a={id:1,account:'1'};await c.command(a,'start');
  c.save=async()=>{throw Error('disk full');};
  await assert.rejects(c.command(a,'begin',{memberId:42}),/disk full/);
  assert.equal((await c.command(a,'check')).ok,false);
});
test('un registro corrupto falla cerrado en vez de olvidar reservas',async t=>{
  const c=await setup(t);await fs.writeFile(c.file,'invalid');
  await assert.rejects(new PlateaControl(c.file).load());
});
test('cerrar Chrome conserva incertidumbre y permite revisión manual posterior',async t=>{
  const c=await setup(t),a={id:1,account:'1'};await c.command(a,'start');
  await c.command(a,'begin',{memberId:42});await c.browserClosed();
  assert.equal(c.summary()[0].outcome,'uncertain');
  assert.equal((await c.command(a,'start')).ok,false);
  await c.review('1');assert.equal((await c.command(a,'start')).ok,true);
});

test('20 sesiones buscan simultáneamente; solo una reserva por socio, las demás continúan y retoman tras taken',async t=>{
  const c=await setup(t),sessions=Array.from({length:20},(_,i)=>({id:i+1,account:'1'}));
  assert.ok((await Promise.all(sessions.map(s=>c.command(s,'start')))).every(r=>r.ok));
  const attempts=await Promise.all(sessions.map(s=>c.command(s,'begin',{memberId:42})));
  assert.equal(attempts.filter(r=>r.ok).length,1);assert.equal(attempts.filter(r=>r.retry).length,19);
  assert.ok((await Promise.all(sessions.map(s=>c.command(s,'check')))).every(r=>r.ok));
  await c.command(sessions[0],'finish',{lease:attempts[0].lease,outcome:'taken'});
  const retry=await c.command(sessions[1],'begin',{memberId:42});assert.equal(retry.ok,true);
  await c.command(sessions[1],'finish',{lease:retry.lease,outcome:'reserved'});
  assert.ok((await Promise.all(sessions.map(s=>c.command(s,'check')))).every(r=>!r.ok));
});

test('un 429 pausa todas las consultas y reservas hasta vencer la espera, sin apagar las búsquedas',async t=>{
  const c=await setup(t),a={id:1,account:'1'},b={id:2,account:'2'};await c.command(a,'start');await c.command(b,'start');
  const limit=await c.command(a,'cooldown',{retryAfterMs:90000});assert.ok(limit.retryAfterMs>=90000);
  for(const s of [a,b]){const result=await c.command(s,'check');assert.equal(result.retry,true);assert.equal(result.ok,false);assert.ok(result.retryAfterMs>0);assert.equal((await c.command(s,'begin',{memberId:s.id})).retry,true);}
  c.cooldownUntil=Date.now()-1;assert.equal((await c.command(a,'check')).ok,true);assert.equal((await c.command(b,'check')).ok,true);
  const lease=await c.command(b,'begin',{memberId:2});assert.equal(lease.ok,true);
});
test('429 concurrentes comparten plazo; los incidentes posteriores mantienen veinte segundos',async t=>{
  const c=await setup(t),a={id:1,account:'1'};await c.command(a,'start');
  const first=await c.command(a,'cooldown');assert.ok(first.retryAfterMs===20000);
  const same=await c.command(a,'cooldown');assert.ok(same.retryAfterMs<=20000);
  c.cooldownUntil=0;const next=await c.command(a,'cooldown');assert.ok(next.retryAfterMs===20000);
});

test('todas las sesiones comparten el mismo vencimiento sin añadir veinte segundos al incorporarse',async t=>{
  const c=await setup(t),a={id:1,account:'1'},b={id:2,account:'2'};
  await c.command(a,'start');await c.command(b,'start');await c.command(a,'cooldown');
  const deadline=c.cooldownUntil;await new Promise(r=>setTimeout(r,5));
  await c.command(b,'cooldown');assert.equal(c.cooldownUntil,deadline);
  const remaining=await c.command(b,'check');assert.ok(remaining.retryAfterMs<20000);assert.equal(c.cooldownUntil,deadline);
});

test('35 ventanas comparten consultas y alternan las cuentas con dos segundos entre solicitudes',async t=>{
  const c=await setup(t),sessions=Array.from({length:35},(_,i)=>({id:i+1,account:String(i%2+1)}));
  let clock=100000;c.now=()=>clock;
  await Promise.all(sessions.map(s=>c.command(s,'start')));
  const grants=[],sections=[{nid:798,codigo:'G',activa:true,libre:true}];
  for(let round=0;round<10;round++){
    const plans=await Promise.all(sessions.map(s=>c.command(s,'poll-plan',{matchId:878})));
    assert.equal(plans.filter(p=>p.lease).length,1);
    const i=plans.findIndex(p=>p.lease);grants.push({slot:sessions[i].account,at:clock});
    assert.equal(c.pollStatus().inFlight,1);
    await c.command(sessions[i],'poll-result',{matchId:878,lease:plans[i].lease,result:{sections}});
    const cached=await c.command(sessions[i],'poll-plan',{matchId:878});assert.equal(cached.cached,true);assert.deepEqual(cached.result.sections,sections);
    assert.equal((await c.command(sessions[i],'poll-plan',{matchId:999})).cached,undefined);
    c.pollQueue.delete(sessions[i].account+'|999');
    clock+=2000;
  }
  assert.deepEqual(grants.map(v=>v.slot),['1','2','1','2','1','2','1','2','1','2']);
  assert.ok(grants.slice(1).every((v,i)=>v.at-grants[i].at===2000));
});
test('consultas fallidas o antiguas nunca se almacenan como ausencia de plateas',async t=>{
  const c=await setup(t),a={id:1,account:'1'};let clock=100000;c.now=()=>clock;await c.command(a,'start');
  const first=await c.command(a,'poll-plan',{matchId:878});
  await c.command(a,'poll-result',{matchId:878,lease:first.lease});
  clock+=2000;const second=await c.command(a,'poll-plan',{matchId:878});assert.ok(second.lease);
  assert.equal((await c.command(a,'poll-result',{matchId:878,lease:first.lease,result:{sections:[]}})).ok,false);
  assert.equal((await c.command(a,'poll-plan',{matchId:878})).cached,undefined);
});

test('una consulta lenta bloquea la siguiente; un turno abandonado no bloquea la cola para siempre',async t=>{
  const c=await setup(t),a={id:1,account:'1'},b={id:2,account:'2'};let clock=100000;c.now=()=>clock;
  await c.command(a,'start');await c.command(b,'start');
  const first=await c.command(a,'poll-plan',{matchId:878});clock+=3000;
  assert.equal((await c.command(b,'poll-plan',{matchId:878})).retry,true);
  clock+=3001;assert.ok((await c.command(b,'poll-plan',{matchId:878})).lease);
  await c.command(a,'poll-result',{matchId:878,lease:first.lease,result:{sections:[]}});
  assert.equal(c.pollStatus().inFlight,1,'Late response cannot release another query');
});
test('tras HTTP 429 se libera un único turno y el siguiente espera dos segundos',async t=>{
  const c=await setup(t),a={id:1,account:'1'},b={id:2,account:'2'};let clock=100000;c.now=()=>clock;
  await c.command(a,'start');await c.command(b,'start');await c.command(a,'cooldown');
  assert.equal((await c.command(a,'poll-plan',{matchId:878})).retry,true);
  clock+=20000;
  const first=await c.command(a,'poll-plan',{matchId:878});assert.ok(first.lease);
  await c.command(a,'poll-result',{matchId:878,lease:first.lease,result:{sections:[]}});
  assert.equal((await c.command(b,'poll-plan',{matchId:878})).retryAfterMs,2000);
  clock+=2000;assert.ok((await c.command(b,'poll-plan',{matchId:878})).lease);
});
test('solo una ventana por socio prepara las consultas previas de reserva',async t=>{
  const c=await setup(t),sessions=Array.from({length:20},(_,i)=>({id:i+1,account:'1'}));await Promise.all(sessions.map(s=>c.command(s,'start')));
  const results=await Promise.all(sessions.map(s=>c.command(s,'prepare')));assert.equal(results.filter(r=>r.lease).length,1);assert.equal(results.filter(r=>r.retry).length,19);
  await c.command(sessions[0],'prepared-done',{lease:results[0].lease});assert.ok((await c.command(sessions[1],'prepare')).lease);
});

test('una cuenta que no toma su turno no paraliza a la otra',async t=>{
  const c=await setup(t),a={id:1,account:'1'},b={id:2,account:'2'};let clock=100000;c.now=()=>clock;
  await c.command(a,'start');await c.command(b,'start');
  const first=await c.command(a,'poll-plan',{matchId:878});await c.command(b,'poll-plan',{matchId:878});
  await c.command(a,'poll-result',{matchId:878,lease:first.lease,result:{sections:[]}});
  clock+=2500;const second=await c.command(a,'poll-plan',{matchId:878});assert.ok(second.lease);
  await c.command(a,'poll-result',{matchId:878,lease:second.lease,result:{sections:[]}});
  clock+=2000;assert.ok((await c.command(b,'poll-plan',{matchId:878})).lease);
});

test('tras asiento rechazado se descarta el snapshot anterior y se respeta el próximo turno HTTP',async t=>{
  const c=await setup(t),a={id:1,account:'1'};let clock=100000;c.now=()=>clock;await c.command(a,'start');
  const poll=await c.command(a,'poll-plan',{matchId:878});await c.command(a,'poll-result',{matchId:878,lease:poll.lease,result:{sections:[]}});
  const lease=await c.command(a,'begin',{memberId:42});await c.command(a,'finish',{lease:lease.lease,outcome:'taken'});
  const next=await c.command(a,'poll-plan',{matchId:878});assert.equal(next.cached,undefined);assert.equal(next.retryAfterMs,2000);
});

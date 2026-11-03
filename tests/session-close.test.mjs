import {test} from 'node:test';
import assert from 'node:assert/strict';
import {closeSession,sessionIds} from '../session-close.mjs';
function harness(){
  const allocate=sessionIds(),calls={paused:0,empty:0,closed:[]};
  const make=()=>{const s={id:allocate(),context:{close:async()=>{calls.closed.push(s.id);}}};return s;};
  const sessions=[make(),make()];
  const close=id=>closeSession({sessions,id,pause:()=>calls.paused++,waitForBatch:async()=>{},onEmpty:async()=>calls.empty++,report:()=>{}});
  return {sessions,calls,make,close};
}
test('cierra solo el contexto elegido y conserva números e identidad del resto',async()=>{
 const h=harness(),kept=h.sessions[1];
 assert.deepEqual(await h.close(1),{code:200,ok:true,count:1});
 assert.deepEqual(h.calls.closed,[1]);assert.equal(h.calls.paused,1);assert.equal(h.calls.empty,0);
 assert.equal(h.sessions[0],kept);assert.equal(kept.id,2);
 h.sessions.push(h.make());assert.deepEqual(h.sessions.map(s=>s.id),[2,3]);
});
test('cerrar la última llama al cierre del navegador y la limpieza',async()=>{
 const h=harness();await h.close(1);await h.close(2);
 assert.equal(h.sessions.length,0);assert.equal(h.calls.empty,1);
});
test('un doble clic no cierra dos veces el mismo contexto',async()=>{
 const h=harness();let finish;h.sessions[0].context.close=()=>new Promise(r=>{finish=r;});
 const first=h.close(1);assert.equal((await h.close(1)).code,409);
 finish();assert.equal((await first).code,200);assert.equal(h.sessions.length,1);
});
test('una sesión inexistente no cierra ni pausa las demás',async()=>{
 const h=harness();assert.equal((await h.close(999)).code,404);
 assert.equal(h.sessions.length,2);assert.equal(h.calls.paused,0);assert.deepEqual(h.calls.closed,[]);
});
test('un error de cierre conserva la sesión y permite volver a intentarlo',async()=>{
 const h=harness();h.sessions[0].context.close=async()=>{throw new Error('ocupado');};
 await assert.rejects(h.close(1),/ocupado/);assert.equal(h.sessions.length,2);assert.equal(h.sessions[0].removing,false);
});

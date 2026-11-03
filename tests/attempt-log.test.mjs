import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AttemptLog} from '../attempt-log.mjs';
test('registra etapas y tiempos sin incluir credenciales, tokens ni mensajes HTTP arbitrarios',()=>{
  const log=new AttemptLog();
  const event=log.record({id:1,account:'1'},{kind:'attempt',outcome:'reserved',section:'G',httpStatus:200,durationMs:125.4,timings:{preflightMs:80,reserveMs:20,password:'secret'},password:'secret',token:'secret',message:'secret'});
  assert.equal(event.durationMs,125);assert.equal(event.timings.preflightMs,80);assert.equal(log.export().includes('secret'),false);
  assert.equal(log.record({id:1},{kind:'arbitrary',outcome:'reserved'}),undefined);
});
test('registro acotado y respuestas inciertas diferenciadas de reservas confirmadas',()=>{
  const log=new AttemptLog();for(let i=0;i<1100;i++)log.record({id:1,account:'1'},{kind:'availability',outcome:'empty'});
  log.record({id:2,account:'2'},{kind:'attempt',outcome:'uncertain',httpStatus:503});
  assert.equal(log.events.length,1000);assert.equal(log.recent().length,100);assert.equal(log.recent().at(-1).outcome,'uncertain');
});

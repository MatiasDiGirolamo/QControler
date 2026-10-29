import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEntry,observeQueue,classifySessions} from '../queue.mjs';
const a='11111111-2222-3333-4444-555555555555',b='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const url=q=>'https://queueitcom.queue-it.net/?c=queueitcom&e=demo&q='+q;
test('solo entrada oficial, sin compartir q ni pases ni dominios parecidos',()=>{
 assert.equal(validateEntry('https://www.allaccess.com.ar/event/u2'),'https://www.allaccess.com.ar/event/u2');
 for(const bad of [url(a),'https://www.allaccess.com.ar/?queueittoken=secret','http://www.allaccess.com.ar/','https://allaccess.com.ar.evil.test/','https://user:secret@www.allaccess.com.ar/'])assert.throws(()=>validateEntry(bad));
});
test('un identificador vacío o una página fuera de Queue-it no cuentan',()=>{
 assert.equal(observeQueue({url:url('00000000-0000-0000-0000-000000000000'),text:'You are now in line'}).queueId,null);
 assert.equal(observeQueue({url:'https://www.allaccess.com.ar/event/u2',text:'Queue ID: '+a}).queueId,null);
});
test('lee identificador real de URL y espera explícita',()=>{
 const s=observeQueue({url:url(a),text:'You are now in line\nYour estimated wait time is: 5 minutes\nQueue ID: '+a});
 assert.equal(s.queueId,a);assert.equal(s.waitMinutes,5);assert.equal(s.queueState,'En fila');
});
test('espera no numérica no se transforma en ranking inventado',()=>{
 assert.equal(observeQueue({url:url(a),text:'Your estimated wait time is: more than an hour'}).waitMinutes,null);
 assert.equal(observeQueue({url:url(a),text:'Tu tiempo de espera: más de 1 hora'}).waitMinutes,null);
});
test('prefila, turno y destino son estados distintos',()=>{
 assert.equal(observeQueue({url:url(a),text:'The event will begin at: 13:00'}).queueState,'Prefila');
 assert.equal(observeQueue({url:url(a),text:'It is your turn'}).queueState,'Turno disponible');
 assert.equal(observeQueue({url:'https://www.allaccess.com.ar/event/u2',text:'U2',previousId:a}).queueState,'Salió de Queue-it · verificar destino');
});
test('detecta duplicados dentro del mismo evento y ordena esperas conocidas',()=>{
 const base={customer:'test',event:'demo',queueState:'En fila'};
 const result=classifySessions([{...base,id:1,queueId:a,waitMinutes:2},{...base,id:2,queueId:a,waitMinutes:2},{...base,id:3,queueId:b,waitMinutes:5}]);
 assert.equal(result[0].id,3);assert.equal(result.filter(s=>s.duplicate).length,2);
 assert.equal(classifySessions([{...base,id:1,queueId:a,waitMinutes:15},{...base,id:2,queueId:b,waitMinutes:5}])[0].id,2);
});
test('un enlace personal puede ser reconocido sin publicarlo en búsquedas',()=>{
 const s=observeQueue({url:url(a),text:'Queue ID: '+a});assert.equal(s.currentUrl,url(a));
});

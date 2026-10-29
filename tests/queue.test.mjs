import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateEntry,prepareEntry,observeQueue,classifySessions} from '../queue.mjs';
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
test('Bologna: lee el identificador visible y conserva evento e idioma en el enlace',()=>{
 const entry='https://bestunion.queue-it.net/?c=bestunion&e=bolognabiglietti&cid=it-IT';
 const s=observeQueue({url:entry,text:'Potrai accedere al servizio in:\nMeno di un minuto\nNumero in coda: '+a});
 assert.equal(s.queueId,a);assert.equal(s.waitMinutes,1);assert.equal(s.wait,'Meno di un minuto');
 const link=new URL(s.queueLink);assert.equal(link.searchParams.get('q'),a);
 assert.equal(link.searchParams.get('e'),'bolognabiglietti');assert.equal(link.searchParams.get('cid'),'it-IT');
});
test('un fallo de redirecciones es un error, no una posición de fila',()=>{
 const s=observeQueue({url:'chrome-error://chromewebdata/',text:'ERR_TOO_MANY_REDIRECTS',previousId:a});
 assert.equal(s.queueState,'Error de carga');assert.equal(s.queueId,null);assert.equal(s.queueLink,null);
});
test('softblock no se muestra como fila disponible aunque conserve un identificador',()=>{
 const s=observeQueue({url:'https://bestunion.queue-it.net/softblock/?c=bestunion&e=bolognabiglietti&q='+a,text:'Controllo'});
 assert.equal(s.queueState,'Requiere atención');assert.equal(s.queueId,a);assert.equal(s.queueLink,null);
 const valid={id:2,queueId:b,queueState:'En fila',waitMinutes:5};
 assert.equal(classifySessions([{...s,id:1,waitMinutes:1},valid])[0].id,2);
});
// Texto de referencia de capturas antiguas; los UUID de prueba son ficticios.
const bocaEntry='https://bocajuniors.queue-it.net/?c=bocajuniors&e=ejemplo&cid=es-ES';
const bocaText=(wait,id=a)=>`TU LUGAR ESTÁ CADA VEZ MÁS CERCA
Ya estás en la fila virtual para conseguir tus lugares.
Al llegar tu turno, tendrás 10 minutos para realizar la transacción.
Tu posición en la fila no garantiza disponibilidad al realizar la transacción.
Entrarás dentro de
${wait}
ACTUALIZADO: 13:14:53
Identificador de fila: ${id}`;
test('Boca: 1 minuto es espera; los 10 minutos de compra no se confunden con ella',()=>{
 const s=observeQueue({url:bocaEntry,text:bocaText('1 MINUTO')});
 assert.equal(s.wait,'1 MINUTO');assert.equal(s.waitMinutes,1);assert.equal(s.siteUpdatedAt,'13:14:53');
 assert.equal(s.queueId,a);assert.equal(s.queueState,'En fila');
 assert.equal(new URL(s.queueLink).searchParams.get('q'),a);
});
test('Boca: reconoce 10 minutos, saltos de línea y espacios del navegador',()=>{
 const s=observeQueue({url:bocaEntry,text:bocaText('10\u00a0MINUTOS').replace(/\n/g,'\r\n')});
 assert.equal(s.waitMinutes,10);assert.equal(s.wait,'10 MINUTOS');assert.equal(s.siteUpdatedAt,'13:14:53');
});
test('Boca: reconoce el valor inline sin incluir la hora de actualización',()=>{
 const s=observeQueue({url:bocaEntry,text:'Entraras dentro de 5 MINUTOS ACTUALIZADO: 13:25:08'});
 assert.equal(s.wait,'5 MINUTOS');assert.equal(s.waitMinutes,5);assert.equal(s.siteUpdatedAt,'13:25:08');
});
test('Boca: ordena 1 antes que 10, y una espera mayor a una hora queda sin número exacto',()=>{
 const one={...observeQueue({url:bocaEntry,text:bocaText('1 MINUTO',a)}),id:1};
 const ten={...observeQueue({url:bocaEntry,text:bocaText('10 MINUTOS',b)}),id:2};
 assert.equal(classifySessions([ten,one])[0].id,1);
 const unknown=observeQueue({url:bocaEntry,text:bocaText('MÁS DE UNA HORA')});
 assert.equal(unknown.waitMinutes,null);assert.equal(unknown.wait,'MÁS DE UNA HORA');
});
test('Boca: no inventa una espera a partir del plazo de compra ni una hora inválida',()=>{
 const s=observeQueue({url:bocaEntry,text:'Al llegar tu turno, tendrás 10 minutos para realizar la transacción. ACTUALIZADO: 29:99:00'});
 assert.equal(s.wait,null);assert.equal(s.waitMinutes,null);assert.equal(s.siteUpdatedAt,null);
});
test('preparar prefila conserva evento, destino e idioma y quita la posición compartida',()=>{
 const destination='https://bocasocios.bocajuniors.com.ar/queueit/redirect';
 const pasted=new URL(bocaEntry);pasted.searchParams.set('t',destination);pasted.searchParams.set('q',a);pasted.searchParams.set('queueittoken','pase-ficticio');
 const prepared=prepareEntry(pasted.href),entry=new URL(prepared.entryUrl);
 assert.equal(entry.searchParams.has('q'),false);assert.equal(entry.searchParams.has('queueittoken'),false);
 assert.equal(entry.searchParams.get('t'),destination);assert.equal(prepared.event,'ejemplo');assert.equal(prepared.language,'es-ES');
 assert.deepEqual(prepared.removed,['q','queueittoken']);
});
test('el enlace de entrada debe ser completo y no puede ser una página de bloqueo',()=>{
 for(const bad of ['https://bocajuniors.queue-it.net/?c=bocajuniors','https://bestunion.queue-it.net/softblock/?c=a&e=b','javascript:alert(1)','https://ejemplo.invalid/'])assert.throws(()=>prepareEntry(bad));
 assert.equal(prepareEntry(' https://bocasocios.bocajuniors.com.ar/home ').entryUrl,'https://bocasocios.bocajuniors.com.ar/home');
});
test('la prefila no obtiene prioridad sobre una posición ya asignada',()=>{
 const pre={...observeQueue({url:url(a),text:'The event will begin at 13:00'}),id:1,waitMinutes:0};
 const queued={...observeQueue({url:url(b),text:'Your estimated wait time is: 10 minutes'}),id:2};
 assert.equal(classifySessions([pre,queued])[0].id,2);
});

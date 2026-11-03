import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {buildQueueLink} from '../queue.mjs';
const browserLink=vm.runInNewContext((await fs.readFile(new URL('../ui-sync.js',import.meta.url),'utf8'))+'\nqueueLinkFor;',{URL});
const id='11111111-2222-3333-4444-555555555555';
const target='https://bocasocios-gw.bocajuniors.com.ar/queueit/redirect';
const entry='https://bocajuniors.queue-it.net/?c=bocajuniors&e=e20261107ple&ver=v3-javascript-3.7.10&cver=333&man=Ejemplo&t='+encodeURIComponent(target);
test('servidor y botón copian el formato pedido, con cid español y q al final',()=>{
 const expected='https://bocajuniors.queue-it.net/?c=bocajuniors&e=e20261107ple&t='+encodeURIComponent(target)+'&cid=es-ES&q='+id;
 assert.equal(buildQueueLink({url:entry,queueId:id}),expected);
 assert.equal(browserLink({currentUrl:entry,queueId:id},entry),expected);
 assert.deepEqual([...new URL(expected).searchParams.keys()],['c','e','t','cid','q']);
});
test('recupera el destino del enlace de entrada del mismo evento',()=>{
 const current='https://bocajuniors.queue-it.net/?c=bocajuniors&e=e20261107ple';
 for(const link of [buildQueueLink({url:current,entryUrl:entry,queueId:id}),browserLink({currentUrl:current,queueId:id},entry)])assert.equal(new URL(link).searchParams.get('t'),target);
 const different=entry.replace('e20261107ple','otro-evento');
 assert.equal(new URL(buildQueueLink({url:current,entryUrl:different,queueId:id})).searchParams.has('t'),false);
});
test('no ofrece enlace para error, bloqueo, otro dominio o identificador vacío',()=>{
 for(const bad of ['https://bocajuniors.queue-it.net/error?er=5','https://bocajuniors.queue-it.net/softblock/','https://ejemplo.invalid/']){
  assert.equal(buildQueueLink({url:bad,queueId:id}),null);assert.equal(browserLink({currentUrl:bad,queueId:id}),null);
 }
 assert.equal(buildQueueLink({url:entry,queueId:null}),null);
 assert.equal(browserLink({currentUrl:entry,queueId:'00000000-0000-0000-0000-000000000000'}),null);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resourceReason,selectedTarget,DEFAULT_ENTRY,SESSION_LIMIT} from '../control.mjs';
test('automático busca hasta 50; el límite no vuelve a 3 en modo real',()=>{
 assert.equal(selectedTarget('auto'),50);assert.equal(SESSION_LIMIT,50);assert.equal(selectedTarget('20'),20);
 for(const invalid of [0,51,-1,'',null,'abc',1.5])assert.throws(()=>selectedTarget(invalid));
 assert.equal(new URL(DEFAULT_ENTRY).hostname,'bocasocios.bocajuniors.com.ar');
});
test('el freno depende de RAM actual o CPU; no del crecimiento global acumulado',()=>{
 assert.equal(resourceReason({freeBytes:4e9,reserveBytes:3e9,cpu:20}),'');
 assert.match(resourceReason({freeBytes:2.9e9,reserveBytes:3e9,cpu:20}),/RAM/);
 assert.match(resourceReason({freeBytes:4e9,reserveBytes:3e9,cpu:76}),/CPU/);
 assert.equal(resourceReason({freeBytes:4e9,reserveBytes:3e9,cpu:75}),'');
});

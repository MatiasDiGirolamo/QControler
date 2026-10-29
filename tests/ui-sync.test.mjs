import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
const SnapshotGate=vm.runInNewContext((await fs.readFile(new URL('../ui-sync.js',import.meta.url),'utf8'))+'\nSnapshotGate;');
test('una lectura anterior a Detener no sobrescribe el botón habilitado después del cierre',()=>{
 const gate=new SnapshotGate();
 const beforeStop=gate.begin();gate.invalidate();
 const duringStop=gate.begin();gate.invalidate();
 const afterStop=gate.begin();assert.equal(gate.accept(afterStop),true);
 assert.equal(gate.accept(beforeStop),false);assert.equal(gate.accept(duringStop),false);
});
test('descarta lecturas que llegan fuera de orden y acepta las del siguiente inicio',()=>{
 const gate=new SnapshotGate();const old=gate.begin(),fresh=gate.begin();
 assert.equal(gate.accept(fresh),true);assert.equal(gate.accept(old),false);
 gate.invalidate();assert.equal(gate.accept(gate.begin()),true);
});

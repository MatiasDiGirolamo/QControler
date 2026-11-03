import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {botProfile,renderPanel} from '../bot-profile.mjs';
const template=await fs.readFile(new URL('../index.html',import.meta.url),'utf8');
test('cada bot tiene puerto y configuración propios; Filas es el predeterminado',()=>{
  const queue=botProfile(),platea=botProfile(['--platea']);
  assert.equal(queue.kind,'queue');assert.equal(queue.platea,false);
  assert.notEqual(queue.port,platea.port);assert.notEqual(queue.settingsFile,platea.settingsFile);
  assert.equal(platea.platea,true);assert.equal(Object.isFrozen(platea),true);
});
test('Filas elimina del HTML cuentas y reservas; Platea elimina el flujo de ranking de filas',()=>{
  const queue=renderPanel(template,botProfile(),{token:'test',version:'test'});
  const platea=renderPanel(template,botProfile(['--platea']),{token:'test',version:'test'});
  assert.equal(queue.includes('id="accounts-form"'),false);assert.equal(queue.includes('id="reservations"'),false);
  assert.equal(queue.includes('type="password"'),false);
  assert.equal(platea.includes('id="accounts-form"'),true);assert.equal(platea.includes('id="reservations"'),true);
  assert.equal(queue.includes('class="panel preview-panel"'),false);
  assert.equal(platea.includes('class="panel preview-panel"'),true);
  assert.equal(platea.includes('queda primero en la lista'),false);
  assert.match(queue,/botKind='queue'/);assert.match(platea,/botKind='platea'/);
  for(const html of [queue,platea])assert.doesNotMatch(html,/__[A-Z_]+__/);
});

test('Platea fija dos sesiones y elimina las cantidades masivas del panel; Filas conserva sus opciones',()=>{
  assert.equal(botProfile(['--platea']).sessionLimit,2);assert.equal(botProfile().sessionLimit,50);
  const platea=renderPanel(template,botProfile(['--platea']),{token:'test',version:'test'}),queue=renderPanel(template,botProfile(),{token:'test',version:'test'});
  assert.match(platea,/id="target" type="hidden" value="2"/);assert.equal(platea.includes('<option>50</option>'),false);assert.equal(queue.includes('<option>50</option>'),true);
});

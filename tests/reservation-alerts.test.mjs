import {test} from 'node:test';
import assert from 'node:assert/strict';
await import('../reservation-alerts.js');
const {ReservationAlerts}=globalThis;
const record=outcome=>({slot:'1',session:3,at:'2026-10-31T20:00:00Z',outcome});
test('solo confirma reservas verificadas; un resultado incierto queda separado',()=>{
  const alerts=new ReservationAlerts();
  assert.deepEqual(alerts.update([record('pending')]),[]);
  assert.equal(alerts.update([record('reserved')])[0].outcome,'reserved');
  assert.deepEqual(alerts.update([record('reserved')]),[]);
  assert.equal(alerts.update([record('uncertain')])[0].outcome,'uncertain');
});
test('el aviso no desaparece con un refresco y se puede reconocer sin borrar la reserva',()=>{
  const alerts=new ReservationAlerts(),rows=[record('reserved')];alerts.update(rows);
  assert.equal(alerts.pending(rows).length,1);alerts.acknowledge(rows);assert.equal(alerts.pending(rows).length,0);
  assert.equal(rows[0].outcome,'reserved');
});
test('recargar el panel conserva avisos y no repite el primer sonido; otra reserva vuelve a avisar',()=>{
  let saved=null;const storage={getItem:()=>saved,setItem:(_,data)=>{saved=data;}};
  const first=new ReservationAlerts(storage),rows=[record('reserved')];first.update(rows);
  const reloaded=new ReservationAlerts(storage);assert.equal(reloaded.update(rows).length,0);assert.equal(reloaded.pending(rows).length,1);
  reloaded.acknowledge(rows);assert.equal(new ReservationAlerts(storage).pending(rows).length,0);
  assert.equal(reloaded.update([{...record('reserved'),session:4}]).length,1);
});

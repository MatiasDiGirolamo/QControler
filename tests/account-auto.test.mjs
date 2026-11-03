import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {AccountAuto,loginInPage,advanceInPage,matchTarget,validateAccounts} from '../account-auto.mjs';
const origin='https://bocasocios.bocajuniors.com.ar';
const config=()=>({accounts:{'1':{user:'a@example.test',password:'pass-a'},'2':{user:'b@example.test',password:'pass-b'}},matchUrl:origin+'/matches/878/assist'});
test('solo acepta el partido de Boca, nunca otro origen o una URL de fila',()=>{
  assert.equal(matchTarget(config().matchUrl).matchId,'878');
  for(const url of ['https://evil.test/matches/878/assist',origin+'/home',origin+'/matches/0/assist',origin+'/matches/878/purchase','https://u:p@bocasocios.bocajuniors.com.ar/matches/878/assist'])assert.throws(()=>matchTarget(url));
  const input=config();input.accounts['2'].password='';assert.throws(()=>validateAccounts(input));
});
test('asigna alternadamente sin exponer credenciales en el estado; olvidar elimina accesos',()=>{
  const a=new AccountAuto();a.configure(config());
  assert.deepEqual([1,2,3,4].map(n=>a.assign(n)),['1','2','1','2']);
  assert.equal(JSON.stringify(a.summary()).includes('pass-a'),false);
  a.clear();assert.deepEqual(a.accounts,{});assert.equal(a.summary().configured,false);assert.equal(a.enabled,false);
});
function session(stage='form',url=origin+'/login'){
  const calls=[];const s={id:1,account:'1',autoEnabled:true,page:{isClosed:()=>false,url:()=>url,evaluate:async(fn,arg)=>{
    calls.push({fn,arg});if(fn===loginInPage)return arg?'submitted':stage;
    if(typeof arg==='string')return true;
    return false;
  }}};return {s,calls};
}
const platea={owners:new Map(),summary:()=>[]};
test('solo un envío por sesión aunque se siga mostrando el formulario; no clona sesiones',async()=>{
  const a=new AccountAuto();a.configure(config());const {s,calls}=session();
  await a.tick(s,platea);await a.tick(s,platea);
  assert.equal(calls.filter(c=>c.fn===loginInPage&&c.arg).length,1);
  assert.equal(calls.find(c=>c.arg?.password)?.arg.password,'pass-a');
});
test('no envía credenciales en Queue-it, CAPTCHA, formulario desconocido o sesión detenida',async()=>{
  const a=new AccountAuto();a.configure(config());
  for(const [stage,url,enabled] of [['form','https://bocajuniors.queue-it.net/',true],['attention',origin+'/login',true],['unknown-form',origin+'/login',true],['form',origin+'/login',false]]){
    const {s,calls}=session(stage,url);s.autoEnabled=enabled;await a.tick(s,platea);
    assert.equal(calls.filter(c=>c.arg?.password).length,0);
  }
});
test('mapa correcto inicia Platea aunque otra sesión del mismo socio esté buscando',async()=>{
  const a=new AccountAuto();a.configure(config());const {s,calls}=session('waiting',origin+'/matches/878/plateas');
  await a.tick(s,{owners:new Map([['1',new Set([2])]]),summary:()=>[]});assert.equal(s.autoStarted,true);
  await a.tick(s,platea);await a.tick(s,platea);
  assert.equal(s.autoStarted,true);assert.equal(calls.filter(c=>c.fn.toString().includes('__qcAutoStart')).length,1);
});
test('reserva pendiente o mapa de otro partido no dispara la búsqueda',async()=>{
  const a=new AccountAuto();a.configure(config());
  const {s,calls}=session('waiting',origin+'/matches/878/plateas');
  await a.tick(s,{owners:new Map(),summary:()=>[{slot:'1'}]});assert.equal(calls.some(c=>c.fn.toString().includes('__qcAutoStart')),false);
  const other=session('waiting',origin+'/matches/999/plateas');await a.tick(other.s,platea);assert.equal(other.s.autoStarted,undefined);
});

function formFixture({outside=false,captcha=false,registration=false,externalAction=false,disabled=false,enableAfterFill=false}={}){
  class Input {constructor(type,name){this.type=type;this.name=name;this.labels=[];}getClientRects(){return [1];}getAttribute(){return null;}closest(){return form;}get value(){return this._value;}set value(v){this._value=v;}dispatchEvent(){}}
  const user=new Input('text','usuario'),pass=new Input('password','password');let clicked=0;
  const button={disabled,textContent:'INICIAR SESIÓN',getClientRects:()=>[1],click:()=>clicked++};
  const form={action:externalAction?'https://evil.test/':origin+'/login',querySelectorAll:s=>s==='input'?[user,pass]:[button]};
  const window={};window.top=outside?{}:window;
  const location={origin,href:origin+'/login'};
  const document={body:{innerText:captcha?'Verificá el CAPTCHA':''},querySelectorAll:s=>s==='iframe'?[]:registration?[pass,new Input('password','confirm')]:[pass]};
  const context={window,location,document,HTMLInputElement:Input,URL,Event:class{},setTimeout:callback=>{if(enableAfterFill&&user.value&&pass.value)button.disabled=false;callback();},credentials:{user:'my-user',password:'my-password'}};
  const run=()=>vm.runInNewContext('('+loginInPage.toString()+')(credentials)',context);
  return {run,user,pass,clicked:()=>clicked};
}
test('formulario normal: completa y envía; no completa formularios externos, de registro ni desafíos',async()=>{
  const good=formFixture();assert.equal(await good.run(),'submitted');assert.equal(good.user.value,'my-user');assert.equal(good.pass.value,'my-password');assert.equal(good.clicked(),1);
  for(const options of [{outside:true},{captcha:true},{registration:true},{externalAction:true}]){
    const fixture=formFixture(options);assert.notEqual(await fixture.run(),'submitted');assert.equal(fixture.pass.value,undefined);assert.equal(fixture.clicked(),0);
  }
});

test('Boca: reconoce INICIAR SESIÓN deshabilitado y espera a que el formulario lo habilite',async()=>{
  const fixture=formFixture({disabled:true,enableAfterFill:true});
  assert.equal(await fixture.run(),'submitted');assert.equal(fixture.clicked(),1);
});
test('Boca: si el botón sigue deshabilitado no fuerza un envío ni afirma que inició sesión',async()=>{
  const fixture=formFixture({disabled:true});assert.equal(await fixture.run(),'button-disabled');assert.equal(fixture.clicked(),0);
});
test('no acepta un número de socio en lugar del correo electrónico',()=>{
  const input=config();input.accounts['1'].user='123456';assert.throws(()=>validateAccounts(input),/correo/);
});

test('Inicio: reconoce VER MÁS como botón de tarjeta sin enlace, y detecta un partido diferente',()=>{
  let clicks=0;const card={innerText:'BOCA JRS VS RIVER PLATE',parentElement:null};
  const button={textContent:'VER MÁS',parentElement:card,getClientRects:()=>[1],getAttribute:()=>null,closest:()=>null,contains:()=>false,click:()=>clicks++};
  const location={origin,href:origin+'/home',pathname:'/home'};
  const document={body:{},querySelectorAll:()=>[button]};
  const run=()=>vm.runInNewContext('('+advanceInPage.toString()+')({matchId:"878"})',{location,document,URL});
  assert.equal(run(),'match-button');assert.equal(clicks,1);
  location.pathname='/matches/999/assist';assert.equal(run(),'wrong-match');assert.equal(clicks,1);
  document.querySelectorAll=()=>[button,{...button}];location.pathname='/home';assert.equal(run(),'ambiguous');assert.equal(clicks,1);
});

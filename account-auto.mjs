export const BOCA_ORIGIN='https://bocasocios.bocajuniors.com.ar';
export function matchTarget(value) {
  const url=new URL(value);
  const match=url.pathname.match(/^\/matches\/([1-9]\d*)\/(assist|plateas)\/?$/);
  if(url.origin!==BOCA_ORIGIN||url.username||url.password||!match)throw new Error('Usá el enlace de la ficha o mapa del partido de Boca Socios.');
  return {matchId:match[1],url:BOCA_ORIGIN+url.pathname};
}
export function validateAccounts(input) {
  const accounts={};
  for(const slot of ['1','2']) {
    const user=input.accounts?.[slot]?.user,password=input.accounts?.[slot]?.password;
    if(typeof user!=='string'||!/^\S+@[^\s@]+\.[^\s@]+$/.test(user.trim())||user.length>200||typeof password!=='string'||!password||password.length>500)throw new Error('Completá el correo electrónico y la contraseña de los dos socios.');
    accounts[slot]={user:user.trim(),password};
  }
  return {accounts,target:matchTarget(input.matchUrl)};
}

// Credentials never go to a frame, another origin,
// a registration form, an HTTP endpoint invented by the app, or a log.
export async function loginInPage(credentials) {
  if(window!==window.top||location.origin!=='https://bocasocios.bocajuniors.com.ar')return 'waiting';
  const visible=e=>!!e.getClientRects().length;
  const text=document.body?.innerText||'';
  if(/captcha|demasiadas solicitudes|acceso denegado|verific.{0,20}(?:humano|persona)|credenciales incorrectas|contraseña incorrecta/i.test(text)||[...document.querySelectorAll('iframe')].some(e=>visible(e)&&/captcha|challenge/i.test(e.title||'')))return 'attention';
  const passwords=[...document.querySelectorAll('input[type="password"]')].filter(e=>visible(e)&&!e.disabled);
  if(!passwords.length)return 'waiting';
  if(passwords.length!==1)return 'unknown-form';
  const password=passwords[0],form=password.closest('form');
  if(!form)return 'unknown-form';
  if(new URL(form.action||location.href,location.href).origin!==location.origin)return 'unknown-form';
  const inputs=[...form.querySelectorAll('input')].filter(e=>visible(e)&&!e.disabled&&e!==password&&!['hidden','submit','button','checkbox','radio'].includes(e.type));
  const recognized=inputs.filter(e=>/usuario|socio|documento|dni|email|correo|username/i.test([e.name,e.id,e.placeholder,e.autocomplete,e.getAttribute('aria-label'),...(e.labels||[])].map(v=>v?.textContent||v||'').join(' ')));
  const users=recognized.length?recognized:inputs;
  const submit=[...form.querySelectorAll('button,input[type="submit"]')].filter(e=>visible(e)&&/^(ingresar|entrar|acceder|iniciar sesi[oó]n)$/i.test((e.textContent||e.value||'').trim()));
  if(users.length!==1||submit.length!==1)return 'unknown-form';
  if(submit[0].formAction&&new URL(submit[0].formAction,location.href).origin!==location.origin)return 'unknown-form';
  if(!credentials)return 'form';
  const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
  for(const [element,value] of [[users[0],credentials.user],[password,credentials.password]]) {
    setter.call(element,value);element.dispatchEvent(new Event('input',{bubbles:true}));element.dispatchEvent(new Event('change',{bubbles:true}));
  }
  // Boca disables INICIAR SESIÓN until its React form validates both fields.
  // Wait for the site's own state; never remove disabled or submit by force.
  for(let attempt=0;attempt<20;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,100));
    if(location.origin!=='https://bocasocios.bocajuniors.com.ar'||form.isConnected===false||submit[0].isConnected===false)return 'form-changed';
    if(!submit[0].disabled&&submit[0].getAttribute?.('aria-disabled')!=='true')break;
  }
  if(submit[0].disabled||submit[0].getAttribute?.('aria-disabled')==='true')return 'button-disabled';
  if(users[0].value!==credentials.user||password.value!==credentials.password)return 'fields-rejected';
  if(typeof form.checkValidity==='function'&&!form.checkValidity())return 'fields-rejected';
  if(new URL(form.action||location.href,location.href).origin!==location.origin||(submit[0].formAction&&new URL(submit[0].formAction,location.href).origin!==location.origin))return 'unknown-form';
  submit[0].click();return 'submitted';
}

export function advanceInPage({matchId}) {
  if(location.origin!=='https://bocasocios.bocajuniors.com.ar')return 'waiting';
  const visible=e=>!!e.getClientRects().length&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
  const path=location.pathname,route=path.match(/^\/matches\/(\d+)\//);
  if(route&&route[1]!==String(matchId))return 'wrong-match';
  const controls=[...document.querySelectorAll('a,button,[role="button"]')].filter(visible);
  const href=e=>{try{return new URL(e.closest('a[href]')?.href||e.getAttribute('href'),location.href);}catch{return null;}};
  if(path==='/home'||path==='/') {
    const links=controls.filter(e=>{const u=href(e);return u?.origin===location.origin&&new RegExp('^/matches/'+matchId+'/(assist|plateas)/?$').test(u.pathname);});
    // Avoid double-counting a button nested inside its link.
    const unique=links.filter(e=>!links.some(other=>other!==e&&other.contains(e)));
    if(unique.length===1){unique[0].click();return 'match-link';}
    const more=controls.filter(e=>/^VER M[AÁ]S$/i.test(e.textContent.trim()));
    const cards=more.filter(e=>{
      const u=href(e);if(u&&/^\/matches\//.test(u.pathname))return false;
      for(let node=e.parentElement,i=0;node&&i<6;node=node.parentElement,i++) {
        if(node===document.body)break;
        if(/\bvs\b/i.test(node.innerText||''))return true;
      }
      return false;
    });
    if(more.length===1&&cards.length===1){cards[0].click();return 'match-button';}
    if(more.length>1)return 'ambiguous';
    const login=controls.filter(e=>/^(ingresar|iniciar sesi[oó]n)$/i.test(e.textContent.trim()));
    if(login.length===1){login[0].click();return 'login';}
  }
  if(path.match(new RegExp('^/matches/'+matchId+'/assist/?$'))) {
    const buttons=controls.filter(e=>/^OBTENER PLATEAS$/i.test(e.textContent.trim()));
    const unique=buttons.filter(e=>!buttons.some(other=>other!==e&&other.contains(e)));
    if(unique.length===1){unique[0].click();return 'plateas-button';}
  }
  return 'waiting';
}

export class AccountAuto {
  constructor(){this.accounts={};this.target=null;this.version=0;this.enabled=false;}
  configure(input) {const config=validateAccounts(input);this.accounts=config.accounts;this.target=config.target;this.version++;this.enabled=true;}
  clear(){this.accounts={};this.enabled=false;this.version++;}
  summary(){return {enabled:this.enabled,configured:['1','2'].every(s=>!!this.accounts[s]),matchUrl:this.target?.url||''};}
  assign(id){return String((id-1)%2+1);}
  async tick(s,platea){
    if(!this.enabled||!s.autoEnabled||s.autoBusy||s.page.isClosed())return;
    s.autoBusy=true;
    try {
      if(new URL(s.page.url()).origin!==BOCA_ORIGIN){s.access='Esperando acceso de Boca';return;}
      const stage=await s.page.evaluate(loginInPage,null);
      if(stage==='attention'||stage==='unknown-form') {s.access=stage==='attention'?'Acceso requiere atención':'Formulario no reconocido · revisar';s.autoEnabled=false;return;}
      if(stage==='form') {
        if(s.loginVersion===this.version){s.access='Acceso enviado · si no avanza, revisá la sesión';return;}
        const credentials=this.accounts[s.account];if(!credentials){s.access='Falta cargar la cuenta';return;}
        s.loginVersion=this.version; // One submit per session and credential revision, never a retry loop.
        const result=await s.page.evaluate(loginInPage,credentials);
        s.access=result==='submitted'?'Formulario de acceso enviado':result==='button-disabled'?'Boca no habilitó Iniciar sesión · revisá el correo y la contraseña':result==='fields-rejected'?'El formulario no aceptó los campos · usá el correo electrónico de la cuenta':'El formulario cambió · acceso requiere revisión';
        if(result!=='submitted')s.autoEnabled=false;
        return;
      }
      const target=this.target;
      const route=new URL(s.page.url()).pathname;
      if(route.match(new RegExp('^/matches/'+target.matchId+'/plateas/?$'))) {
        s.access='Mapa del partido abierto';
        if(s.autoStarted)return;
        if(platea.summary().some(v=>v.slot===s.account&&v.outcome!=='pending')){s.access='Cuenta bloqueada · revisar carrito';return;}
        const started=await s.page.evaluate(id=>window.__qcAutoStart?.(id)||false,target.matchId);
        if(started){s.autoStarted=true;s.access='Platea iniciada automáticamente';}
        return;
      }
      // Follow only visible links/buttons belonging to the requested match.
      if(s.autoStarted)return;
      if(s.lastNavigationRoute===route&&Date.now()-s.lastNavigationAt<12000){s.access='Esperando que Boca abra el paso siguiente';return;}
      const action=await s.page.evaluate(advanceInPage,target);
      if(action==='wrong-match'){s.access='El partido abierto no coincide con el configurado · revisá el enlace del partido';s.autoEnabled=false;return;}
      if(action==='ambiguous'){s.access='Hay varios partidos · elegí el configurado en su ventana';return;}
      const advanced=['match-link','match-button','login','plateas-button'].includes(action);
      if(advanced){s.lastNavigationRoute=route;s.lastNavigationAt=Date.now();}
      s.access=advanced?'Avanzando al partido':'Esperando formulario o enlace del partido';
      s.homeObservedAt||=Date.now();
      if(!advanced&&!s.targetNavigationAttempt&&['/','/home'].includes(route)&&Date.now()-s.homeObservedAt>=10000) {
        s.targetNavigationAttempt=true;
        await s.page.goto(target.url,{waitUntil:'domcontentloaded',timeout:10000});
        s.access='Abriendo el partido solicitado';
      }
    } catch {s.access='Sin lectura de acceso · se conserva la sesión';}
    finally{
      try {await s.page.evaluate(message=>window.__qcSetAccess?.(message),s.access||'Esperando acceso');}catch{}
      s.autoBusy=false;
    }
  }
}

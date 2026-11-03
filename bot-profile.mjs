export function botProfile(args=[]) {
  const kind=args.includes('--platea')?'platea':'queue';
  return Object.freeze({kind,platea:kind==='platea',label:kind==='platea'?'Platea':'Filas',sessionLimit:kind==='platea'?2:50,port:kind==='platea'?38472:38471,settingsFile:kind==='platea'?'settings-platea.json':'settings.json',otherFlag:kind==='platea'?'--queue':'--platea'});
}
export function renderPanel(source,profile,{token,version}) {
  let html=source.replace(/<!-- PLATEA_ONLY_START -->([\s\S]*?)<!-- PLATEA_ONLY_END -->/g,(_,content)=>profile.platea?content:'');
  html=html.replace(/<!-- QUEUE_ONLY_START -->([\s\S]*?)<!-- QUEUE_ONLY_END -->/g,(_,content)=>profile.platea?'':content);
  if(profile.platea){html=html.replace(/<label for="target">[\s\S]*?<\/select>/,'<input id="target" type="hidden" value="2"><span>Dos sesiones fijas · una por socio</span>');html=html.replace(/<label for="entry-url">[\s\S]*?<button id="start"/,'<input id="entry-url" type="hidden" value="https://bocasocios.bocajuniors.com.ar/home"><button id="start"');}
  const values={CAPACITY_NOTE:profile.platea?'Dos sesiones fijas; no garantiza entradas.':'Hasta 50 sesiones según recursos; no garantiza entradas.',TOKEN:token,VERSION:version,BOT:profile.kind,BOT_LABEL:profile.label,OTHER_LABEL:profile.platea?'Filas':'Platea',
    HERO:profile.platea?'Dos socios. Dos sesiones.':'Tus filas, en un panel propio.',
    SUBTITLE:profile.platea?'Búsqueda automática desde esta app, sin instalar extensiones.':'Sesiones de fila, identificadores y esperas en un solo lugar.',
    ENTRY_TITLE:profile.platea?'Iniciar búsqueda de plateas.':'Tu próxima fila, en un paso.',
    ENTRY_HELP:profile.platea?'Las sesiones ingresan a Boca con las cuentas cargadas y buscan en el partido indicado.':'Pegá el enlace completo de la prefila. Creamos sesiones separadas y mostramos las esperas que informe el sitio.',
    ENTRY_LABEL:profile.platea?'Página de inicio de Boca':'URL de prefila',
    ENTRY_BADGE:profile.platea?'BOCA SOCIOS · PLATEA':'FILAS VIRTUALES',
    LIVE_LABEL:profile.platea?'Boca / búsqueda de plateas':'Fila real',
    EMPTY_HELP:profile.platea?'Cargá las cuentas, indicá el partido e iniciá las sesiones de Platea.':'Pegá el enlace de la prefila y pulsá Iniciar automático.',
    PREVIEW_HELP:profile.platea?'Vista estática. Usá Abrir sesión para revisar el mapa y completar el pago en Chrome.':'Vista estática de la sesión de fila.',
    FOOTER:profile.platea?'Platea usa dos sesiones, una por socio. Avisos y registro en esta app; pago manual.':'Este panel controla solo Filas. No carga cuentas ni reserva plateas. Detener cierra únicamente estas sesiones.'};
  return html.replace(/__([A-Z_]+)__/g,(all,key)=>values[key]??all);
}

# QController 2.0.1 · Platea simple y Filas separados

## Platea: dos cuentas, dos sesiones

1. Abrí **INICIAR_PLATEA.cmd**. El panel local está en `http://127.0.0.1:38472` y debe mostrar **2.0.1**.
2. Cargá los dos correos y contraseñas de Boca y el enlace de la ficha o mapa del partido (`/matches/NUMERO/assist` o `/matches/NUMERO/plateas`). Los datos quedan solo en memoria; los campos se vacían tras cargar. No se escriben contraseñas ni tokens en registros.
3. Activá/probá el sonido y pulsá **Iniciar las dos sesiones**. Abre exactamente dos contextos aislados de Chrome: Socio 1 y Socio 2. No hay selector para crear decenas de ventanas y el servidor también rechaza esas cantidades.
4. El programa completa el acceso normal cuando aparece y sigue Inicio → VER MÁS → OBTENER PLATEAS. Si hay varios partidos ambiguos, un CAPTCHA, un acceso rechazado o un formulario desconocido, conserva la sesión para revisión.
5. Busca en **todos los sectores**. Cada tarjeta permite abrir su ventana, detener su búsqueda y reanudarla. El pago es manual.

No se instala una extensión ni hay panel superpuesto en Boca. El motor administrado es `platea-worker.js`; opera dentro de la sesión autenticada y usa el cliente HTTP del sitio mediante el puente compartido `../boca-extension/page-api.js`. Por eso ambas carpetas deben permanecer juntas. No se afirma que eliminar la interfaz por sí solo haga más rápida una reserva.

## Búsqueda y reserva

La disponibilidad se consulta mediante una cola común: una consulta autorizada en vuelo, con separación mínima de dos segundos y alternancia entre cuentas. Ese intervalo es un punto de partida, no un límite de Boca verificado. Las consultas propias de la página no están controladas por este programador.

Al detectar una sección, el motor consulta **socio, carrito y asientos en paralelo**. No envía el agregado hasta que se hayan completado las tres respuestas, el socio sea identificable y el carrito esté vacío. Conserva un bloqueo persistente antes del POST y confirma el mismo ticket y asiento en el carrito. La cola de disponibilidad no agrega una espera artificial al POST habilitado.

Una reserva confirmada o incierta genera un cartel persistente en la app con socio, sesión y botón para abrir su ventana. La alarma se repite cada quince segundos mientras no se reconozca el aviso, si se activó el audio y el navegador permite reproducirlo. Mantené el panel abierto. **Ya lo vi** silencia/reconoce el aviso, pero no cancela ni libera la reserva.

HTTP 429 conserva una espera compartida fija de veinte segundos, o un Retry-After mayor indicado por Boca. Al terminar se retoma por turnos. Fallos temporales anteriores al agregado pueden reintentarse; una falla posterior al POST queda incierta y nunca habilita un segundo agregado automático. Tampoco se reanudan a ciegas una parada manual, CAPTCHA, rechazo de acceso o carrito con selección.

## Registro de tiempos

El panel muestra consultas, sectores detectados, resultado del intento, código HTTP disponible y tiempos medidos: socio, carrito previo, asientos, preparación paralela, bloqueo, reserva, asignación y confirmación. No muestra cuerpos HTTP, encabezados de autenticación ni credenciales. **Descargar registro** exporta hasta mil eventos recientes en JSONL. El registro permanece solo en memoria y se pierde al cerrar el programa.

Los tiempos de preparación y reserva permiten medir el recorrido real: no son estimaciones de velocidad garantizada. No se ha validado aún una reserva real con las cuentas del usuario.

## Cierre y recuperación

**Cerrar programa** termina las sesiones de ese bot y su proceso local, liberando el puerto. Usalo antes de actualizar. **Detener Platea** cierra las sesiones pero mantiene el panel/programa abierto para poder iniciar otra vez. El programa puede estar en segundo plano aunque no haya una ventana de consola visible.

`platea-ledger.json` conserva reservas pendientes al cerrar Chrome o Node. No contiene contraseñas ni tokens; guarda identificadores del socio y estados. No lo borres para reintentar una reserva incierta. **Carrito revisado: habilitar otra búsqueda** exige la revisión manual del usuario; no cancela entradas.

Detener una búsqueda no revierte solicitudes ya enviadas. **Detener Platea** cierra sus ventanas y limpia los perfiles temporales: podés perder el acceso a filas o carritos. El registro conserva el bloqueo, pero no recupera la sesión. Terminá el pago antes de cerrar. Al reiniciar hay que cargar las cuentas nuevamente.

## Filas

**INICIAR.cmd** o **INICIAR_FILAS.cmd** abre el bot de filas en `http://127.0.0.1:38471`. Mantiene su cantidad configurable hasta 50 según recursos, sus identificadores y esperas. No carga cuentas ni reserva plateas. Ambos bots usan procesos y sesiones independientes. Detener uno no detiene el otro.

Requiere Node.js, Chrome y playwright-core. No hay mínimo de RAM: su uso es informativo. La creación se pausa si la CPU supera el 75 % y el reintento automático requiere CPU menor al 60 % durante 10 segundos. Para actualizar, cerrá el programa/consola anterior del bot y volvé a iniciarlo. Recargar Chrome no sustituye el proceso que está ejecutando una versión anterior.

## Validación

- `node --test tests/*.test.mjs` en esta carpeta.
- `node --test tests/*.test.cjs` en `boca-extension`.
- `npm run test:accounts`: Chrome offline con acceso, navegación, detección, reserva ficticia y registro, sin extensión ni superposición.
- `node tests/account-auto.browser.mjs --rate-limit`: añade un HTTP 429 simulado y comprueba reanudación tras veinte segundos.
- `npm run test:platea`: panel real local de dos sesiones, límites del servidor, aislamiento, exportación, avisos, cierre y reinicio.
- `npm run test:browser`: regresión del panel Filas separado.

Las pruebas de reserva usan respuestas simuladas. No garantizan entradas, no evitan colas y no resuelven CAPTCHAs.

## Ajuste de rapidez en 2.0.1

Se registra **Detección a inicio de solicitud** por separado de **Llamada HTTP de reserva**. El primer tiempo mide desde que el motor detecta disponibilidad hasta que invoca el POST; el segundo mide cuánto tarda en resolverse la llamada al cliente HTTP del sitio. No se presenta ese segundo tiempo como latencia exclusiva del servidor ni se afirma que iniciar el POST garantice un asiento.

Tras un rechazo explícito de ubicación seguido de carrito vacío, se vuelve al programador de disponibilidad sin la espera adicional anterior de tres segundos. Se invalida el snapshot compartido de esa cuenta para no volver a consumir la misma disponibilidad anterior. El turno global de consultas y cualquier límite indicado por Boca siguen aplicándose. Una reserva incierta nunca habilita este reintento rápido.

## Lectura de filas de Boca

El lector reconoce Entrarás a la página web dentro de y también obtiene el tiempo directamente del campo de espera mostrado por Queue-it. Mantiene separado el contador de prefila de la espera para tu turno. Los enlaces de Boca para copiar usan c, e, t, cid y q, con el identificador observado de cada sesión al final. Un identificador vencido se marca como tal y no se ofrece como una posición disponible. Cambiar la forma del enlace no renueva su validez.

## Cierre individual en Filas

Cada tarjeta incluye Cerrar sesión. Cierra únicamente su contexto, conserva el resto y pausa la creación para que no se reemplace automáticamente. Los identificadores internos no se reutilizan. Si se cierra la última, también cierra Chrome y limpia los temporales de la ejecución. Filas muestra las tarjetas en todo el ancho y elimina la vista previa lateral. El cierre individual requiere cargar la versión nueva del proceso; actualizar solo la página aplica el diseño y deja el cierre deshabilitado si el proceso todavía no lo soporta.

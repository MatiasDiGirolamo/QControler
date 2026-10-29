QControler 1.2.0 - PRUEBA LOCAL Y PILOTO WEB REAL

INICIAR
Descomprimí todos los archivos juntos y ejecutá INICIAR.cmd. Requiere Chrome y Node.js. Reutiliza playwright-core del runtime de Codex o de node_modules local. Si falta: npm.cmd install --ignore-scripts.
Arranca con cero sesiones. No crea navegadores por cambiar el selector.

PROBAR U2
1. En Modo elegí Web real (hasta 3 sesiones).
2. El enlace oficial precargado es https://www.allaccess.com.ar/event/u2
3. Pulsá Guardar modo y enlace.
4. Elegí 2 en Total deseado y pulsá Aplicar cantidad.
La app abre cada página normalmente dentro de contextos aislados. No realiza compras, reservas, clics de verificación ni resuelve CAPTCHAs.
Si todavía no hay fila, muestra Sitio abierto, Sin identificador y Espera: sin dato. No crea identificadores por su cuenta. La página debe mostrar/abrir la prefila; si el acceso a fila aún no está publicado, se necesitará el enlace oficial actualizado o iniciar la prueba cuando esté habilitado. No se garantiza que una página cargada antes de la prefila se actualice sola.

URLS Y ESTADOS
Cada tarjeta muestra la URL actual. Cuando la página de Queue-it tiene un q UUID no vacío en la URL o un identificador visible reconocido, se muestra y habilita Copiar enlace de fila.
Un q distinto entre tarjetas solo confirma que se observaron identificadores diferentes. No garantiza posiciones definitivas ni entradas.
Los identificadores duplicados dentro del mismo evento se marcan. Solo se ordena por turno disponible o espera numérica explícita; valores como más de una hora no se convierten a números inventados.
La lectura de las páginas ocurre cada 5 segundos SIN recargar ni consultar endpoints internos de Queue-it. El sitio conserva sus propios mecanismos de actualización. La detección depende del idioma y diseño de la página; si no se reconoce, se deja sin dato.
La transferencia del enlace debe comprobarse en el evento. Conservá la sesión original. Las URLs de fila pueden dar acceso a tu posición: no las compartas públicamente.
Vista de sesión es una IMAGEN, no una vista interactiva. La app todavía no integra la extensión ni permite completar la compra dentro del contexto. No se presenta como sistema listo para garantizar entradas.

MEMORIA Y CIERRE
En prueba local permite hasta 50; en web real el piloto permite hasta 3. No crear más de lo que soporte la PC.
La creación se pausa si la RAM libre baja de 2 GB o del 20% del total (la reserva más alta), o CPU supera 75%. Las sesiones existentes siguen abiertas. Reanudar creación solo habilita futuras altas; no recarga ni reinicia las existentes.
Detener todo en modo real pide confirmar porque cierra las sesiones y puede perder posiciones. Después cierra Chrome y elimina solo la carpeta temporal exclusiva de esa ejecución. No borra perfiles de otros lanzadores. Ctrl+C usa el mismo cierre. Un cierre forzado o corte de luz puede dejar restos.
No cierres la consola mientras necesites conservar sesiones. No hay recuperación garantizada tras reiniciar. Este piloto todavía no sirve para completar una compra de extremo a extremo.

COMPROBACIONES
node --test tests/queue.test.mjs
node app.mjs --self-test
node app.mjs --cleanup-test
Las pruebas de identificadores y ranking usan datos ficticios explícitos en tests; no se confunden con posiciones reales.
El piloto real con U2 abrió dos contextos en la página oficial el 29/10/2026 antes de la prefila. En esa prueba no aparecieron q ni posiciones; no se validó una fila activa de U2.
export const VERSION='1.4.2';
export const SESSION_LIMIT=50;
export const DEFAULT_ENTRY='https://bocasocios.bocajuniors.com.ar/home';
export const attentionStates=['Requiere atención','Error de carga','Fila finalizada'];
export function resourceReason({freeBytes,reserveBytes,cpu}){
  if(freeBytes<reserveBytes)return 'RAM libre por debajo de la reserva. Las sesiones existentes siguen abiertas.';
  if(cpu>75)return 'CPU por encima del 75 %. Las sesiones existentes siguen abiertas.';
  return '';
}
export function selectedTarget(value){
  if(value==='auto')return SESSION_LIMIT;
  const n=Number(value);
  if(!Number.isInteger(n)||n<1||n>SESSION_LIMIT)throw new Error('Elegí Automático o un total entre 1 y '+SESSION_LIMIT+'.');
  return n;
}

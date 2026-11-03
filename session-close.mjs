export function sessionIds(){let next=1;return ()=>next++;}

export async function closeSession({sessions,id,closing=false,pause,waitForBatch,onEmpty,report}){
  const s=sessions.find(session=>session.id===id);
  if(!s)return {code:404,error:'La sesión ya no está abierta.'};
  if(closing||s.removing)return {code:409,error:'La sesión se está cerrando.'};
  s.removing=true;pause();
  try{
    await s.context.close();
    const index=sessions.indexOf(s);if(index!==-1)sessions.splice(index,1);
    await waitForBatch();
    if(!sessions.length)await onEmpty();
    else report('Sesión '+id+' cerrada. Se conservan las '+sessions.length+' restantes.');
    return {code:200,ok:true,count:sessions.length};
  }finally{s.removing=false;}
}

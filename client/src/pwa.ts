// PWA register + IndexedDB queue for offline inputs
export function registerSW(){ if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(()=>{}) }
const DB='ltown-queue', STORE='inputs'
function db():Promise<IDBDatabase>{ return new Promise((res,rej)=>{const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE,{autoIncrement:true}); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error)}) }
export async function queueInput(msg:any){ const d=await db(); const tx=d.transaction(STORE,'readwrite'); tx.objectStore(STORE).add({msg,ts:Date.now()}) }
export async function flushQueue(send:(m:any)=>void){
  const d=await db(); const tx=d.transaction(STORE,'readwrite'); const store=tx.objectStore(STORE); const req=store.getAll(); req.onsuccess=()=>{ for(const r of req.result) send(r.msg); store.clear() }
}
window.addEventListener('online',()=> flushQueue((m)=> (window as any)._ws?.send(JSON.stringify(m))))

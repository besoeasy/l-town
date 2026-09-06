// @ts-nocheck
// Atma Core crypto — ECDSA P-256 soul (lore.md:30) + NOSTR secp256k1 reuse
// Game state hash chain uses P-256 WebCrypto; NOSTR lobby reuses same Atma as secp256k1 via nostr-tools localStorage 'atma-sk' — soul = pubkey
// Pure browser — WebCrypto, IndexedDB persisted
const DB='atma', STORE='keys'
function db():Promise<IDBDatabase>{ return new Promise((res,rej)=>{ const r=indexedDB.open(DB,1); r.onupgradeneeded=()=>r.result.createObjectStore(STORE); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error) }) }
export async function genAtma(coreId:string){
  const kp=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},false,['sign','verify'])
  const pub=await crypto.subtle.exportKey('jwk',kp.publicKey)
  const priv=await crypto.subtle.exportKey('jwk',kp.privateKey)
  const d=await db(); const tx=d.transaction(STORE,'readwrite'); tx.objectStore(STORE).put({pub,priv,coreId},'atma'); return {kp,pub}
}
export async function loadAtma(){
  const d=await db(); return new Promise<any>((res,rej)=>{ const r=d.transaction(STORE).objectStore(STORE).get('atma'); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error) })
}
export async function sign(msg:Uint8Array, privJwk:any){
  const key=await crypto.subtle.importKey('jwk',privJwk,{name:'ECDSA',namedCurve:'P-256'},false,['sign'])
  const sig=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,msg as any)
  return new Uint8Array(sig)
}
export async function verify(msg:Uint8Array, sig:Uint8Array, pubJwk:any){
  const key=await crypto.subtle.importKey('jwk',pubJwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify'])
  return crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig as any,msg as any)
}
export async function hashState(prev:string, inputs:string){ const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(prev+inputs)); return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16) }
export function commit(input:string, nonce:string){ return hashState(input,nonce) } // commit-reveal

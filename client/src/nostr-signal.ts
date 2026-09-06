// @ts-nocheck
// NOSTR discovery only — game stays direct P2P (LAN ~1ms, clearnet ~30ms)
// Browser-safe: no Node Buffer — hex helpers instead.
import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'

function bytesToHex(b: Uint8Array): string { return [...b].map(x => x.toString(16).padStart(2, '0')).join('') }
function hexToBytes(h: string): Uint8Array {
  const s = h.startsWith('0x') ? h.slice(2) : h
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}

const RELAYS = ['wss://relay.damus.io','wss://nos.lol','wss://relay.primal.net']
const pool = new SimplePool()
const KIND_ROOM = 30303 // replaceable, d=l-town-<id>

let sk = localStorage.getItem('atma-sk')
if(!sk){ sk = bytesToHex(generateSecretKey()); localStorage.setItem('atma-sk', sk) }
const pk = getPublicKey(hexToBytes(sk))

export type Room = { id:string; name:string; seed:number; players:number; core:string; createdAt:number; pubkey:string }

export async function publishRoom(room: Room){
  const event = finalizeEvent({
    kind: KIND_ROOM,
    created_at: Math.floor(Date.now()/1000),
    tags: [['d', `l-town-${room.id}`], ['t','l-town'], ['name', room.name], ['seed', String(room.seed)]],
    content: JSON.stringify(room),
  }, hexToBytes(sk))
  await Promise.any(pool.publish(RELAYS, event))
  return event
}

export function subscribeRooms(onRoom:(r:Room, ev:any)=>void){
  const sub = pool.subscribeMany(RELAYS, [{ kinds:[KIND_ROOM], '#t':['l-town'], limit:50 }], {
    onevent(ev){
      try{ const r=JSON.parse(ev.content) as Room; r.pubkey=ev.pubkey; onRoom(r, ev) }catch{}
    }
  })
  return ()=> sub.close()
}

// SDP exchange via kind 4 encrypted DM (NIP-04) — discovery only, then P2P direct
import { nip04 } from 'nostr-tools'
export async function sendOffer(toPubkey:string, offer:any){
  const content = await nip04.encrypt(hexToBytes(sk), toPubkey, JSON.stringify(offer))
  const ev = finalizeEvent({ kind:4, created_at:Math.floor(Date.now()/1000), tags:[['p', toPubkey]], content }, hexToBytes(sk))
  await Promise.any(pool.publish(RELAYS, ev))
}
export function subscribeOffers(myPubkey:string, onOffer:(offer:any, from:string)=>void){
  const sub = pool.subscribeMany(RELAYS, [{ kinds:[4], '#p':[myPubkey] }], {
    async onevent(ev){
      try{
        const pt = await nip04.decrypt(hexToBytes(sk), ev.pubkey, ev.content)
        onOffer(JSON.parse(pt), ev.pubkey)
      }catch{}
    }
  })
  return ()=> sub.close()
}

export function getAtmaPubkey(){ return pk }

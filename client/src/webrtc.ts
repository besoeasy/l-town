// @ts-nocheck
// Pure browser mesh — WebRTC DataChannel host model, no server needed for LAN
// Host is first lobby peer (authoritative tick), others are clients. Crypto chain + commit-reveal.
import { hashState, commit } from '@l-town/shared/src/crypto.js'
import { encode, decode } from '@l-town/shared/src/protocol.js'

type Peer={pc:RTCPeerConnection, dc:RTCDataChannel|null, id:string}
const peers=new Map<string,Peer>()
let isHost=false, tick=0, prevHash='genesis', pendingCommits=new Map<number,string>()
let deterministicState:{players:any[]}={players:[]}

export async function createHost(onInput:(msg:any, from:string)=>void){
  isHost=true
  // Host tick — deterministic lockstep, 20Hz, hash chain
  setInterval(async()=>{
    tick++
    const stateStr=JSON.stringify(deterministicState)
    prevHash=await hashState(prevHash, stateStr)
    const msg={type:'tick', tick, prevHash, players:deterministicState.players}
    const data=encode(msg) as Uint8Array
    for(const p of peers.values()) if(p.dc?.readyState==='open') p.dc.send(data)
  },50)
  return { isHost }
}

export async function joinMesh(signalSend:(offer:any)=>void, onTick:(msg:any)=>void){
  const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]})
  const dc=pc.createDataChannel('game', {ordered:false, maxRetransmits:0}) // unreliable for inputs
  dc.onmessage = async (e: MessageEvent)=>{
    const msg=decode(e.data instanceof ArrayBuffer? new Uint8Array(e.data): e.data as any)
    if((msg as any).type==='tick'){
      const m=msg as any
      await hashState(m.prevHash? '' : prevHash, JSON.stringify(m.players))
      prevHash=m.prevHash; onTick(m)
    }
  }
  dc.onopen=()=> peers.set('host',{pc,dc,id:'host'})
  const offer=await pc.createOffer(); await pc.setLocalDescription(offer); signalSend(offer)
  // signal receive via QR / local ws — caller must call handleAnswer
  return { pc, dc }
}

export function sendInput(input:any, nonce:string){
  const c=commit(JSON.stringify(input), nonce)
  pendingCommits.set(tick, c)
  const msg={type:'input', commit:c, tick}
  const data=encode(msg) as Uint8Array
  // reveal next tick
  setTimeout(()=>{
    const reveal={type:'reveal', input, nonce, tick}
    const rdata=encode(reveal) as Uint8Array
    for(const p of peers.values()) if(p.dc?.readyState==='open') p.dc.send(rdata)
  },50)
  for(const p of peers.values()) if(p.dc?.readyState==='open') p.dc.send(data)
}

// QR signaling for pure offline LAN (no server) — encode offer as QR string
export function offerToQR(offer:RTCSessionDescriptionInit){ return btoa(JSON.stringify(offer)) }
export async function answerFromQR(qr:string, pc:RTCPeerConnection){ const offer=JSON.parse(atob(qr)); await pc.setRemoteDescription(offer); const ans=await pc.createAnswer(); await pc.setLocalDescription(ans); return btoa(JSON.stringify(ans)) }

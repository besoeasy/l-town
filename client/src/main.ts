import * as THREE from 'three'
import { CFG, CORE_IDS } from '@l-town/shared/src/cfg.js'
import { generateMap } from '@l-town/shared/src/map_pure.js'
import { initScene } from './scene.js'
import { registerSW } from './pwa.js'
import { createHost, joinMesh, offerToQR } from './webrtc.js'
import { publishRoom, subscribeRooms, subscribeOffers, sendOffer, getAtmaPubkey } from './nostr-signal.js'
import { spawnBots, tickBots } from './bot.js'
registerSW()

const coreSel=document.getElementById('coreSelect') as HTMLSelectElement
for(const c of CORE_IDS){ const o=document.createElement('option'); o.value=c; o.textContent=c; coreSel.appendChild(o) }

let myId:number|null=null, map:any=null, ws:WebSocket
const localPos={x:0,y:1.6,z:0}; let yaw=0, pitch=0, vy=0
let scene:any,camera:any,renderer:any, gameState:any

let mode:'solo'|'nostr'|'webrtc'='solo'
async function join(){
  const name=(document.getElementById('nameInput') as HTMLInputElement).value.trim()||'Anonymous'
  const character=coreSel.value||'telepotu'
  // Pure client solo fallback — no server needed (offline)
  if(mode==='solo'){
    const seed=Date.now()>>>0; map=generateMap(seed); const s=await initScene(document.getElementById('canvas') as HTMLCanvasElement, map); scene=s.scene; camera=s.camera; renderer=s.renderer
    myId=1; gameState={players:[{id:1,name,character,x:0,y:1.6,z:0,health:CFG.MAX_HEALTH,score:0,alive:true}], matchTime:600, playerCount:1}
    ;(document.getElementById('lobby') as any).style.display='none'
    const bots=spawnBots(7,map); gameState.players.push(...bots)
    setInterval(()=> tickBots(bots, localPos, 0.016), 50)
    document.body.requestPointerLock?.(); animate(); return
  }
  const proto=location.protocol==='https:'?'wss:':'ws:'
  const host=location.hostname==='localhost'?'localhost:30300':location.host
  ws=(window as any)._ws=new WebSocket(`${proto}//${host}`)
  ws.onmessage=(e)=>{
    const msg=JSON.parse(e.data)
    if(msg.type==='welcome'){ myId=msg.playerId; map=generateMap(msg.seed); initScene(document.getElementById('canvas') as HTMLCanvasElement, map).then(s=>{scene=s.scene;camera=s.camera;renderer=s.renderer; animate()}); (document.getElementById('lobby') as any).style.display='none'; document.body.requestPointerLock?.() }
    if(msg.type==='gameState'){ gameState=msg; updateHUD() }
    if(msg.type==='hit'){ (document.getElementById('hp') as any).animate([{transform:'scale(1)'},{transform:'scale(1.2)'}],{duration:100}) }
  }
  ws.onopen=()=> ws.send(JSON.stringify({type:'join',name,character}))
}
document.getElementById('joinBtn')!.addEventListener('click',()=>{mode='solo'; join()})

// NOSTR global lobby — discovery only, game P2P direct (LAN ~1ms, clearnet direct)
const roomListEl=document.getElementById('roomList') as any
let rooms:any[]=[]
function renderRooms(){
  // sort by ping (DataChannel RTT would be measured after connect — here sort by players then createdAt)
  rooms.sort((a,b)=> a.players-b.players || b.createdAt-a.createdAt)
  roomListEl.innerHTML=rooms.map((r:any)=>`<div style="display:flex;justify-content:space-between;border:1px solid #333;border-radius:6px;padding:4px 8px;margin:2px 0"><span>${r.name} — ${r.core} — ${r.players}/32</span><button data-id="${r.id}" class="joinRoom">JOIN</button></div>`).join('') || '<div style="opacity:.5">No rooms — CREATE one</div>'
  roomListEl.querySelectorAll('.joinRoom').forEach((btn:any)=> btn.addEventListener('click', async()=>{
    const id=btn.dataset.id; const room=rooms.find((x:any)=>x.id===id); if(!room) return
    mode='webrtc'; const {pc,dc}=await joinMesh((offer:any)=> sendOffer(room.pubkey, offer), (tick:any)=>{ gameState=tick; updateHUD() }); console.log('joining',room,pc,dc)
  }))
}
subscribeRooms((r:any)=>{ if(!rooms.find(x=>x.id===r.id)) rooms.push(r); renderRooms() })
document.getElementById('createBtn')!.addEventListener('click', async()=>{
  const name=(document.getElementById('nameInput') as HTMLInputElement).value.trim()||'Lobby-'+Math.floor(Math.random()*999)
  const core=coreSel.value||'telepotu'; const id=crypto.randomUUID().slice(0,6); const seed=Date.now()>>>0
  await publishRoom({id, name, seed, players:1, core, createdAt:Date.now(), pubkey:getAtmaPubkey()} as any)
  mode='nostr'; await createHost(()=>{}); alert('Room published to NOSTR relays — waiting for peers (P2P direct, LAN best ping)')
})
// QR LAN offline (no NOSTR, no server)
document.getElementById('qrBtn')!.addEventListener('click', async()=>{
  const {pc}=await joinMesh(async(offer:any)=>{ const qr=offerToQR(offer); const box=document.getElementById('qrBox') as any; box.style.display='block'; box.textContent=qr; console.log('QR offer',qr) }, ()=>{})
  console.log('QR host pc',pc)
})

// input — worker/off-thread ready
const keys:any={}; addEventListener('keydown',e=>keys[e.key.toLowerCase()]=true); addEventListener('keyup',e=>keys[e.key.toLowerCase()]=false)
addEventListener('mousemove',e=>{ if(document.pointerLockElement===document.body){ yaw-=e.movementX*0.0018; pitch=Math.max(-1.5,Math.min(1.5,pitch-e.movementY*0.0018)) } })
addEventListener('click',()=>{ if(gameState) ws?.send(JSON.stringify({type:'shoot'})) })

function updateHUD(){
  if(!gameState||myId==null) return
  const me=gameState.players.find((p:any)=>p.id===myId)
  if(me){ (document.getElementById('hp') as any).textContent=`HP ${Math.ceil(me.health)}`; (document.getElementById('score') as any).textContent=`Score ${me.score}` }
  const t=Math.max(0,gameState.matchTime); (document.getElementById('timer') as any).textContent=`${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`
}

function animate(){
  requestAnimationFrame(animate)
  if(!scene||!gameState||myId==null) return
  // simple prediction — server authoritative clone of v2/server physics
  const dt=0.016
  let mx=0,mz=0
  if(keys['w']) {mx-=Math.sin(yaw); mz-=Math.cos(yaw)}
  if(keys['s']) {mx+=Math.sin(yaw); mz+=Math.cos(yaw)}
  if(keys[' ']) { const can=localPos.y<=1.65; if(can) vy=CFG.JUMP_SPEED }
  const len=Math.hypot(mx,mz)
  if(len>0){ mx=(mx/len)*CFG.PLAYER_SPEED*dt; mz=(mz/len)*CFG.PLAYER_SPEED*dt; localPos.x+=mx; localPos.z+=mz; ws.send(JSON.stringify({type:'input',forward:!!keys['w'],back:!!keys['s'],left:!!keys['a'],right:!!keys['d'],yaw,pitch,dt})) }
  vy-=CFG.GRAVITY*dt; localPos.y+=vy*dt; if(localPos.y<=1.6){localPos.y=1.6; vy=0}
  camera.position.set(localPos.x, localPos.y+CFG.EYE_HEIGHT, localPos.z)
  camera.rotation.order='YXZ'; camera.rotation.y=yaw; camera.rotation.x=pitch
  renderer.render(scene,camera)
}

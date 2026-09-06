import * as THREE from 'three'
import { CFG, CORE_IDS } from '@l-town/shared/src/cfg.js'
import { generateMap } from '@l-town/shared/src/map.js'
import { initScene } from './scene.js'

const coreSel=document.getElementById('coreSelect') as HTMLSelectElement
for(const c of CORE_IDS){ const o=document.createElement('option'); o.value=c; o.textContent=c; coreSel.appendChild(o) }

let myId:number|null=null, map:any=null, ws:WebSocket
const localPos={x:0,y:1.6,z:0}; let yaw=0, pitch=0, vy=0
let scene:any,camera:any,renderer:any, gameState:any

async function join(){
  const name=(document.getElementById('nameInput') as HTMLInputElement).value.trim()||'Anonymous'
  const character=coreSel.value||'telepotu'
  const proto=location.protocol==='https:'?'wss:':'ws:'
  // v2 server serves same host, fallback to 30300
  const host=location.hostname==='localhost'?'localhost:30300':location.host
  ws=new WebSocket(`${proto}//${host}`)
  ws.onmessage=(e)=>{
    const msg=JSON.parse(e.data)
    if(msg.type==='welcome'){ myId=msg.playerId; map=generateMap(msg.seed); initScene(document.getElementById('canvas') as HTMLCanvasElement, map).then(s=>{scene=s.scene;camera=s.camera;renderer=s.renderer; animate()}); (document.getElementById('lobby') as any).style.display='none'; document.body.requestPointerLock?.() }
    if(msg.type==='gameState'){ gameState=msg; updateHUD() }
    if(msg.type==='hit'){ (document.getElementById('hp') as any).animate([{transform:'scale(1)'},{transform:'scale(1.2)'}],{duration:100}) }
  }
  ws.onopen=()=> ws.send(JSON.stringify({type:'join',name,character}))
}
document.getElementById('joinBtn')!.addEventListener('click',join)

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

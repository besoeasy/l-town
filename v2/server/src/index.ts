#!/usr/bin/env node
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import crypto from 'crypto'
import { WebSocketServer } from 'ws'
import { CFG, CORE_IDS } from '@l-town/shared/src/cfg.js'
import { makePRNG } from '@l-town/shared/src/utls.js'
import { createBoxGrid, resolveCollision } from './physics.js'
// reuse shared map gen (v1 copy)
import { generateMap } from '@l-town/shared/src/map.js'

const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename)
const _now=new Date()
const MAP_SEED=parseInt(`${String(_now.getDate()).padStart(2,'0')}${String(_now.getMonth()+1).padStart(2,'0')}${_now.getFullYear()}`,10)>>>0
const MAP=generateMap(MAP_SEED)
const { nearby } = createBoxGrid(MAP)

// state
const players=new Map<number, any>()
let nextId=1, matchActive=false, matchStart=0, matchTimer: NodeJS.Timeout|null=null
const RECONNECT_GRACE_MS=CFG.RECONNECT_GRACE_MS
const pending=new Map<string,{playerId:number,expiresAt:number,timeout:any}>()
function token(){ return crypto.randomUUID() } // v2: crypto vs Math.random

// per-IP rate limit
const ipCounts=new Map<string,{c:number,reset:number}>()
function checkIP(ip:string){ const now=Date.now(); let e=ipCounts.get(ip); if(!e||now>=e.reset){e={c:0,reset:now+60000}; ipCounts.set(ip,e)} e.c++; return e.c<=60 } // 60 joins/min

function randomSpawn(){ return { ...MAP.spawns[Math.floor(Math.random()*MAP.spawns.length)] } }
function makePlayer(id:number,name:string,character:string){
  const s=randomSpawn()
  return { id,name,character,x:s.x,y:s.y,z:s.z,yaw:0,pitch:0,health:CFG.MAX_HEALTH,superActive:false,superEnd:0,shieldActive:false,shieldEnd:0,score:0,alive:true,respawnAt:0,lastHitTime:0,crouching:false,lastMoveTime:Date.now(),vy:0,ws:null,lastShot:0,lastShieldAt:0,invisible:false,invisibleEnd:0,overdriveActive:false,overdriveEnd:0,bulwarkActive:false,bulwarkEnd:0,aegisActive:false,aegisEnd:0,leechActive:false,leechEnd:0,rageActive:false,rageEnd:0,lastAbilityAt:0,disconnectedAt:0}
}
function rayVsBox(ox:number,oy:number,oz:number,dx:number,dy:number,dz:number,box:any){
  const hx=box.w/2, hy=box.h/2, hz=box.d/2
  let tmin=-Infinity,tmax=Infinity
  for(const [o,d,c,h] of [[ox,dx,box.x,hx],[oy,dy,box.y,hy],[oz,dz,box.z,hz]] as const){
    if(Math.abs(d)<1e-9){ if(o<c-h||o>c+h) return Infinity } else {
      const t1=(c-h-o)/d, t2=(c+h-o)/d
      tmin=Math.max(tmin,Math.min(t1,t2)); tmax=Math.min(tmax,Math.max(t1,t2)); if(tmin>tmax) return Infinity
    }
  }
  if(tmax<0) return Infinity; return tmin>=0?tmin:0
}
function raycastPlayers(shooterId:number,ox:number,oy:number,oz:number,dx:number,dy:number,dz:number){
  let best:any=null
  for(const [id,p] of players){ if(id===shooterId||!p.alive) continue; const py=p.y+CFG.PLAYER_HEIGHT*0.5; const cx=p.x-ox,cy=py-oy,cz=p.z-oz; const t=cx*dx+cy*dy+cz*dz; if(t<0||t>120) continue; const ex=ox+t*dx-p.x, ey=oy+t*dy-py, ez=oz+t*dz-p.z; const r2=ex*ex+ey*ey*0.4+ez*ez; if(r2<0.36&&(!best||t<best.t)) best={id,t} }
  if(best) for(const box of MAP.boxes){ const bt=rayVsBox(ox,oy,oz,dx,dy,dz,box); if(bt<best.t-0.1){best=null;break} }
  return best
}
function applyDamage(targetId:number,dmg:number,shooterId:number){
  const p=players.get(targetId); if(!p||!p.alive) return
  if(p.shieldActive&&Date.now()<p.shieldEnd) return
  if(p.aegisActive&&Date.now()<p.aegisEnd) return
  if(p.bulwarkActive&&Date.now()<p.bulwarkEnd) dmg*=0.5
  p.lastHitTime=Date.now(); p.health-=dmg
  if(p.ws?.readyState===1) p.ws.send(JSON.stringify({type:'hit',amount:Math.round(dmg)}))
  const shooter=players.get(shooterId); if(shooter?.ws?.readyState===1) shooter.ws.send(JSON.stringify({type:'hitConfirm',amount:Math.round(dmg),targetName:p.name,killed:p.health<=0}))
  if(p.health<=0){ p.health=0; p.alive=false; p.respawnAt=Date.now()+CFG.RESPAWN_DELAY; if(shooter){shooter.score++; shooter.health=Math.min(CFG.MAX_HEALTH,shooter.health+CFG.KILL_BONUS_HP)} broadcast({type:'kill',shooterId,targetId,shooterName:shooter?.name??'?',targetName:p.name}); if(p.character==='jinx'&&shooter&&shooter.alive&&shooter.id!==p.id){ shooter.health-=80; shooter.lastHitTime=Date.now(); if(shooter.ws?.readyState===1) shooter.ws.send(JSON.stringify({type:'jinxCurse',amount:80,fromName:p.name})); if(shooter.health<=0){shooter.health=0; shooter.alive=false; shooter.respawnAt=Date.now()+CFG.RESPAWN_DELAY; broadcast({type:'kill',shooterId:p.id,targetId:shooter.id,shooterName:p.name+' ☠️',targetName:shooter.name})} } }
}
function fireRay(player:any){
  const mult=player.superActive?CFG.SUPER_MULT:1; const yaw=player.yaw,pitch=player.pitch
  const dx=-Math.cos(pitch)*Math.sin(yaw), dy=Math.sin(pitch), dz=-Math.cos(pitch)*Math.cos(yaw)
  const ox=player.x, oy=player.y+CFG.EYE_HEIGHT, oz=player.z
  const hit=raycastPlayers(player.id,ox,oy,oz,dx,dy,dz)
  if(hit){ const distMult=Math.max(0.25,1-hit.t/160); const rageMult=(player.character==='berserker'&&player.rageActive&&Date.now()<player.rageEnd)?1.5:1; applyDamage(hit.id,CFG.DMG_SINGLE*mult*distMult*rageMult,player.id) }
}
function startMatch(){ matchActive=true; matchStart=Date.now(); if(matchTimer) clearTimeout(matchTimer); matchTimer=setTimeout(endMatch,CFG.MATCH_DURATION*1000); broadcast({type:'matchStart'}) }
function endMatch(){ matchActive=false; if(matchTimer) clearTimeout(matchTimer); const ranked=[...players.values()].sort((a,b)=>b.score-a.score); const winners=ranked.slice(0,3).map(p=>({id:p.id,name:p.name,score:p.score})); broadcast({type:'matchEnd',winners}) }

// tick — ECS + physics + interest cull
let lastTick=Date.now()
setInterval(()=>{
  const now=Date.now(), dt=(now-lastTick)/1000; lastTick=now; if(!matchActive) return
  for(const p of players.values()){
    const holding=!p.ws&&p.disconnectedAt>0
    if(!p.alive){ if(p.respawnAt>0&&now>=p.respawnAt){ const s=randomSpawn(); Object.assign(p,{x:s.x,y:s.y,z:s.z,health:Math.floor(CFG.MAX_HEALTH*0.75),superActive:false,superEnd:0,shieldActive:false,shieldEnd:0,invisible:false,invisibleEnd:0,overdriveActive:false,overdriveEnd:0,bulwarkActive:false,bulwarkEnd:0,aegisActive:false,aegisEnd:0,leechActive:false,leechEnd:0,rageActive:false,rageEnd:0,crouching:false,lastMoveTime:Date.now(),vy:0,alive:true,respawnAt:0}) } continue }
    const prevY=p.y; p.vy-=CFG.GRAVITY*dt; p.y+=p.vy*dt
    if(p.vy<=0){ for(const box of nearby(p.x,p.z)){ const bTop=box.y+box.h/2, hw=box.w/2+CFG.PLAYER_RADIUS, hd=box.d/2+CFG.PLAYER_RADIUS; if(prevY>=bTop-0.05&&p.y<=bTop&&Math.abs(p.x-box.x)<hw&&Math.abs(p.z-box.z)<hd){p.y=bTop; p.vy=0; break} } }
    if(p.y<=1.6){p.y=1.6; p.vy=0}
    if(!holding&&now-p.lastHitTime>CFG.REGEN_DELAY){ const rate=(p.crouching?3:1)*dt; if(p.health<CFG.MAX_HEALTH) p.health=Math.min(CFG.MAX_HEALTH,p.health+rate) }
    if(!p.crouching&&(now-p.lastMoveTime)>=CFG.AUTO_CROUCH_MS) p.crouching=true
    if(p.superActive&&now>p.superEnd) p.superActive=false
    if(p.shieldActive&&now>p.shieldEnd) p.shieldActive=false
    if(p.invisible&&now>p.invisibleEnd) p.invisible=false
    if(p.overdriveActive&&now>p.overdriveEnd) p.overdriveActive=false
    if(p.bulwarkActive&&now>p.bulwarkEnd) p.bulwarkActive=false
    if(p.aegisActive&&now>p.aegisEnd) p.aegisActive=false
    if(p.leechActive&&now>p.leechEnd) p.leechActive=false
    if(p.rageActive&&now>p.rageEnd) p.rageActive=false
    if(!holding&&p.leechActive&&p.alive&&now<p.leechEnd){
      for(const [oid,other] of players){ if(oid===p.id||!other.alive) continue; const dx=other.x-p.x, dz=other.z-p.z; if(Math.sqrt(dx*dx+dz*dz)<15){ const drain=8*dt; other.health-=drain; other.lastHitTime=now; p.health=Math.min(p.health+drain,CFG.MAX_HEALTH); if(other.health<=0){other.health=0; other.alive=false; other.respawnAt=now+CFG.RESPAWN_DELAY; p.score++; p.health=Math.min(CFG.MAX_HEALTH,p.health+CFG.KILL_BONUS_HP); broadcast({type:'kill',shooterId:p.id,targetId:oid,shooterName:p.name,targetName:other.name})} } }
    }
  }
  const all=[...players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,health:p.health,superActive:p.superActive,superEnd:p.superEnd,shieldActive:p.shieldActive,shieldEnd:p.shieldEnd,score:p.score,alive:p.alive,respawnAt:p.respawnAt,crouching:p.crouching,character:p.character,invisible:p.invisible,lastAbilityAt:p.lastAbilityAt}))
  const aliveCount=all.reduce((n,p)=>n+(p.alive?1:0),0)
  const hvtId=(()=>{ const alive=all.filter(p=>p.alive); if(alive.length<2) return null; return alive.reduce((b,p)=>p.score>b.score?p:b,alive[0]).id })()
  const leaderboard=[...players.values()].sort((a,b)=>b.score-a.score).slice(0,3).map(p=>({id:p.id,name:p.name,score:p.score}))
  const matchTime=Math.max(0,CFG.MATCH_DURATION-(now-matchStart)/1000)
  // interest cull — from scratch, 120u + HVT + self, skip cloaked
  const R2=CFG.VIS_RADIUS*CFG.VIS_RADIUS
  for(const p of players.values()){
    if(!p.ws||p.ws.readyState!==1) continue
    const vis=[]; for(const op of all){ if(op.id===p.id){vis.push(op);continue} if(op.invisible) continue; if(op.id===hvtId){vis.push(op);continue} if(!op.alive) continue; const dx=op.x-p.x, dz=op.z-p.z; if(dx*dx+dz*dz<=R2) vis.push(op) }
    p.ws.send(JSON.stringify({type:'gameState',matchTime,playerCount:players.size,aliveCount,maxPlayers:CFG.MAX_PLAYERS,highValueTargetId:hvtId,leaderboard,players:vis}))
  }
},CFG.TICK_MS)

// http — serve client/dist if built, else public fallback
const MIME:any={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png'}
function serveFile(res:any,filePath:string){
  const root=path.resolve(__dirname,'../../'); if(!path.resolve(filePath).startsWith(root)) {res.writeHead(403); return res.end('Forbidden')}
  fs.readFile(filePath,(err,data)=>{ if(err){res.writeHead(404); return res.end('Not Found')} const ext=path.extname(filePath); res.writeHead(200,{'Content-Type':MIME[ext]??'application/octet-stream','Cache-Control':ext==='.html'?'no-cache':'public, max-age=3600'}); res.end(data) })
}
function handleReq(req:any,res:any){
  let url=req.url.split('?')[0]
  if(url.startsWith('/three/')) return serveFile(res,path.join(__dirname,'../../node_modules/three',url.slice(7)))
  if(url==='/'||url==='') url='/index.html'
  // try v2 client/dist first, then v1 public
  const v2File=path.join(__dirname,'../../client/dist',url)
  if(fs.existsSync(v2File)) return serveFile(res,v2File)
  serveFile(res,path.join(__dirname,'../../public',url))
}
const server=http.createServer(handleReq)
const wss=new WebSocketServer({server,maxPayload:4096})
function broadcast(msg:any){ const d=JSON.stringify(msg); for(const c of wss.clients) if((c as any).readyState===1) (c as any).send(d) }
wss.on('connection',(ws:any,req:any)=>{
  const ip=req.socket.remoteAddress||'unknown'
  if(!checkIP(ip)) { ws.close(); return }
  if(wss.clients.size>CFG.MAX_PLAYERS+20){ ws.close(); return }
  const id=nextId++; let joined=false, player:any=null
  const joinTimer=setTimeout(()=>{if(!joined) ws.close()},8000)
  const pingTimer=setInterval(()=>{ if(ws.readyState===1) try{ws.ping()}catch{} },30000)
  ws.on('close',()=>{ clearInterval(pingTimer); clearTimeout(joinTimer) })
  ws.on('message',(raw:any)=>{
    const now=Date.now(); if(!(ws as any)._msgsReset||now>=(ws as any)._msgsReset){(ws as any)._msgs=0;(ws as any)._msgsReset=now+1000} if(++(ws as any)._msgs>120) return
    let msg:any; try{msg=JSON.parse(raw.toString())}catch{return}
    if(msg.type==='join'&&!joined){
      if(players.size>=CFG.MAX_PLAYERS){ ws.send(JSON.stringify({type:'error',reason:'Server full'})); return ws.close() }
      const name=String(msg.name??`Player${id}`).slice(0,20).replace(/[<>&"']/g,'')
      const character=CORE_IDS.includes(msg.character)?msg.character:'telepotu'
      player=makePlayer(id,name,character); player.ws=ws; players.set(id,player); joined=true; clearTimeout(joinTimer); if(!matchActive) startMatch()
      const tk=token(); pending.set(tk,{playerId:id,expiresAt:0,timeout:null})
      ws.send(JSON.stringify({type:'welcome',playerId:id,seed:MAP_SEED,cfg:CFG,reconnectToken:tk,graceMs:RECONNECT_GRACE_MS})); return
    }
    if(msg.type==='rejoin'&&!joined){
      const entry=pending.get(String(msg.token??'')); if(!entry){ ws.send(JSON.stringify({type:'error',reason:'Reconnect expired'})); return ws.close() }
      const existing=players.get(entry.playerId); if(!existing){ pending.delete(String(msg.token??'')); ws.send(JSON.stringify({type:'error',reason:'Reconnect expired'})); return ws.close() }
      clearTimeout(entry.timeout); pending.delete(String(msg.token??'')); player=existing; player.ws=ws; player.disconnectedAt=0; joined=true; clearTimeout(joinTimer)
      const tk=token(); pending.set(tk,{playerId:player.id,expiresAt:0,timeout:null})
      ws.send(JSON.stringify({type:'welcome',playerId:player.id,seed:MAP_SEED,cfg:CFG,reconnectToken:tk,graceMs:RECONNECT_GRACE_MS,rejoined:true,x:player.x,y:player.y,z:player.z})); return
    }
    if(!joined||!player) return
    if(msg.type==='input'){
      if(!player.alive||!matchActive) return
      const dt=Math.max(0,Math.min(0.1,msg.dt??0.05))
      const yaw=typeof msg.yaw==='number'&&isFinite(msg.yaw)?msg.yaw:player.yaw
      const pit=typeof msg.pitch==='number'&&isFinite(msg.pitch)?msg.pitch:player.pitch
      player.yaw=yaw; player.pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,pit))
      let mx=0,mz=0
      if(msg.forward) {mx-=Math.sin(yaw); mz-=Math.cos(yaw)}
      if(msg.back) {mx+=Math.sin(yaw); mz+=Math.cos(yaw)}
      if(msg.left) {mx+=Math.sin(yaw-Math.PI/2); mz+=Math.cos(yaw-Math.PI/2)}
      if(msg.right) {mx+=Math.sin(yaw+Math.PI/2); mz+=Math.cos(yaw+Math.PI/2)}
      const len=Math.sqrt(mx*mx+mz*mz)
      const inAir=player.y>1.65&&!nearby(player.x,player.z).some((box:any)=>{const bTop=box.y+box.h/2; return Math.abs(player.y-bTop)<0.15&&Math.abs(player.x-box.x)<box.w/2+CFG.PLAYER_RADIUS&&Math.abs(player.z-box.z)<box.d/2+CFG.PLAYER_RADIUS})
      const superMult=player.superActive?1.5:1, airMult=inAir?1.2:1
      const denjaMult=player.overdriveActive&&Date.now()<player.overdriveEnd?2:1
      const berserkMult=(player.character==='berserker'&&player.rageActive&&Date.now()<player.rageEnd)?1.25:1
      const speed=(player.crouching?CFG.CROUCH_SPEED:msg.run?CFG.RUN_SPEED:CFG.PLAYER_SPEED)*superMult*airMult*denjaMult*berserkMult
      if(len>0){
        mx=(mx/len)*speed*dt; mz=(mz/len)*speed*dt
        const maxSpeed=CFG.RUN_SPEED*1.5*1.2*2*1.25, maxDist=maxSpeed*dt+1e-6; const dist=Math.hypot(mx,mz); if(dist>maxDist){const s=maxDist/dist; mx*=s; mz*=s}
        player.lastMoveTime=Date.now(); player.crouching=false
      }
      const r=resolveCollision(player.x+mx,player.y,player.z+mz,MAP,nearby); player.x=r.x; player.y=r.y; player.z=r.z; return
    }
    if(msg.type==='shoot'){ if(!player.alive||player.invisible||(player.shieldActive&&Date.now()<player.shieldEnd)) return; const now2=Date.now(); if(now2-player.lastShot<80) return; player.lastShot=now2; if(player.health<=CFG.SHOT_COST_SINGLE) return; player.health-=CFG.SHOT_COST_SINGLE; player.lastHitTime=now2; const mult=player.superActive?CFG.SUPER_MULT:1; const yaw=player.yaw,pitch=player.pitch; const dx=-Math.cos(pitch)*Math.sin(yaw), dy=Math.sin(pitch), dz=-Math.cos(pitch)*Math.cos(yaw); const ox=player.x, oy=player.y+CFG.EYE_HEIGHT, oz=player.z; const hit=raycastPlayers(player.id,ox,oy,oz,dx,dy,dz); if(hit){const distMult=Math.max(0.25,1-hit.t/160); const rageMult=(player.character==='berserker'&&player.rageActive&&Date.now()<player.rageEnd)?1.5:1; applyDamage(hit.id,CFG.DMG_SINGLE*mult*distMult*rageMult,player.id)} return }
    if(msg.type==='chargedShoot'){ /* simplified: treat as N single shots */ const count=Math.min(Math.max(1,msg.count|0),CFG.CHARGE_MAX); for(let i=0;i<count;i++) { if(player.health<=CFG.SHOT_COST_SINGLE) break; player.health-=CFG.SHOT_COST_SINGLE; const yaw=player.yaw,pitch=player.pitch; const dx=-Math.cos(pitch)*Math.sin(yaw), dy=Math.sin(pitch), dz=-Math.cos(pitch)*Math.cos(yaw); const hit=raycastPlayers(player.id,player.x,player.y+CFG.EYE_HEIGHT,player.z,dx,dy,dz); if(hit) applyDamage(hit.id,CFG.DMG_SINGLE*(player.superActive?CFG.SUPER_MULT:1)*Math.max(0.25,1-hit.t/160),player.id) } return }
    if(msg.type==='reload') return
    if(msg.type==='crouch'){ if(player.alive){player.crouching=!!msg.state; if(!player.crouching) player.lastMoveTime=Date.now()} return }
    if(msg.type==='jump'){ const can=player.y<=1.65||nearby(player.x,player.z).some((b:any)=>{const t=b.y+b.h/2; return Math.abs(player.y-t)<0.15&&Math.abs(player.x-b.x)<b.w/2+CFG.PLAYER_RADIUS&&Math.abs(player.z-b.z)<b.d/2+CFG.PLAYER_RADIUS}); if(player.alive&&can&&!player.crouching) player.vy=CFG.JUMP_SPEED; return }
    if(msg.type==='jump_super'){ const can=player.y<=1.65||nearby(player.x,player.z).some((b:any)=>{const t=b.y+b.h/2; return Math.abs(player.y-t)<0.15&&Math.abs(player.x-b.x)<b.w/2+CFG.PLAYER_RADIUS&&Math.abs(player.z-b.z)<b.d/2+CFG.PLAYER_RADIUS}); if(player.alive&&can&&!player.crouching&&player.health>CFG.SUPER_JUMP_COST){player.health-=CFG.SUPER_JUMP_COST; player.lastHitTime=Date.now(); player.vy=CFG.SUPER_JUMP_SPEED} return }
    if(msg.type==='super'){ if(player.alive&&!player.superActive&&player.health>=CFG.SUPER_COST+1){player.health-=CFG.SUPER_COST; player.superActive=true; player.superEnd=Date.now()+CFG.SUPER_DURATION} return }
    if(msg.type==='shield'){ const n=Date.now(); if(player.alive&&!player.shieldActive&&player.health>=CFG.SHIELD_COST+1&&n-player.lastShieldAt>=15000){player.lastShieldAt=n; player.health-=CFG.SHIELD_COST; player.shieldActive=true; player.shieldEnd=Date.now()+CFG.SHIELD_DURATION; player.lastHitTime=Date.now()} return }
    if(msg.type==='classAbility'){
      const n=Date.now(); if(!player.alive||!matchActive) return
      if(player.character==='telepotu'){ if(n-player.lastAbilityAt<60000) return; player.lastAbilityAt=n; const cand=[...players.values()].filter(p=>p.alive&&p.id!==player.id); if(!cand.length) return; const t=cand[Math.floor(Math.random()*cand.length)]; const tmp={x:player.x,y:player.y,z:player.z}; player.x=t.x; player.y=t.y; player.z=t.z; t.x=tmp.x; t.y=tmp.y; t.z=tmp.z; if(player.ws?.readyState===1) player.ws.send(JSON.stringify({type:'teleported',x:player.x,y:player.y,z:player.z,targetName:t.name})); if(t.ws?.readyState===1) t.ws.send(JSON.stringify({type:'teleported',x:t.x,y:t.y,z:t.z,targetName:player.name})) }
      else if(player.character==='chumantr'){ if(n-player.lastAbilityAt<30000) return; player.lastAbilityAt=n; player.invisible=true; player.invisibleEnd=n+10000 }
      else if(player.character==='mednix'){ if(n-player.lastAbilityAt<20000) return; player.lastAbilityAt=n; player.health=Math.min(player.health+Math.floor(Math.random()*50)+1,CFG.MAX_HEALTH) }
      else if(player.character==='denja'){ if(n-player.lastAbilityAt<30000) return; player.lastAbilityAt=n; player.overdriveActive=true; player.overdriveEnd=n+8000 }
      else if(player.character==='tank'){ if(n-player.lastAbilityAt<35000) return; player.lastAbilityAt=n; player.bulwarkActive=true; player.bulwarkEnd=n+8000 }
      else if(player.character==='anchor'){ if(n-player.lastAbilityAt<40000) return; player.lastAbilityAt=n; player.aegisActive=true; player.aegisEnd=n+3000 }
      else if(player.character==='surge'){ if(n-player.lastAbilityAt<25000) return; let nearest=null,dist=Infinity; for(const [id,p] of players){ if(id===player.id||!p.alive) continue; const d=Math.hypot(p.x-player.x,p.z-player.z); if(d<40&&d<dist){nearest=p;dist=d}} if(!nearest) return; player.lastAbilityAt=n; const drain=Math.min(30,nearest.health-1); nearest.health-=drain; nearest.lastHitTime=n; player.health=Math.min(player.health+drain,CFG.MAX_HEALTH); if(nearest.ws?.readyState===1) nearest.ws.send(JSON.stringify({type:'hit'})); if(player.ws?.readyState===1) player.ws.send(JSON.stringify({type:'surgeDrain',amount:drain,targetName:nearest.name})) }
      else if(player.character==='gambler'){ if(n-player.lastAbilityAt<45000) return; player.lastAbilityAt=n; const r=Math.random(); if(r<0.333){player.health=Math.min(player.health+200,CFG.MAX_HEALTH); if(player.ws?.readyState===1) player.ws.send(JSON.stringify({type:'gamblerResult',result:'heal',amount:200}))} else if(r<0.666){ const alive=[...players.values()].filter(p=>p.alive&&p.id!==player.id); if(alive.length){const t=alive[Math.floor(Math.random()*alive.length)]; player.x=t.x; player.y=t.y; player.z=t.z; if(player.ws?.readyState===1) player.ws.send(JSON.stringify({type:'gamblerResult',result:'teleport',x:player.x,y:player.y,z:player.z,targetName:t.name}))}} else {player.health=0; player.alive=false; player.respawnAt=n+CFG.RESPAWN_DELAY; if(player.ws?.readyState===1) player.ws.send(JSON.stringify({type:'gamblerResult',result:'death'})); broadcast({type:'kill',shooterId:player.id,targetId:player.id,shooterName:'🎲 GAMBLE',targetName:player.name})} }
      else if(player.character==='parasite'){ if(n-player.lastAbilityAt<30000) return; player.lastAbilityAt=n; player.leechActive=true; player.leechEnd=n+6000 }
      else if(player.character==='berserker'){ if(n-player.lastAbilityAt<35000) return; player.lastAbilityAt=n; player.rageActive=true; player.rageEnd=n+8000 }
      return
    }
    if(msg.type==='ping'){ ws.send(JSON.stringify({type:'pong',ts:msg.ts})); return }
    if(msg.type==='chat'){ const text=String(msg.text??'').slice(0,120).replace(/[<>&"']/g,c=>({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' } as any)[c]); if(!text) return; const now3=Date.now(); if(now3-(player.lastChatAt??0)<500) return; player.lastChatAt=now3; broadcast({type:'chatMsg',name:player.name,text}); return }
  })
  ws.on('close',()=>{
    clearTimeout(joinTimer); clearInterval(pingTimer)
    if(joined&&player&&players.has(player.id)){
      player.ws=null; player.disconnectedAt=Date.now()
      for(const [tok,entry] of pending){ if(entry.playerId===player.id&&!entry.timeout){ entry.expiresAt=Date.now()+RECONNECT_GRACE_MS; entry.timeout=setTimeout(()=>{ pending.delete(tok); players.delete(player.id); if(players.size===0&&matchActive){ if(matchTimer) clearTimeout(matchTimer); matchActive=false } },RECONNECT_GRACE_MS); break } }
    } else { players.delete(id); if(players.size===0&&matchActive){ if(matchTimer) clearTimeout(matchTimer); matchActive=false } }
  })
  ws.on('error',()=>{})
})
const PORT=process.env.PORT??30300
server.listen(PORT,'0.0.0.0',()=>console.log(`L-Town v2 running → http://0.0.0.0:${PORT} (seed ${MAP_SEED})`))
// graceful
process.on('SIGTERM',()=>{ if(matchTimer) clearTimeout(matchTimer); wss.close(); server.close(()=>process.exit(0)) })

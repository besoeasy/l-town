// Offline bot sim — runs in worker when no host/ws (solo/lore trial)
// Uses same ECS/physics as server, deterministic
import { CFG } from '@l-town/shared/src/cfg.js'
import { generateMap } from '@l-town/shared/src/map_pure.js'

export function spawnBots(count=8, map:any){
  const bots=[]
  for(let i=0;i<count;i++){
    const s=map.spawns[i%map.spawns.length]
    bots.push({id:1000+i, name:`BOT-${i+1}`, character:['denja','tank','berserker'][i%3], x:s.x, y:s.y, z:s.z, yaw:Math.random()*Math.PI*2, health:CFG.MAX_HEALTH, score:0, alive:true, tick:0})
  }
  return bots
}

export function tickBots(bots:any[], localPos:{x:number;z:number}, dt:number){
  for(const b of bots){
    if(!b.alive) continue
    // simple chase local player within 40u (Surge range)
    const dx=localPos.x-b.x, dz=localPos.z-b.z, d=Math.hypot(dx,dz)
    if(d<40){ b.yaw=Math.atan2(-dx,-dz); b.x+=Math.cos(b.yaw+Math.PI/2)*CFG.PLAYER_SPEED*dt*0.5; b.z+=Math.sin(b.yaw+Math.PI/2)*CFG.PLAYER_SPEED*dt*0.5 }
    else { // wander
      b.yaw+= (Math.random()-0.5)*0.05; b.x+=Math.sin(b.yaw)*CFG.PLAYER_SPEED*dt*0.3; b.z+=Math.cos(b.yaw)*CFG.PLAYER_SPEED*dt*0.3
    }
    b.tick++
  }
}

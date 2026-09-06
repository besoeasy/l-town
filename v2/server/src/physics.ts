// Physics — server authoritative sweep AABB, rapier-ready interface
// v2 scratch: grid + sweep, rapier would replace resolveCollision with RAPIER.World step
import { CFG } from '@l-town/shared/src/cfg.js'
export function createBoxGrid(MAP:any, BOX_CELL=20) {
  const grid = new Map()
  for (const box of MAP.boxes) {
    const x0=Math.floor((box.x-box.w/2-1)/BOX_CELL), x1=Math.floor((box.x+box.w/2+1)/BOX_CELL)
    const z0=Math.floor((box.z-box.d/2-1)/BOX_CELL), z1=Math.floor((box.z+box.d/2+1)/BOX_CELL)
    for(let gx=x0;gx<=x1;gx++) for(let gz=z0;gz<=z1;gz++){
      const k=(gx+200)*1000+(gz+200); let arr=grid.get(k); if(!arr){arr=[];grid.set(k,arr)} arr.push(box)
    }
  }
  return { grid, nearby:(x:number,z:number)=>{
    const cx=Math.floor(x/BOX_CELL), cz=Math.floor(z/BOX_CELL); const seen=new Set(), out:any[]=[]
    for(let gx=cx-1;gx<=cx+1;gx++) for(let gz=cz-1;gz<=cz+1;gz++){
      const arr=grid.get((gx+200)*1000+(gz+200)); if(!arr) continue
      for(const b of arr) if(!seen.has(b)){seen.add(b); out.push(b)}
    }
    return out
  }}
}
export function resolveCollision(x:number,y:number,z:number, MAP:any, nearby:(x:number,z:number)=>any[]) {
  const bound=MAP.floor.w/2-0.5
  x=Math.max(-bound,Math.min(bound,x)); z=Math.max(-bound,Math.min(bound,z))
  const boxes=nearby(x,z)
  for(let pass=0;pass<3;pass++) for(const box of boxes){
    const hw=box.w/2+CFG.PLAYER_RADIUS, hd=box.d/2+CFG.PLAYER_RADIUS
    const bTop=box.y+box.h/2, bBot=box.y-box.h/2
    if(y<bTop&&y>bBot&&Math.abs(x-box.x)<hw&&Math.abs(z-box.z)<hd){
      const dxP=(box.x+hw)-x, dxN=x-(box.x-hw), dzP=(box.z+hd)-z, dzN=z-(box.z-hd)
      const mn=Math.min(dxP,dxN,dzP,dzN)
      if(mn===dxP) x=box.x+hw; else if(mn===dxN) x=box.x-hw; else if(mn===dzP) z=box.z+hd; else z=box.z-hd
    }
  }
  return {x,y,z}
}

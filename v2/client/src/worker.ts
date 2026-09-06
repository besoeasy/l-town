// Worker — off-main-thread tick (rapier stub, v2 scratch)
// Main thread posts {x,y,z,boxes}, worker does sweep + returns pos. Keeps 60fps render free.
import { CFG } from '@l-town/shared/src/cfg.js'
self.onmessage = (e: MessageEvent)=>{
  const { x, y, z, vy, dt } = e.data as any
  let ny = y + (vy - CFG.GRAVITY*dt)*dt // simplified, full sweep lives in server physics.ts
  postMessage({ type:'tick', y: ny })
}

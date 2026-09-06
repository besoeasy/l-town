import * as THREE from 'three'
import { generateMap, buildMap as buildMapV1 } from '@l-town/shared/src/map.js'
// v2: InstancedMesh from scratch (no per-box Mesh)
export async function initScene(canvas: HTMLCanvasElement, map:any){
  const scene=new THREE.Scene()
  scene.fog=new THREE.FogExp2(0x7ab0d0,0.00055)
  const camera=new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.05, 1800)
  const renderer=new THREE.WebGLRenderer({canvas, antialias:true})
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5))
  renderer.setSize(innerWidth,innerHeight)
  renderer.shadowMap.enabled=true
  // lights — lore: Helios storms, afternoon sun
  const hemi=new THREE.HemisphereLight(0xadd0e8,0x3a5820,0.4); scene.add(hemi)
  const sun=new THREE.DirectionalLight(0xfff5e8,0.7); sun.position.set(120,200,80); sun.castShadow=true; scene.add(sun)
  // map — instanced (v2 day1)
  buildMapV1(scene, map)
  return {scene,camera,renderer}
}

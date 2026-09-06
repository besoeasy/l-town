import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { buildMap as buildMapV1 } from '@l-town/shared/src/map.js'

// v2 scene — v1-quality visuals: sky, sun, bloom, planet, clouds, shadows
export async function initScene(canvas: HTMLCanvasElement, map: any) {
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x7ab0d0, 0.00055)

  const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1800)

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5))
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 0.85
  renderer.outputColorSpace = THREE.SRGBColorSpace

  // Procedural sky (Preetham)
  const sky = new Sky()
  sky.scale.setScalar(10000)
  scene.add(sky)
  const skyU: any = (sky.material as any).uniforms
  skyU['turbidity'].value = 8
  skyU['rayleigh'].value = 2.5
  skyU['mieCoefficient'].value = 0.005
  skyU['mieDirectionalG'].value = 0.82
  const sunDir = new THREE.Vector3()
  sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(85), THREE.MathUtils.degToRad(220))
  skyU['sunPosition'].value.copy(sunDir)

  const hemi = new THREE.HemisphereLight(0xadd0e8, 0x3a5820, 0.4)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff5e8, 0.7)
  sun.position.copy(sunDir).multiplyScalar(120)
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.bias = -0.0002
  sun.shadow.camera.near = 0.5
  sun.shadow.camera.far = 900
  sun.shadow.camera.left = sun.shadow.camera.bottom = -450
  sun.shadow.camera.right = sun.shadow.camera.top = 450
  scene.add(sun)

  const rim = new THREE.DirectionalLight(0x88b4d8, 0.15)
  rim.position.set(-60, 40, 60)
  scene.add(rim)

  // Boreas planet (fog-immune)
  const planet = new THREE.Mesh(
    new THREE.SphereGeometry(70, 24, 24),
    new THREE.MeshLambertMaterial({ color: 0x5a1a8a, fog: false })
  )
  planet.position.set(-240, 130, -400)
  scene.add(planet)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(84, 6, 6, 48),
    new THREE.MeshLambertMaterial({ color: 0x9a40dd, fog: false, transparent: true, opacity: 0.55 })
  )
  ring.position.set(-240, 130, -400)
  ring.rotation.x = Math.PI * 0.28
  scene.add(ring)

  // Animated clouds
  const clouds: THREE.Mesh[] = []
  const palette = [0xffffff, 0xf4f4ff, 0xe8eff8]
  for (let i = 0; i < 24; i++) {
    const cw = 90 + Math.random() * 200, ch = 22 + Math.random() * 55
    const m = new THREE.MeshLambertMaterial({
      color: palette[Math.floor(Math.random() * palette.length)],
      transparent: true, opacity: 0.22 + Math.random() * 0.28, depthWrite: false, fog: false,
    })
    const c = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), m)
    c.position.set((Math.random() - 0.5) * 900, 85 + Math.random() * 80, (Math.random() - 0.5) * 900)
    c.rotation.x = -Math.PI / 2
    c.rotation.z = Math.random() * Math.PI
    ;(c.userData as any).driftX = (0.4 + Math.random() * 1.6) * (Math.random() < 0.5 ? 1 : -1)
    ;(c.userData as any).driftZ = (0.2 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1)
    scene.add(c); clouds.push(c)
  }

  // Map (instanced, rich v1 builder)
  buildMapV1(scene, map)

  // Bloom
  const composer = new EffectComposer(renderer)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.45, 0.3, 0.55)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    composer.setSize(innerWidth, innerHeight)
    bloom.resolution.set(innerWidth, innerHeight)
  })

  return { scene, camera, renderer, composer, clouds }
}

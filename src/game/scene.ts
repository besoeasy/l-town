import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import type { MapData, Box } from './map'
import { groundHeight } from './map'
import type { PlayerState } from '../net/types'
import { CFG, CORE_DETAILS } from './config'

/**
 * Fresnel kinetic-shield dome (cosmetic). View-dependent rim glow with a
 * slow energy pulse, subtle vertex wobble, and a hit-flash channel.
 * Driven per-frame via uniforms uTime / uFlash / uOpacity.
 */
function makeShieldDomeMaterial(hex: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uColor: { value: new THREE.Color(hex) },
      uTime: { value: 0 },
      uFlash: { value: 0 },
      uOpacity: { value: 1 }
    },
    vertexShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      uniform float uTime;
      void main() {
        vPos = position;
        vec3 p = position + normal * (sin(uTime * 3.0 + position.y * 4.0 + position.x * 3.0) * 0.02);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uFlash;
      uniform float uOpacity;
      void main() {
        float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float bands = 0.5 + 0.5 * sin(vPos.y * 14.0 - uTime * 4.0);
        float pulse = 0.75 + 0.25 * sin(uTime * 2.2);
        vec3 col = uColor * (0.25 + fres * 1.6 * pulse + bands * 0.12 + uFlash * 1.5);
        float alpha = (0.06 + fres * 0.55 + bands * 0.05 + uFlash * 0.4) * uOpacity;
        gl_FragColor = vec4(col, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `
  })
}

function createNameplateTexture(name: string, isBot = false): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  if (ctx) {
    // Semi-transparent dark pill background
    ctx.fillStyle = isBot ? 'rgba(15, 23, 42, 0.75)' : 'rgba(8, 14, 26, 0.90)'
    ctx.beginPath()
    if (ctx.roundRect) {
      ctx.roundRect(8, 8, 240, 48, 10)
    } else {
      ctx.rect(8, 8, 240, 48)
    }
    ctx.fill()

    // Cyber border
    ctx.lineWidth = 3
    ctx.strokeStyle = isBot ? 'rgba(100, 116, 139, 0.8)' : '#00f0ff'
    ctx.beginPath()
    if (ctx.roundRect) {
      ctx.roundRect(8, 8, 240, 48, 10)
    } else {
      ctx.rect(8, 8, 240, 48)
    }
    ctx.stroke()

    // Callsign text
    ctx.font = 'bold 22px monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = isBot ? '#94a3b8' : '#38bdf8'
    ctx.fillText(name.slice(0, 14).toUpperCase(), 128, 32)
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.minFilter = THREE.LinearFilter
  return texture
}

export class SceneRenderer {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer: THREE.WebGLRenderer
  private playerMeshes = new Map<number, THREE.Group>()
  private clouds: THREE.Mesh[] = []

  // First-Person Robot Arm Viewmodel & Effects
  private robotArm!: THREE.Group
  private armConduitMat!: THREE.MeshBasicMaterial
  private armCoreMat!: THREE.MeshBasicMaterial
  private muzzleFlash!: THREE.Group
  private muzzleFlashTime = 0
  private armRecoil = 0
  private armRecoilRot = 0
  private bobTimer = 0
  // Nanite hand <-> blaster morph (cosmetic): blaster on shot, hand after 5s idle
  private blasterMorph = 0 // 0 = open hand, 1 = blaster gun
  private blasterTarget = 0
  private timeSinceShot = 99
  private fingerGroups: THREE.Group[] = []
  private fingerClosedX: number[] = []
  private fingerBaseX: number[] = []
  private blasterBarrel!: THREE.Mesh
  private blasterCore!: THREE.Mesh
  private thumbMesh!: THREE.Mesh
  private readonly thumbClosedY = 0.4
  private readonly morphDim = new THREE.Color(0x1e4a52)
  private firstPersonShield!: THREE.Group
  // Kinetic shield FX state (cosmetic): fade in/out, pulse clock, hit flash
  private fpShieldDomeMat!: THREE.ShaderMaterial
  private fpShieldRingMat!: THREE.MeshBasicMaterial
  private fpShieldFade = 0
  private fpShieldTarget = 0
  private fpShieldFlash = 0
  private shieldTime = 0
  private projectiles: { mesh: THREE.Group; vel: THREE.Vector3; dist: number; maxDist: number }[] = []
  private sparks: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = []

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene()
    // Atmospheric daytime depth haze (bright sky blue)
    this.scene.fog = new THREE.FogExp2(0x7ab0d0, 0.00055)

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 1800)
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance'
    })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5))
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.25
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.setupSky()
    this.setupLighting()
    this.setupCosmos()
    this.setupClouds()

    // Add camera to scene graph so camera children (robot arm, FP shield) render in camera space
    this.scene.add(this.camera)
    this.setupRobotArm()
    this.setupFirstPersonShield()

    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private setupRobotArm() {
    this.robotArm = new THREE.Group()
    this.robotArm.name = 'robotArm'
    this.robotArm.position.set(0.28, -0.22, -0.42)
    this.robotArm.rotation.set(0.05, -0.06, -0.04)

    const armMetalMat = new THREE.MeshStandardMaterial({
      color: 0x1e242e,
      roughness: 0.35,
      metalness: 0.85
    })
    const armJointMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.25,
      metalness: 0.95
    })
    this.armConduitMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff })
    this.armCoreMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff })

    // Forearm main sleeve
    const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.34), armMetalMat)
    sleeve.position.set(0, 0, 0.12)
    this.robotArm.add(sleeve)

    // Top armor plate
    const topPlate = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.025, 0.28), armJointMat)
    topPlate.position.set(0, 0.055, 0.11)
    this.robotArm.add(topPlate)

    // Glowing energy conduits along forearm
    const conduitGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.32, 8)
    const leftConduit = new THREE.Mesh(conduitGeo, this.armConduitMat)
    leftConduit.rotation.x = Math.PI / 2
    leftConduit.position.set(-0.045, 0.045, 0.12)
    this.robotArm.add(leftConduit)

    const rightConduit = new THREE.Mesh(conduitGeo, this.armConduitMat)
    rightConduit.rotation.x = Math.PI / 2
    rightConduit.position.set(0.045, 0.045, 0.12)
    this.robotArm.add(rightConduit)

    // Articulated wrist gimbal
    const wrist = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.04, 16), armJointMat)
    wrist.rotation.z = Math.PI / 2
    wrist.position.set(0, 0, -0.04)
    this.robotArm.add(wrist)

    // Palm base
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.045, 0.1), armMetalMat)
    palm.position.set(0, 0, -0.1)
    this.robotArm.add(palm)

    // Central Palm Blaster Barrel & Energy Reactor Core
    // (nanite-morphed: retracted while in open-hand form, extended in blaster form)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.038, 0.07, 16), armJointMat)
    barrel.rotation.x = Math.PI / 2
    barrel.position.set(0, 0.005, -0.15)
    this.robotArm.add(barrel)
    this.blasterBarrel = barrel

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.02, 12, 12), this.armCoreMat)
    core.position.set(0, 0.005, -0.15)
    this.robotArm.add(core)
    this.blasterCore = core

    // Articulated robotic fingers in firing grip posture
    const fingerMat = armJointMat
    const tipMat = this.armConduitMat

    const addFinger = (x: number, y: number, z: number, len: number, angleX = 0) => {
      const fGroup = new THREE.Group()
      fGroup.position.set(x, y, z)
      fGroup.rotation.x = angleX

      const phalanx = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, len), fingerMat)
      phalanx.position.z = -len / 2
      fGroup.add(phalanx)

      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.015), tipMat)
      tip.position.z = -len - 0.007
      fGroup.add(tip)

      this.robotArm.add(fGroup)
      this.fingerGroups.push(fGroup)
      this.fingerClosedX.push(angleX)
      this.fingerBaseX.push(x)
    }

    addFinger(0.032, 0.01, -0.15, 0.07, 0.1)   // Index
    addFinger(0.011, 0.012, -0.15, 0.08, 0.08)  // Middle
    addFinger(-0.011, 0.012, -0.15, 0.075, 0.1) // Ring
    addFinger(-0.032, 0.01, -0.15, 0.06, 0.14)  // Pinky

    // Thumb on inner edge (tucks into grip in blaster form, rests open in hand form)
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.02, 0.05), fingerMat)
    thumb.position.set(-0.048, -0.01, -0.11)
    thumb.rotation.y = 0.4
    this.robotArm.add(thumb)
    this.thumbMesh = thumb

    // Muzzle Flash Effect
    this.muzzleFlash = new THREE.Group()
    this.muzzleFlash.position.set(0, 0.005, -0.22)
    const flashCore = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), this.armCoreMat)
    const flashCross1 = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.01, 0.01), this.armCoreMat)
    const flashCross2 = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.18, 0.01), this.armCoreMat)
    this.muzzleFlash.add(flashCore, flashCross1, flashCross2)
    this.muzzleFlash.visible = false
    this.robotArm.add(this.muzzleFlash)

    // Start in open-hand form; first shot morphs to blaster
    this.applyBlasterMorph(0)

    this.camera.add(this.robotArm)
  }

  private setupFirstPersonShield() {
    this.firstPersonShield = new THREE.Group()
    this.firstPersonShield.position.set(0, 0, -0.42)

    // Glowing cyan boundary ring (pulsed in render())
    const fpRingGeo = new THREE.TorusGeometry(0.5, 0.01, 8, 36, Math.PI * 1.6)
    this.fpShieldRingMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending
    })
    const fpRing = new THREE.Mesh(fpRingGeo, this.fpShieldRingMat)
    fpRing.rotation.z = Math.PI * 0.7
    this.firstPersonShield.add(fpRing)

    // Fresnel kinetic dome (replaces the flat wireframe lattice)
    this.fpShieldDomeMat = makeShieldDomeMaterial(0x38bdf8)
    const fpDome = new THREE.Mesh(new THREE.SphereGeometry(0.48, 32, 24), this.fpShieldDomeMat)
    this.firstPersonShield.add(fpDome)

    this.firstPersonShield.visible = false
    this.camera.add(this.firstPersonShield)
  }

  private setupSky() {
    // Procedural sky (Preetham atmospheric model)
    const sky = new Sky()
    sky.scale.setScalar(10000)
    this.scene.add(sky)

    const skyU = sky.material.uniforms as any
    skyU['turbidity'].value = 2.5
    skyU['rayleigh'].value = 1.5
    skyU['mieCoefficient'].value = 0.005
    skyU['mieDirectionalG'].value = 0.8

    // Sun direction aligned with primary sun directional light (high clear daylight angle)
    const sunPos = new THREE.Vector3(120, 220, 80).normalize()
    skyU['sunPosition'].value.copy(sunPos)
  }

  private setupLighting() {
    // Sky / ground hemisphere light (soft daylight sky blue above, warm bounce ground below)
    const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x889966, 1.1)
    this.scene.add(hemi)

    // Direct warm sun with crisp soft shadows
    const sun = new THREE.DirectionalLight(0xfffaed, 2.4)
    sun.position.set(120, 220, 80)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 1200
    sun.shadow.camera.left = -600
    sun.shadow.camera.right = 600
    sun.shadow.camera.top = 600
    sun.shadow.camera.bottom = -600
    sun.shadow.bias = -0.00005
    sun.shadow.normalBias = 0.03
    this.scene.add(sun)

    // Directional fill light from opposing angle (ensures building shadows remain clearly visible)
    const fill = new THREE.DirectionalLight(0xa0c0e8, 0.8)
    fill.position.set(-100, 80, -80)
    this.scene.add(fill)

    // Ambient global illumination (ensures building interiors and covered areas are bright)
    const ambient = new THREE.AmbientLight(0xffffff, 0.8)
    this.scene.add(ambient)
  }

  private setupCosmos() {
    // Boreas planet in orbital sky
    const planetGeo = new THREE.SphereGeometry(65, 24, 24)
    const planetMat = new THREE.MeshLambertMaterial({ color: 0x5a1a8a, fog: false })
    const planet = new THREE.Mesh(planetGeo, planetMat)
    planet.position.set(-220, 140, -420)
    this.scene.add(planet)

    const ringGeo = new THREE.TorusGeometry(82, 5, 6, 48)
    const ringMat = new THREE.MeshLambertMaterial({
      color: 0x9a40dd,
      fog: false,
      transparent: true,
      opacity: 0.65
    })
    const ring = new THREE.Mesh(ringGeo, ringMat)
    ring.position.copy(planet.position)
    ring.rotation.x = Math.PI * 0.32
    ring.rotation.y = Math.PI * 0.1
    this.scene.add(ring)
  }

  private setupClouds() {
    const palette = [0xffffff, 0xf4f4ff, 0xe8eff8]
    for (let i = 0; i < 24; i++) {
      const cw = 110 + Math.random() * 200
      const ch = 25 + Math.random() * 55
      const mat = new THREE.MeshLambertMaterial({
        color: palette[Math.floor(Math.random() * palette.length)],
        transparent: true,
        opacity: 0.25 + Math.random() * 0.25,
        depthWrite: false,
        fog: false
      })
      const cloud = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), mat)
      cloud.position.set(
        (Math.random() - 0.5) * 850,
        90 + Math.random() * 70,
        (Math.random() - 0.5) * 850
      )
      cloud.rotation.x = -Math.PI / 2
      cloud.rotation.z = Math.random() * Math.PI
      ;(cloud.userData as any).driftX = (0.5 + Math.random() * 1.5) * (Math.random() < 0.5 ? 1 : -1)
      ;(cloud.userData as any).driftZ = (0.3 + Math.random() * 0.8) * (Math.random() < 0.5 ? 1 : -1)
      this.scene.add(cloud)
      this.clouds.push(cloud)
    }
  }

  buildMapGeometry(map: MapData) {
    const SIZE = map.floor.w

    // 1. Biome Ground Plane (Vertex-colored + rolling terrain displacement;
    //    rotation baked in so vertices are already world-aligned XZ)
    const gGeo = new THREE.PlaneGeometry(SIZE + 80, SIZE + 80, 150, 150)
    gGeo.rotateX(-Math.PI / 2)
    const gColors: number[] = []
    const pos = gGeo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i)
      const wz = pos.getZ(i)
      const gh = groundHeight(wx, wz, map.seed)
      pos.setY(i, gh)
      const n = (Math.sin(wx * 0.06 + wz * 0.11) * 0.5 +
                 Math.sin(wx * 0.17 - wz * 0.09) * 0.25 +
                 Math.sin(wx * 0.04 + wz * 0.04) * 0.14) * 0.042
      const t = Math.max(0, Math.min(1, (wx + 100) / 200))
      // Terra (+x): vibrant grass green
      const tr = 0.28 + n, tg = 0.52 + n * 0.6, tb = 0.20 + n * 0.5
      // Barren (-x): warm sandstone
      const br = 0.70 + n, bg = 0.60 + n * 0.4, bb = 0.38 + n * 0.3
      // Rocky tint on hilltops, darker soil in hollows
      const rock = Math.max(0, Math.min(1, (gh - 1.2) / 2))
      const shade = 1 + Math.max(-0.12, Math.min(0.06, gh * -0.04))
      const r = (tr * t + br * (1 - t)) * (1 - rock * 0.25) * shade + rock * 0.18
      const g = (tg * t + bg * (1 - t)) * (1 - rock * 0.28) * shade + rock * 0.16
      const b = (tb * t + bb * (1 - t)) * (1 - rock * 0.25) * shade + rock * 0.15
      gColors.push(r, g, b)
    }
    gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gColors, 3))
    gGeo.computeVertexNormals()
    const groundMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.0
    })
    const ground = new THREE.Mesh(gGeo, groundMat)
    ground.receiveShadow = true
    this.scene.add(ground)

    // 2. Water ponds
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x1878b8,
      roughness: 0.1,
      metalness: 0.4,
      transparent: true,
      opacity: 0.75
    })
    const waterPonds = [
      [80, -75, 38, 26], [10, -88, 22, 16], [90, 45, 28, 20],
      [70, 80, 24, 18], [-20, 30, 14, 10], [40, -40, 18, 14]
    ]
    for (const [wx, wz, ww, wd] of waterPonds) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(ww, wd), waterMat)
      w.rotation.x = -Math.PI / 2
      w.position.set(wx, 0.08, wz)
      this.scene.add(w)
    }

    // 3. Clean architectural materials for map boxes
    const materials: Record<string, THREE.Material> = {
      wall: new THREE.MeshStandardMaterial({ color: 0x8290a0, roughness: 0.76, metalness: 0.05 }),
      house_body: new THREE.MeshStandardMaterial({ color: 0xedf0f2, roughness: 0.75, metalness: 0.02 }), // Light bright concrete
      house_window: new THREE.MeshStandardMaterial({
        color: 0x6ab0d8,
        roughness: 0.10,
        metalness: 0.22,
        emissive: 0x3078b0,
        emissiveIntensity: 0.6
      }),
      house_door: new THREE.MeshStandardMaterial({ color: 0x242c38, roughness: 0.3, metalness: 0.2 }),
      house_chimney: new THREE.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.8 }),
      platform: new THREE.MeshStandardMaterial({ color: 0x9ca8b4, roughness: 0.72, metalness: 0.06 }),
      garden: new THREE.MeshStandardMaterial({ color: 0x48a02c, roughness: 0.85 }),
      fountain_base: new THREE.MeshStandardMaterial({ color: 0xb4c2cb, roughness: 0.55, metalness: 0.08 }),
      fountain_rim: new THREE.MeshStandardMaterial({ color: 0x00f0ff, roughness: 0.4, emissive: 0x0088aa, emissiveIntensity: 0.4 }),
      fountain_pillar: new THREE.MeshStandardMaterial({ color: 0x98a8b2, roughness: 0.5 }),
      bench: new THREE.MeshStandardMaterial({ color: 0x667078, roughness: 0.68, metalness: 0.2 }),
      lamp_post: new THREE.MeshStandardMaterial({ color: 0x242c36, roughness: 0.42, metalness: 0.65 }),
      lamp_head: new THREE.MeshStandardMaterial({ color: 0xffea70, emissive: 0xffee40, emissiveIntensity: 1.5 }),
      bollard: new THREE.MeshStandardMaterial({ color: 0xd8c818, roughness: 0.6, metalness: 0.18 }),
      path: new THREE.MeshStandardMaterial({ color: 0x424854, roughness: 0.92 }),
      road_marking: new THREE.MeshStandardMaterial({ color: 0xffea00, roughness: 0.8 }),

      // Biome-specific cover & buildings
      cover_terra: new THREE.MeshStandardMaterial({ color: 0x6ca044, roughness: 0.82 }),
      cover_barren: new THREE.MeshStandardMaterial({ color: 0xc49a58, roughness: 0.85 }),
      cover_neutral: new THREE.MeshStandardMaterial({ color: 0x8aa2b4, roughness: 0.72, metalness: 0.08 }),

      building_terra: new THREE.MeshStandardMaterial({ color: 0xe0e8ec, roughness: 0.74, metalness: 0.03 }),
      building_bar: new THREE.MeshStandardMaterial({ color: 0xdcd5b2, roughness: 0.78 }),
      building_neutral: new THREE.MeshStandardMaterial({ color: 0xa4b0bc, roughness: 0.72 }),

      rand_building: new THREE.MeshStandardMaterial({ color: 0xd0d8e0, roughness: 0.72, metalness: 0.04 }),

      pillar_terra: new THREE.MeshStandardMaterial({ color: 0x5a8a3c, roughness: 0.78 }),
      pillar_barren: new THREE.MeshStandardMaterial({ color: 0xaa7844, roughness: 0.82 }),
      pillar_neutral: new THREE.MeshStandardMaterial({ color: 0x889aa2, roughness: 0.68, metalness: 0.08 }),

      default: new THREE.MeshStandardMaterial({ color: 0x909ea8, roughness: 0.72 })
    }

    const groups = new Map<string, Box[]>()
    for (const b of map.boxes) {
      let key = b.type
      if (b.type === 'cover' || b.type === 'building' || b.type === 'pillar') {
        const biomeSuffix = b.biome === 'terra' ? '_terra' : b.biome === 'barren' ? '_barren' : '_neutral'
        key = `${b.type}${biomeSuffix}`
      }
      const finalKey = materials[key] ? key : 'default'
      let arr = groups.get(finalKey)
      if (!arr) {
        arr = []
        groups.set(finalKey, arr)
      }
      arr.push(b)
    }

    const unitBox = new THREE.BoxGeometry(1, 1, 1)
    const dummy = new THREE.Object3D()

    for (const [type, list] of groups) {
      const mat = materials[type]
      const count = list.length
      const inst = new THREE.InstancedMesh(unitBox, mat, count)
      inst.castShadow = true
      inst.receiveShadow = true

      for (let i = 0; i < count; i++) {
        const b = list[i]
        dummy.position.set(b.x, b.y, b.z)
        dummy.scale.set(b.w, b.h, b.d)
        dummy.rotation.set(0, 0, 0)
        dummy.updateMatrix()
        inst.setMatrixAt(i, dummy.matrix)
      }
      inst.instanceMatrix.needsUpdate = true
      this.scene.add(inst)
    }
  }

  updatePlayers(players: PlayerState[], localPlayerId: number) {
    const activeIds = new Set<number>()

    for (const p of players) {
      if (p.id === localPlayerId) continue
      activeIds.add(p.id)

      let group = this.playerMeshes.get(p.id)
      if (!group) {
        group = this.createPlayerMesh(p)
        group.userData.renderedName = p.name
        this.scene.add(group)
        this.playerMeshes.set(p.id, group)
      }

      group.visible = p.alive && !p.invisible
      if (group.visible) {
        group.position.set(p.x, p.y, p.z)
        group.rotation.y = p.yaw

        // Rotate tactical beacon diamond
        const beacon = group.getObjectByName('beacon') as THREE.Mesh
        if (beacon) {
          beacon.rotation.y += 0.04
          beacon.rotation.x += 0.02
        }

        // Dynamically refresh nameplate if callsign changed
        if (group.userData.renderedName !== p.name) {
          group.userData.renderedName = p.name
          const np = group.getObjectByName('nameplate') as THREE.Sprite
          if (np && np.material) {
            np.material.map?.dispose()
            np.material.map = createNameplateTexture(p.name, p.isBot)
            np.material.needsUpdate = true
          }
        }

        const shieldMesh = group.getObjectByName('shield') as THREE.Mesh
        if (shieldMesh) {
          shieldMesh.visible = p.shieldActive && Date.now() < p.shieldEnd
        }

        const superMesh = group.getObjectByName('super') as THREE.Mesh
        if (superMesh) {
          superMesh.visible = p.superActive && Date.now() < p.superEnd
        }

        // Humanoid Animation & Gait Cycle
        const h = group.userData.humanoid
        if (h) {
          const prev = group.userData.prevPos as THREE.Vector3
          const distMoved = Math.hypot(p.x - prev.x, p.z - prev.z)
          prev.set(p.x, p.y, p.z)

          const isMoving = distMoved > 0.015
          const walkSpeed = Math.min(distMoved * 70, 12)
          group.userData.animTime += isMoving ? walkSpeed * 0.025 : 0.035
          const t = group.userData.animTime

          // Floating Atma Core animation: slowly rotate & hover inside chest chamber (Lore: floating heart)
          if (h.atmaPyramid) {
            h.atmaPyramid.rotation.y += 0.035
            h.atmaPyramid.position.y = 0.08 + Math.sin(t * 2.5) * 0.008
          }

          if (p.crouching) {
            // Tactical crouch: drop pelvis, articulate knees and lean torso forward
            h.pelvis.position.y = 0.60
            h.spine.rotation.x = 0.22
            h.leftLeg.rotation.x = -0.65
            h.leftLowerLeg.rotation.x = 1.05
            h.rightLeg.rotation.x = -0.65
            h.rightLowerLeg.rotation.x = 1.05
            h.leftArm.rotation.x = 0.35
            h.rightArm.rotation.x = -Math.PI / 2 + 0.30
          } else if (isMoving) {
            // Humanoid walking/running gait cycle
            h.pelvis.position.y = 0.88 + Math.abs(Math.sin(t * 2)) * 0.03
            h.spine.rotation.x = 0.08
            h.spine.rotation.y = Math.sin(t) * 0.06

            const legAngle = Math.sin(t) * 0.65
            h.leftLeg.rotation.x = legAngle
            h.leftLowerLeg.rotation.x = legAngle < 0 ? -legAngle * 0.85 : 0.1

            h.rightLeg.rotation.x = -legAngle
            h.rightLowerLeg.rotation.x = -legAngle < 0 ? legAngle * 0.85 : 0.1

            // Counter-balancing arm swing
            h.leftArm.rotation.x = -legAngle * 0.5 + 0.2
            h.rightArm.rotation.x = -Math.PI / 2 + 0.15 + Math.sin(t) * 0.06
          } else {
            // Idle combat stance: natural breathing & balance
            h.pelvis.position.y = 0.88 + Math.sin(t * 1.5) * 0.008
            h.spine.rotation.x = 0
            h.spine.rotation.y = 0
            h.leftLeg.rotation.x = 0.04
            h.leftLowerLeg.rotation.x = 0.02
            h.rightLeg.rotation.x = -0.04
            h.rightLowerLeg.rotation.x = 0.02
            h.leftArm.rotation.x = 0.18 + Math.sin(t * 1.5) * 0.025
            h.rightArm.rotation.x = -Math.PI / 2 + 0.15 + Math.sin(t * 1.5) * 0.015
          }

          // Super mode: flare conduits and core golden amber (from lore)
          if (group.userData.energyMat) {
            const isSuper = p.superActive && Date.now() < p.superEnd
            const activeColor = isSuper ? 0xffaa00 : group.userData.coreColor
            group.userData.energyMat.color.set(activeColor)
            group.userData.energyMat.emissive.set(activeColor)
            group.userData.energyMat.emissiveIntensity = isSuper ? 2.5 : 1.2
          }
        }
      }
    }

    for (const [id, grp] of this.playerMeshes) {
      if (!activeIds.has(id)) {
        this.scene.remove(grp)
        this.playerMeshes.delete(id)
      }
    }
  }

  private createPlayerMesh(p: PlayerState): THREE.Group {
    const group = new THREE.Group()
    const core = CORE_DETAILS[p.character] || CORE_DETAILS.telepotu

    // ── High-Fidelity Materials for RX-11 Chassis ─────────────────────────────
    // 1. Primary Nanite Armor: Dark carbon-nanite alloy with subtle gloss
    const armorMat = new THREE.MeshStandardMaterial({
      color: 0x222a36,
      roughness: 0.35,
      metalness: 0.85
    })
    // 2. Secondary Armor & Trim: Polished gunmetal steel plates
    const trimMat = new THREE.MeshStandardMaterial({
      color: 0x3a4659,
      roughness: 0.28,
      metalness: 0.90
    })
    // 3. Mechanical Joint Framework & Under-Chassis: Dark titanium
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0x141820,
      roughness: 0.55,
      metalness: 0.70
    })
    // 4. Core Energy Emissive Material (tied to Maker core identity)
    const energyMat = new THREE.MeshStandardMaterial({
      color: core.color,
      emissive: core.color,
      emissiveIntensity: 1.2,
      roughness: 0.2,
      metalness: 0.5
    })
    // 5. Visor Material: High-intensity glowing optic slit
    const visorMat = new THREE.MeshBasicMaterial({
      color: core.color
    })
    // 6. Integrated Weapon Metal
    const weaponMat = new THREE.MeshStandardMaterial({
      color: 0x181e26,
      roughness: 0.3,
      metalness: 0.9
    })

    // Store articulated references for dynamic animation
    const humanoid: any = {}
    group.userData.humanoid = humanoid
    group.userData.prevPos = new THREE.Vector3(p.x, p.y, p.z)
    group.userData.animTime = Math.random() * 10
    group.userData.energyMat = energyMat
    group.userData.coreColor = core.color

    // Root chassis container
    const chassis = new THREE.Group()
    chassis.name = 'chassis'
    group.add(chassis)
    humanoid.chassis = chassis

    // ── PELVIS & HIPS (Center at y = 0.88m) ───────────────────────────────────
    const pelvis = new THREE.Group()
    pelvis.position.y = 0.88
    chassis.add(pelvis)
    humanoid.pelvis = pelvis

    const pelvisBase = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.22), armorMat)
    pelvisBase.castShadow = true
    pelvis.add(pelvisBase)

    const hipBelt = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.06, 0.24), trimMat)
    hipBelt.position.y = 0.05
    pelvis.add(hipBelt)

    // Lateral hip actuators
    const hipSocketGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.32, 12)
    const hipSockets = new THREE.Mesh(hipSocketGeo, jointMat)
    hipSockets.rotation.z = Math.PI / 2
    pelvis.add(hipSockets)

    // ── TORSO & THORAX ───────────────────────────────────────────────────────
    const spine = new THREE.Group()
    spine.position.y = 0.08
    pelvis.add(spine)
    humanoid.spine = spine

    // Articulated abdominal spine column
    const abdomen = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.16, 8), jointMat)
    abdomen.position.y = 0.08
    spine.add(abdomen)

    // Upper chest group
    const chestGroup = new THREE.Group()
    chestGroup.position.y = 0.24
    spine.add(chestGroup)
    humanoid.chest = chestGroup

    // Athletic V-taper armored thorax
    const chestMain = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.32, 0.28), armorMat)
    chestMain.position.y = 0.08
    chestMain.castShadow = true
    chestGroup.add(chestMain)

    // Left and right pectoral armor plates
    const leftPec = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.22, 0.05), trimMat)
    leftPec.position.set(-0.11, 0.09, 0.14)
    chestGroup.add(leftPec)

    const rightPec = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.22, 0.05), trimMat)
    rightPec.position.set(0.11, 0.09, 0.14)
    chestGroup.add(rightPec)

    // Dorsal spine stabilizer / backpack intake
    const dorsalPack = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.30, 0.10), trimMat)
    dorsalPack.position.set(0, 0.08, -0.16)
    chestGroup.add(dorsalPack)

    // ── THE ATMA CORE NANITE CHAMBER (From Lore: Floating Pyramid Heart) ─────
    // Recessed circular aperture in chest center
    const chamberRing = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.02, 8, 24), jointMat)
    chamberRing.position.set(0, 0.08, 0.145)
    chestGroup.add(chamberRing)

    const chamberBack = new THREE.Mesh(
      new THREE.CircleGeometry(0.08, 16),
      new THREE.MeshBasicMaterial({ color: 0x080b10 })
    )
    chamberBack.position.set(0, 0.08, 0.138)
    chestGroup.add(chamberBack)

    // Perfect 4-sided pyramid suspended center-mass in nanite fluid
    const pyramidGeo = new THREE.ConeGeometry(0.065, 0.13, 4)
    const atmaPyramid = new THREE.Mesh(pyramidGeo, energyMat)
    atmaPyramid.position.set(0, 0.08, 0.142)
    atmaPyramid.rotation.x = Math.PI / 6
    chestGroup.add(atmaPyramid)
    humanoid.atmaPyramid = atmaPyramid

    // Glowing energy conduits wired from core to shoulders
    const conduitGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.16, 6)
    const leftConduit = new THREE.Mesh(conduitGeo, energyMat)
    leftConduit.rotation.z = Math.PI / 4
    leftConduit.position.set(-0.10, 0.14, 0.135)
    chestGroup.add(leftConduit)

    const rightConduit = new THREE.Mesh(conduitGeo, energyMat)
    rightConduit.rotation.z = -Math.PI / 4
    rightConduit.position.set(0.10, 0.14, 0.135)
    chestGroup.add(rightConduit)

    // ── HEAD & HELMET ────────────────────────────────────────────────────────
    const headGroup = new THREE.Group()
    headGroup.position.y = 0.28
    chestGroup.add(headGroup)
    humanoid.head = headGroup

    // Neck joint collar
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.08, 0.08, 12), jointMat)
    neck.position.y = 0.02
    headGroup.add(neck)

    // Sculpted combat helmet
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.24), armorMat)
    helmet.position.y = 0.16
    helmet.castShadow = true
    headGroup.add(helmet)

    // Angular chin guard
    const chin = new THREE.Mesh(new THREE.ConeGeometry(0.10, 0.10, 4), trimMat)
    chin.rotation.y = Math.PI / 4
    chin.rotation.x = Math.PI
    chin.position.set(0, 0.08, 0.10)
    headGroup.add(chin)

    // Helmet brow plate
    const brow = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.06), trimMat)
    brow.position.set(0, 0.21, 0.11)
    headGroup.add(brow)

    // Vivid glowing horizontal visor slit
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.045, 0.04), visorMat)
    visor.position.set(0, 0.16, 0.12)
    headGroup.add(visor)

    // Lateral telemetry pods
    const earLeft = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), jointMat)
    earLeft.rotation.z = Math.PI / 2
    earLeft.position.set(-0.13, 0.16, 0.02)
    headGroup.add(earLeft)

    const earRight = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), jointMat)
    earRight.rotation.z = Math.PI / 2
    earRight.position.set(0.13, 0.16, 0.02)
    headGroup.add(earRight)

    // ── LEFT ARM (Tactical Support Arm) ──────────────────────────────────────
    const leftArm = new THREE.Group()
    leftArm.position.set(-0.28, 0.16, 0)
    chestGroup.add(leftArm)
    humanoid.leftArm = leftArm

    const leftPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.18), trimMat)
    leftPauldron.position.set(-0.02, 0.02, 0)
    leftArm.add(leftPauldron)

    const leftShoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), jointMat)
    leftArm.add(leftShoulderBall)

    const leftBicep = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.20, 0.09), armorMat)
    leftBicep.position.set(0, -0.12, 0)
    leftArm.add(leftBicep)

    // Left forearm
    const leftForearm = new THREE.Group()
    leftForearm.position.set(0, -0.22, 0)
    leftArm.add(leftForearm)
    humanoid.leftForearm = leftForearm

    const leftElbow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), jointMat)
    leftForearm.add(leftElbow)

    const leftForearmArmor = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.20, 0.085), armorMat)
    leftForearmArmor.position.set(0, -0.10, 0)
    leftForearm.add(leftForearmArmor)

    // Glowing nanite conduit along left forearm
    const leftForearmGlow = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.01), energyMat)
    leftForearmGlow.position.set(-0.045, -0.10, 0)
    leftForearm.add(leftForearmGlow)

    const leftHand = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.05), jointMat)
    leftHand.position.set(0, -0.22, 0)
    leftForearm.add(leftHand)

    leftArm.rotation.x = 0.2
    leftArm.rotation.z = 0.12
    leftForearm.rotation.x = -0.4

    // ── RIGHT ARM (Integrated Nanite Pulse Blaster) ───────────────────────────
    const rightArm = new THREE.Group()
    rightArm.position.set(0.28, 0.16, 0)
    chestGroup.add(rightArm)
    humanoid.rightArm = rightArm

    const rightPauldron = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.18), trimMat)
    rightPauldron.position.set(0.02, 0.02, 0)
    rightArm.add(rightPauldron)

    const rightShoulderBall = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), jointMat)
    rightArm.add(rightShoulderBall)

    const rightBicep = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.20, 0.09), armorMat)
    rightBicep.position.set(0, -0.12, 0)
    rightArm.add(rightBicep)

    // Right forearm & weapon assembly
    const rightForearm = new THREE.Group()
    rightForearm.position.set(0, -0.22, 0)
    rightArm.add(rightForearm)
    humanoid.rightForearm = rightForearm

    const rightElbow = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 8), jointMat)
    rightForearm.add(rightElbow)

    const weaponBody = new THREE.Mesh(new THREE.BoxGeometry(0.10, 0.12, 0.36), weaponMat)
    weaponBody.position.set(0, -0.04, 0.12)
    rightForearm.add(weaponBody)

    const gunBarrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.032, 0.28, 12), jointMat)
    gunBarrel.rotation.x = Math.PI / 2
    gunBarrel.position.set(0, -0.02, 0.38)
    rightForearm.add(gunBarrel)

    const coil = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.18), energyMat)
    coil.position.set(0, 0.03, 0.14)
    rightForearm.add(coil)

    const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 12), trimMat)
    muzzle.rotation.x = Math.PI / 2
    muzzle.position.set(0, -0.02, 0.52)
    rightForearm.add(muzzle)

    rightArm.rotation.x = -Math.PI / 2 + 0.15
    rightArm.rotation.y = -0.1
    rightForearm.rotation.x = -0.15

    // ── LEFT LEG ─────────────────────────────────────────────────────────────
    const leftLeg = new THREE.Group()
    leftLeg.position.set(-0.13, -0.04, 0)
    pelvis.add(leftLeg)
    humanoid.leftLeg = leftLeg

    const leftHipBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), jointMat)
    leftLeg.add(leftHipBall)

    const leftThigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.14), armorMat)
    leftThigh.position.set(0, -0.18, 0)
    leftThigh.castShadow = true
    leftLeg.add(leftThigh)

    const leftLowerLeg = new THREE.Group()
    leftLowerLeg.position.set(0, -0.38, 0)
    leftLeg.add(leftLowerLeg)
    humanoid.leftLowerLeg = leftLowerLeg

    const leftKnee = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.06), trimMat)
    leftKnee.position.set(0, 0.01, 0.08)
    leftLowerLeg.add(leftKnee)

    const leftShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.13), armorMat)
    leftShin.position.set(0, -0.18, 0)
    leftShin.castShadow = true
    leftLowerLeg.add(leftShin)

    const leftThruster = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.04), trimMat)
    leftThruster.position.set(0, -0.16, -0.08)
    leftLowerLeg.add(leftThruster)

    const leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), trimMat)
    leftFoot.position.set(0, -0.38, 0.04)
    leftFoot.castShadow = true
    leftLowerLeg.add(leftFoot)

    // ── RIGHT LEG ────────────────────────────────────────────────────────────
    const rightLeg = new THREE.Group()
    rightLeg.position.set(0.13, -0.04, 0)
    pelvis.add(rightLeg)
    humanoid.rightLeg = rightLeg

    const rightHipBall = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 8), jointMat)
    rightLeg.add(rightHipBall)

    const rightThigh = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.36, 0.14), armorMat)
    rightThigh.position.set(0, -0.18, 0)
    rightThigh.castShadow = true
    rightLeg.add(rightThigh)

    const rightLowerLeg = new THREE.Group()
    rightLowerLeg.position.set(0, -0.38, 0)
    rightLeg.add(rightLowerLeg)
    humanoid.rightLowerLeg = rightLowerLeg

    const rightKnee = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.09, 0.06), trimMat)
    rightKnee.position.set(0, 0.01, 0.08)
    rightLowerLeg.add(rightKnee)

    const rightShin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.36, 0.13), armorMat)
    rightShin.position.set(0, -0.18, 0)
    rightShin.castShadow = true
    rightLowerLeg.add(rightShin)

    const rightThruster = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.04), trimMat)
    rightThruster.position.set(0, -0.16, -0.08)
    rightLowerLeg.add(rightThruster)

    const rightFoot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.22), trimMat)
    rightFoot.position.set(0, -0.38, 0.04)
    rightFoot.castShadow = true
    rightLowerLeg.add(rightFoot)

    // ── TACTICAL HUD OVERLAYS (Nameplate, Beacon, Shield, Super) ─────────────
    const nameplateMat = new THREE.SpriteMaterial({
      map: createNameplateTexture(p.name, p.isBot),
      transparent: true,
      depthTest: false
    })
    const nameplate = new THREE.Sprite(nameplateMat)
    nameplate.name = 'nameplate'
    nameplate.scale.set(2.4, 0.6, 1)
    nameplate.position.set(0, 2.45, 0)
    group.add(nameplate)

    const beaconMat = new THREE.MeshBasicMaterial({
      color: p.isBot ? 0x64748b : 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    })
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), beaconMat)
    beacon.name = 'beacon'
    beacon.position.set(0, 2.95, 0)
    group.add(beacon)

    // Kinetic Shield Dome
    const shieldGroup = new THREE.Group()
    shieldGroup.name = 'shield'
    shieldGroup.position.y = 1.1
    shieldGroup.visible = false

    const innerShieldMat = makeShieldDomeMaterial(0x00f0ff)
    const innerShield = new THREE.Mesh(new THREE.SphereGeometry(1.35, 32, 24), innerShieldMat)
    shieldGroup.add(innerShield)

    const outerShieldMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.75
    })
    const outerShield = new THREE.Mesh(new THREE.IcosahedronGeometry(1.42, 2), outerShieldMat)
    shieldGroup.add(outerShield)

    const ringShieldMat = new THREE.MeshBasicMaterial({
      color: 0x67e8f9,
      transparent: true,
      opacity: 0.85
    })
    const ringShield = new THREE.Mesh(new THREE.TorusGeometry(1.38, 0.03, 8, 32), ringShieldMat)
    ringShield.rotation.x = Math.PI / 2
    shieldGroup.add(ringShield)
    group.add(shieldGroup)

    const superMat = new THREE.MeshBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.5,
      wireframe: true
    })
    const superMesh = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.08, 8, 24), superMat)
    superMesh.name = 'super'
    superMesh.position.y = 1.0
    superMesh.rotation.x = Math.PI / 2
    superMesh.visible = false
    group.add(superMesh)

    return group
  }

  triggerShoot(superActive: boolean = false) {
    this.armRecoil = 0.08
    this.armRecoilRot = 0.12
    // Nanite morph: hand -> blaster gun on every real shot
    this.timeSinceShot = 0
    this.blasterTarget = 1
    if (this.muzzleFlash) {
      this.muzzleFlash.visible = true
      this.muzzleFlashTime = 0.06
    }
    const color = superActive ? 0xffaa00 : 0x00f0ff
    this.armConduitMat.color.setHex(color)
    this.armCoreMat.color.setHex(color)
  }

  /** Lerp factor 0 (open nanite hand) -> 1 (palm blaster). Cosmetic only. */
  private applyBlasterMorph(t: number) {
    const m = THREE.MathUtils.clamp(t, 0, 1)
    // Barrel + reactor core grow out of the palm in blaster form
    const s = Math.max(0.001, m)
    this.blasterBarrel.scale.setScalar(s)
    this.blasterBarrel.visible = m > 0.02
    this.blasterCore.scale.setScalar(s)
    this.blasterCore.visible = m > 0.02
    // Fingers: open/spread hand (m=0) -> curled firing grip (m=1)
    for (let i = 0; i < this.fingerGroups.length; i++) {
      const g = this.fingerGroups[i]
      g.rotation.x = this.fingerClosedX[i] - (1 - m) * 0.55
      g.position.x = this.fingerBaseX[i] * (1 + (1 - m) * 0.35)
    }
    // Thumb tucks into the grip in blaster form
    this.thumbMesh.rotation.y = this.thumbClosedY - (1 - m) * 0.5
  }

  setFirstPersonShield(active: boolean) {
    // Fade is animated in render(); here we only set the target
    this.fpShieldTarget = active ? 1 : 0
  }

  /** Hit flash on the first-person dome (called when our shield blocks damage). Cosmetic. */
  flashFirstPersonShield() {
    this.fpShieldFlash = 1
  }

  /** Hit flash on a third-person shield dome (called when their shield blocks damage). Cosmetic. */
  flashThirdPersonShield(id: number) {
    const grp = this.playerMeshes.get(id)
    if (!grp) return
    grp.traverse(o => {
      const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined
      if (m && (m as any).uniforms && (m as any).uniforms.uFlash) {
        ;(m as any).uniforms.uFlash.value = 1
      }
    })
  }

  spawnProjectile(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    superActive: boolean = false,
    maxDist: number = 180
  ) {
    const group = new THREE.Group()
    group.position.set(ox, oy, oz)

    const color = superActive ? 0xffaa00 : 0x00f0ff

    // Inner bright beam core
    const coreGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8)
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const coreMesh = new THREE.Mesh(coreGeo, coreMat)
    coreMesh.rotation.x = Math.PI / 2
    group.add(coreMesh)

    // Outer glowing energy sheath
    const auraGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8)
    const auraMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending
    })
    const auraMesh = new THREE.Mesh(auraGeo, auraMat)
    auraMesh.rotation.x = Math.PI / 2
    group.add(auraMesh)

    const dir = new THREE.Vector3(dx, dy, dz).normalize()
    const target = new THREE.Vector3().addVectors(group.position, dir)
    group.lookAt(target)

    this.scene.add(group)

    const speed = 160
    this.projectiles.push({
      mesh: group,
      vel: dir.clone().multiplyScalar(speed),
      dist: 0,
      maxDist
    })
  }

  spawnImpactSparks(pos: THREE.Vector3, color: number = 0x00f0ff) {
    const count = 6
    const sparkGeo = new THREE.SphereGeometry(0.035, 4, 4)
    const sparkMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending
    })
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(sparkGeo, sparkMat)
      mesh.position.copy(pos)
      const vel = new THREE.Vector3(
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 6
      )
      this.scene.add(mesh)
      this.sparks.push({ mesh, vel, life: 0.12 })
    }
  }

  render(dt: number, isMoving = false, superActive = false, shieldActive = false) {
    for (const c of this.clouds) {
      c.position.x += (c.userData as any).driftX * dt * 4
      c.position.z += (c.userData as any).driftZ * dt * 4
      if (c.position.x > 450) c.position.x = -450
      if (c.position.x < -450) c.position.x = 450
      if (c.position.z > 450) c.position.z = -450
      if (c.position.z < -450) c.position.z = 450
    }

    // Robot Hand recoil recovery & walking bobbing
    this.armRecoil = THREE.MathUtils.lerp(this.armRecoil, 0, dt * 18)
    this.armRecoilRot = THREE.MathUtils.lerp(this.armRecoilRot, 0, dt * 18)
    if (isMoving) {
      this.bobTimer += dt * 9
    }
    const bobX = Math.cos(this.bobTimer) * 0.005
    const bobY = Math.sin(this.bobTimer * 2) * 0.004
    this.robotArm.position.set(0.28 + bobX, -0.22 + bobY, -0.42 + this.armRecoil)
    this.robotArm.rotation.set(0.05 - this.armRecoilRot, -0.06, -0.04 + bobX * 2)

    // Muzzle flash duration
    if (this.muzzleFlashTime > 0) {
      this.muzzleFlashTime -= dt
      if (this.muzzleFlashTime <= 0 && this.muzzleFlash) {
        this.muzzleFlash.visible = false
      }
    }

    // Update conduits color (dimmed while in open-hand form)
    const themeColor = superActive ? 0xffaa00 : 0x00f0ff
    this.armConduitMat.color.setHex(themeColor).lerp(this.morphDim, (1 - this.blasterMorph) * 0.6)
    this.armCoreMat.color.setHex(themeColor).lerp(this.morphDim, (1 - this.blasterMorph) * 0.6)

    // Nanite revert: blaster -> open hand after 5s without a shot
    this.timeSinceShot += dt
    if (this.timeSinceShot > 5) {
      this.blasterTarget = 0
    }
    if (this.blasterMorph !== this.blasterTarget) {
      const rate = this.blasterTarget > this.blasterMorph ? 8 : 1.5
      this.blasterMorph = THREE.MathUtils.clamp(
        this.blasterMorph + Math.sign(this.blasterTarget - this.blasterMorph) * rate * dt,
        0, 1
      )
      this.applyBlasterMorph(this.blasterMorph)
    }

    // First person shield: smooth fade, energy pulse, hit-flash decay
    this.setFirstPersonShield(shieldActive)
    this.shieldTime += dt
    this.fpShieldFlash = Math.max(0, this.fpShieldFlash - dt * 3)
    this.fpShieldFade += (this.fpShieldTarget - this.fpShieldFade) * Math.min(1, dt * 6)
    if (Math.abs(this.fpShieldTarget - this.fpShieldFade) < 0.01) {
      this.fpShieldFade = this.fpShieldTarget
    }
    const fpVisible = this.fpShieldFade > 0.02
    this.firstPersonShield.visible = fpVisible
    if (fpVisible) {
      this.fpShieldDomeMat.uniforms.uTime.value = this.shieldTime
      this.fpShieldDomeMat.uniforms.uFlash.value = this.fpShieldFlash
      this.fpShieldDomeMat.uniforms.uOpacity.value = this.fpShieldFade
      this.fpShieldRingMat.opacity =
        0.45 * this.fpShieldFade * (0.8 + 0.2 * Math.sin(this.shieldTime * 2.2))
      const s = 0.92 + 0.08 * this.fpShieldFade
      this.firstPersonShield.scale.setScalar(s)
      this.firstPersonShield.rotation.z += dt * 0.8
    }

    // Update active projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]
      const step = p.vel.clone().multiplyScalar(dt)
      p.mesh.position.add(step)
      p.dist += step.length()
      if (p.dist >= p.maxDist) {
        this.spawnImpactSparks(p.mesh.position, superActive ? 0xffaa00 : 0x00f0ff)
        this.scene.remove(p.mesh)
        this.projectiles.splice(i, 1)
      }
    }

    // Update sparks
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i]
      s.mesh.position.addScaledVector(s.vel, dt)
      s.life -= dt
      if (s.life <= 0) {
        this.scene.remove(s.mesh)
        this.sparks.splice(i, 1)
      }
    }

    // Animate 3rd person shields: spin, energy pulse, hit-flash decay
    for (const grp of this.playerMeshes.values()) {
      const sh = grp.getObjectByName('shield')
      if (sh && sh.visible) {
        sh.rotation.y += dt * 1.5
        sh.traverse(o => {
          const m = (o as THREE.Mesh).material as THREE.ShaderMaterial | undefined
          if (m && (m as any).uniforms && (m as any).uniforms.uTime) {
            ;(m as any).uniforms.uTime.value = this.shieldTime
            ;(m as any).uniforms.uFlash.value = Math.max(0, (m as any).uniforms.uFlash.value - dt * 3)
          }
        })
      }
    }

    this.renderer.render(this.scene, this.camera)
  }

  destroy() {
    window.removeEventListener('resize', this.onResize)
    for (const p of this.projectiles) {
      this.scene.remove(p.mesh)
    }
    this.projectiles = []
    for (const s of this.sparks) {
      this.scene.remove(s.mesh)
    }
    this.sparks = []
    this.renderer.dispose()
  }
}

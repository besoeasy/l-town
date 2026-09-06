import * as THREE from 'three'
import { Sky } from 'three/addons/objects/Sky.js'
import type { MapData, Box } from './map'
import type { PlayerState } from '../net/types'
import { CFG, CORE_DETAILS } from './config'

export class SceneRenderer {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer: THREE.WebGLRenderer
  private playerMeshes = new Map<number, THREE.Group>()
  private clouds: THREE.Mesh[] = []

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
    this.renderer.toneMappingExposure = 1.15
    this.renderer.outputColorSpace = THREE.SRGBColorSpace

    this.setupSky()
    this.setupLighting()
    this.setupCosmos()
    this.setupClouds()

    window.addEventListener('resize', this.onResize)
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth, window.innerHeight)
  }

  private setupSky() {
    // Procedural sky (Preetham atmospheric model)
    const sky = new Sky()
    sky.scale.setScalar(10000)
    this.scene.add(sky)

    const skyU = sky.material.uniforms as any
    skyU['turbidity'].value = 8
    skyU['rayleigh'].value = 2.5
    skyU['mieCoefficient'].value = 0.005
    skyU['mieDirectionalG'].value = 0.82

    // Afternoon sun direction (golden hour angle)
    const sunDir = new THREE.Vector3()
    sunDir.setFromSphericalCoords(
      1,
      THREE.MathUtils.degToRad(85),
      THREE.MathUtils.degToRad(220)
    )
    skyU['sunPosition'].value.copy(sunDir)
  }

  private setupLighting() {
    // Sky / ground hemisphere light (soft sky blue above, warm earth green below)
    const hemi = new THREE.HemisphereLight(0xb8d4f0, 0x4a5828, 0.8)
    this.scene.add(hemi)

    // Direct warm sun with crisp soft shadows
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2)
    sun.position.set(120, 220, 80)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 1200
    sun.shadow.camera.left = -600
    sun.shadow.camera.right = 600
    sun.shadow.camera.top = 600
    sun.shadow.camera.bottom = -600
    sun.shadow.bias = -0.0003
    this.scene.add(sun)

    // Directional fill light from opposing angle (ensures building shadows remain visible)
    const fill = new THREE.DirectionalLight(0x8090c0, 0.6)
    fill.position.set(-80, 60, -60)
    this.scene.add(fill)

    // Ambient global illumination
    const ambient = new THREE.AmbientLight(0xffffff, 0.45)
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

    // 1. Biome Ground Plane (Vertex-colored: rich green grass on Terra side, warm desert sand on Barren side)
    const gGeo = new THREE.PlaneGeometry(SIZE + 80, SIZE + 80, 120, 120)
    const gColors: number[] = []
    const pos = gGeo.attributes.position
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.getX(i)
      const vy = pos.getY(i)
      const n = (Math.sin(vx * 0.06 + vy * 0.11) * 0.5 +
                 Math.sin(vx * 0.17 - vy * 0.09) * 0.25 +
                 Math.sin(vx * 0.04 + vy * 0.04) * 0.14) * 0.042
      const t = Math.max(0, Math.min(1, (vx + 100) / 200))
      // Terra (+x): vibrant grass green
      const tr = 0.22 + n, tg = 0.44 + n * 0.6, tb = 0.16 + n * 0.5
      // Barren (-x): warm sandstone
      const br = 0.62 + n, bg = 0.52 + n * 0.4, bb = 0.30 + n * 0.3
      gColors.push(tr * t + br * (1 - t), tg * t + bg * (1 - t), tb * t + bb * (1 - t))
    }
    gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gColors, 3))
    const groundMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.0
    })
    const ground = new THREE.Mesh(gGeo, groundMat)
    ground.rotation.x = -Math.PI / 2
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
      wall: new THREE.MeshStandardMaterial({ color: 0x3a4250, roughness: 0.82, metalness: 0.08 }),
      house_body: new THREE.MeshStandardMaterial({ color: 0xdce0dd, roughness: 0.78, metalness: 0.02 }), // Light bright concrete
      house_window: new THREE.MeshStandardMaterial({
        color: 0x5a9ec8,
        roughness: 0.10,
        metalness: 0.22,
        emissive: 0x2468a0,
        emissiveIntensity: 0.55
      }),
      house_door: new THREE.MeshStandardMaterial({ color: 0x161a24, roughness: 0.3, metalness: 0.2 }),
      house_chimney: new THREE.MeshStandardMaterial({ color: 0x484c54, roughness: 0.8 }),
      platform: new THREE.MeshStandardMaterial({ color: 0x888e94, roughness: 0.76, metalness: 0.06 }),
      garden: new THREE.MeshStandardMaterial({ color: 0x3a8824, roughness: 0.88 }),
      fountain_base: new THREE.MeshStandardMaterial({ color: 0xa0aeb6, roughness: 0.58, metalness: 0.08 }),
      fountain_rim: new THREE.MeshStandardMaterial({ color: 0x00f0ff, roughness: 0.4, emissive: 0x006688, emissiveIntensity: 0.3 }),
      fountain_pillar: new THREE.MeshStandardMaterial({ color: 0x8898a2, roughness: 0.5 }),
      bench: new THREE.MeshStandardMaterial({ color: 0x565e64, roughness: 0.68, metalness: 0.2 }),
      lamp_post: new THREE.MeshStandardMaterial({ color: 0x1a2028, roughness: 0.42, metalness: 0.65 }),
      lamp_head: new THREE.MeshStandardMaterial({ color: 0xffea70, emissive: 0xffee40, emissiveIntensity: 1.4 }),
      bollard: new THREE.MeshStandardMaterial({ color: 0xd0c010, roughness: 0.62, metalness: 0.18 }),
      path: new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.95 }),
      road_marking: new THREE.MeshStandardMaterial({ color: 0xffea00, roughness: 0.8 }),

      // Biome-specific cover & buildings
      cover_terra: new THREE.MeshStandardMaterial({ color: 0x5a8838, roughness: 0.85 }),
      cover_barren: new THREE.MeshStandardMaterial({ color: 0xb08848, roughness: 0.88 }),
      cover_neutral: new THREE.MeshStandardMaterial({ color: 0x7890a0, roughness: 0.74, metalness: 0.08 }),

      building_terra: new THREE.MeshStandardMaterial({ color: 0xd4dce0, roughness: 0.76, metalness: 0.03 }),
      building_bar: new THREE.MeshStandardMaterial({ color: 0xd0c9a4, roughness: 0.8 }),
      building_neutral: new THREE.MeshStandardMaterial({ color: 0x929ea8, roughness: 0.75 }),

      pillar_terra: new THREE.MeshStandardMaterial({ color: 0x4a7830, roughness: 0.8 }),
      pillar_barren: new THREE.MeshStandardMaterial({ color: 0x9a6838, roughness: 0.85 }),
      pillar_neutral: new THREE.MeshStandardMaterial({ color: 0x78888e, roughness: 0.68, metalness: 0.08 }),

      default: new THREE.MeshStandardMaterial({ color: 0x7a8694, roughness: 0.75 })
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
        this.scene.add(group)
        this.playerMeshes.set(p.id, group)
      }

      group.visible = p.alive && !p.invisible
      if (group.visible) {
        group.position.set(p.x, p.y, p.z)
        group.rotation.y = p.yaw

        const shieldMesh = group.getObjectByName('shield') as THREE.Mesh
        if (shieldMesh) {
          shieldMesh.visible = p.shieldActive && Date.now() < p.shieldEnd
        }

        const superMesh = group.getObjectByName('super') as THREE.Mesh
        if (superMesh) {
          superMesh.visible = p.superActive && Date.now() < p.superEnd
        }

        if (p.crouching) {
          group.scale.set(1, 0.65, 1)
        } else {
          group.scale.set(1, 1, 1)
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

    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x354052,
      roughness: 0.35,
      metalness: 0.65
    })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.45), bodyMat)
    body.position.y = 0.9
    body.castShadow = true
    group.add(body)

    const coreMat = new THREE.MeshBasicMaterial({ color: core.color })
    const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16), coreMat)
    coreMesh.rotation.x = Math.PI / 2
    coreMesh.position.set(0, 1.1, 0.23)
    group.add(coreMesh)

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.4), bodyMat)
    head.position.y = 1.75
    head.castShadow = true
    group.add(head)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.1), coreMat)
    visor.position.set(0, 1.75, -0.2)
    group.add(visor)

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.14, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x181c24, metalness: 0.9 })
    )
    gun.position.set(0.36, 1.05, -0.45)
    group.add(gun)

    const shieldMat = new THREE.MeshLambertMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.35,
      wireframe: true
    })
    const shield = new THREE.Mesh(new THREE.SphereGeometry(1.4, 16, 12), shieldMat)
    shield.name = 'shield'
    shield.position.y = 1.1
    shield.visible = false
    group.add(shield)

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

  render(dt: number) {
    for (const c of this.clouds) {
      c.position.x += (c.userData as any).driftX * dt * 4
      c.position.z += (c.userData as any).driftZ * dt * 4
      if (c.position.x > 450) c.position.x = -450
      if (c.position.x < -450) c.position.x = 450
      if (c.position.z > 450) c.position.z = -450
      if (c.position.z < -450) c.position.z = 450
    }

    this.renderer.render(this.scene, this.camera)
  }

  destroy() {
    window.removeEventListener('resize', this.onResize)
    this.renderer.dispose()
  }
}

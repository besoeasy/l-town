import * as THREE from 'three'
import type { MapData, Box } from './map'
import type { PlayerState } from '../net/types'
import { CFG, CORE_DETAILS } from './config'

export class SceneRenderer {
  public scene: THREE.Scene
  public camera: THREE.PerspectiveCamera
  public renderer: THREE.WebGLRenderer
  private playerMeshes = new Map<number, THREE.Group>()
  private clouds: THREE.Mesh[] = []
  private animFrameId: number | null = null

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene()
    this.scene.fog = new THREE.FogExp2(0x1a2238, 0.00085)

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
    this.renderer.toneMappingExposure = 1.05

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

  private setupLighting() {
    const hemi = new THREE.HemisphereLight(0x7395b8, 0x1d202d, 0.6)
    this.scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xfff5e4, 1.2)
    sun.position.set(150, 240, 100)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 800
    sun.shadow.camera.left = -380
    sun.shadow.camera.right = 380
    sun.shadow.camera.top = 380
    sun.shadow.camera.bottom = -380
    sun.shadow.bias = -0.0004
    this.scene.add(sun)

    const ambient = new THREE.AmbientLight(0x232938, 0.4)
    this.scene.add(ambient)
  }

  private setupCosmos() {
    // Boreas planet in orbital sky
    const planetGeo = new THREE.SphereGeometry(65, 24, 24)
    const planetMat = new THREE.MeshLambertMaterial({ color: 0x4a1878, fog: false })
    const planet = new THREE.Mesh(planetGeo, planetMat)
    planet.position.set(-220, 140, -420)
    this.scene.add(planet)

    const ringGeo = new THREE.TorusGeometry(82, 5, 6, 48)
    const ringMat = new THREE.MeshLambertMaterial({
      color: 0x8a38c8,
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
    const palette = [0xffffff, 0xe4ecf8, 0xd0e0f0]
    for (let i = 0; i < 20; i++) {
      const cw = 120 + Math.random() * 220
      const ch = 30 + Math.random() * 60
      const mat = new THREE.MeshLambertMaterial({
        color: palette[Math.floor(Math.random() * palette.length)],
        transparent: true,
        opacity: 0.15 + Math.random() * 0.2,
        depthWrite: false,
        fog: false
      })
      const cloud = new THREE.Mesh(new THREE.PlaneGeometry(cw, ch), mat)
      cloud.position.set(
        (Math.random() - 0.5) * 800,
        90 + Math.random() * 70,
        (Math.random() - 0.5) * 800
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
    // Floor
    const floorGeo = new THREE.PlaneGeometry(map.floor.w, map.floor.d)
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x181c26,
      roughness: 0.85,
      metalness: 0.2
    })
    const floor = new THREE.Mesh(floorGeo, floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    // Group boxes by material for InstancedMesh high performance
    const materials: Record<string, THREE.Material> = {
      wall: new THREE.MeshStandardMaterial({ color: 0x2e3646, roughness: 0.9 }),
      house_body: new THREE.MeshStandardMaterial({ color: 0x3b4458, roughness: 0.8 }),
      house_window: new THREE.MeshStandardMaterial({
        color: 0x00f0ff,
        emissive: 0x00a0cc,
        emissiveIntensity: 0.6,
        roughness: 0.2
      }),
      platform: new THREE.MeshStandardMaterial({ color: 0x252b38, roughness: 0.85 }),
      cover: new THREE.MeshStandardMaterial({ color: 0x485268, roughness: 0.75 }),
      pillar: new THREE.MeshStandardMaterial({ color: 0x333b4c, roughness: 0.8 }),
      path: new THREE.MeshStandardMaterial({ color: 0x1f232e, roughness: 0.95 }),
      road_marking: new THREE.MeshBasicMaterial({ color: 0xffcc00 }),
      building: new THREE.MeshStandardMaterial({ color: 0x303746, roughness: 0.8 }),
      fountain_base: new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.7 }),
      fountain_rim: new THREE.MeshStandardMaterial({ color: 0x00f0ff, roughness: 0.5 }),
      fountain_pillar: new THREE.MeshStandardMaterial({ color: 0x334455 }),
      bench: new THREE.MeshStandardMaterial({ color: 0x5a483a }),
      lamp_post: new THREE.MeshStandardMaterial({ color: 0x1c212b, metalness: 0.7 }),
      lamp_head: new THREE.MeshBasicMaterial({ color: 0xffea88 }),
      bollard: new THREE.MeshStandardMaterial({ color: 0x2b3342 }),
      default: new THREE.MeshStandardMaterial({ color: 0x384152 })
    }

    const groups = new Map<string, Box[]>()
    for (const b of map.boxes) {
      const type = materials[b.type] ? b.type : 'default'
      let arr = groups.get(type)
      if (!arr) {
        arr = []
        groups.set(type, arr)
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
      if (p.id === localPlayerId) continue // Local player is camera
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

        // Shield visibility & color
        const shieldMesh = group.getObjectByName('shield') as THREE.Mesh
        if (shieldMesh) {
          shieldMesh.visible = p.shieldActive && Date.now() < p.shieldEnd
        }

        // Super glow
        const superMesh = group.getObjectByName('super') as THREE.Mesh
        if (superMesh) {
          superMesh.visible = p.superActive && Date.now() < p.superEnd
        }

        // Crouch scaling
        if (p.crouching) {
          group.scale.set(1, 0.65, 1)
        } else {
          group.scale.set(1, 1, 1)
        }
      }
    }

    // Clean up removed peers
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

    // Torso (Nanite Humanoid Shell)
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0x252a36,
      roughness: 0.4,
      metalness: 0.6
    })
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.1, 0.45), bodyMat)
    body.position.y = 0.9
    body.castShadow = true
    group.add(body)

    // Atma Core (Glowing chest soul)
    const coreMat = new THREE.MeshBasicMaterial({ color: core.color })
    const coreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.1, 16), coreMat)
    coreMesh.rotation.x = Math.PI / 2
    coreMesh.position.set(0, 1.1, 0.23)
    group.add(coreMesh)

    // Head with visor
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 0.4), bodyMat)
    head.position.y = 1.75
    head.castShadow = true
    group.add(head)

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.1), coreMat)
    visor.position.set(0, 1.75, -0.2)
    group.add(visor)

    // Weapon barrel
    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.14, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x111318, metalness: 0.9 })
    )
    gun.position.set(0.36, 1.05, -0.45)
    group.add(gun)

    // Shield bubble
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

    // Super glow halo
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
    // Drift clouds
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
    if (this.animFrameId) cancelAnimationFrame(this.animFrameId)
    window.removeEventListener('resize', this.onResize)
    this.renderer.dispose()
  }
}

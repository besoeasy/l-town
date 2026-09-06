import { CFG, type CoreId, CORE_DETAILS } from './config'
import { generateMap, type MapData } from './map'
import { createBoxGrid, resolveCollision, raycastPlayers } from './physics'
import { spawnBots, tickBots } from './bots'
import { sound } from './audio'
import type { SceneRenderer } from './scene'
import type { PlayerState, NetMessage, KillMsg, HitConfirmMsg } from '../net/types'
import { P2PHost, P2PClient } from '../net/webrtc'

export type GameMode = 'solo' | 'host' | 'client'

export interface GameCallbacks {
  onHudUpdate: (player: PlayerState, matchTime: number, hvtId: number | null) => void
  onHit: (amount: number) => void
  onHitConfirm: (msg: HitConfirmMsg) => void
  onKill: (msg: KillMsg) => void
  onLeaderboardUpdate: (leaderboard: { id: number; name: string; score: number }[]) => void
}

export class GameEngine {
  public localPlayer: PlayerState
  public players = new Map<number, PlayerState>()
  public map: MapData
  public nearbyBoxes: (x: number, z: number) => any[]
  public mode: GameMode = 'solo'
  public matchTime = CFG.MATCH_DURATION
  public isRunning = false
  public isPointerLocked = false

  private keys: Record<string, boolean> = {}
  private scene: SceneRenderer
  private callbacks: GameCallbacks
  private host: P2PHost | null = null
  private client: P2PClient | null = null
  private tickInterval: any = null
  private lastFrameTime = performance.now()
  private vy = 0
  private lastShotTime = 0
  private lastHitTime = 0
  private lastMoveTime = Date.now()
  private lastAbilityUsedAt = 0

  constructor(
    canvas: HTMLCanvasElement,
    scene: SceneRenderer,
    seed: number,
    callsign: string,
    character: CoreId,
    mode: GameMode,
    callbacks: GameCallbacks
  ) {
    this.scene = scene
    this.mode = mode
    this.callbacks = callbacks
    this.map = generateMap(seed)
    const { nearby } = createBoxGrid(this.map)
    this.nearbyBoxes = nearby
    this.scene.buildMapGeometry(this.map)

    const spawn = this.map.spawns[0] || { x: 0, y: 1.6, z: 0 }
    this.localPlayer = {
      id: 1,
      name: callsign || 'Anonymous',
      character,
      x: spawn.x,
      y: spawn.y,
      z: spawn.z,
      yaw: 0,
      pitch: 0,
      health: CFG.MAX_HEALTH,
      score: 0,
      alive: true,
      respawnAt: 0,
      crouching: false,
      superActive: false,
      superEnd: 0,
      shieldActive: false,
      shieldEnd: 0,
      invisible: false,
      lastAbilityAt: 0
    }
    this.players.set(1, this.localPlayer)

    this.setupInput(canvas)
  }

  setHostNetwork(host: P2PHost) {
    this.host = host
  }

  setClientNetwork(client: P2PClient) {
    this.client = client
  }

  start() {
    this.isRunning = true
    this.lastFrameTime = performance.now()

    if (this.mode === 'solo') {
      const bots = spawnBots(7, this.map)
      for (const b of bots) {
        this.players.set(b.id, b)
      }
    }

    if (this.mode === 'solo' || this.mode === 'host') {
      this.tickInterval = setInterval(() => this.authoritativeTick(), CFG.TICK_MS)
    }

    requestAnimationFrame(this.renderLoop)
  }

  private setupInput(canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true
      if (e.key.toLowerCase() === 'c') {
        this.toggleCrouch()
      } else if (e.key.toLowerCase() === 'q') {
        this.triggerClassAbility()
      } else if (e.key.toLowerCase() === 'e') {
        this.triggerSuper()
      } else if (e.key.toLowerCase() === 'r') {
        this.triggerShield()
      } else if (e.key === ' ') {
        this.triggerJump()
      }
    })

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false
    })

    window.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.localPlayer.yaw -= e.movementX * 0.0018
        this.localPlayer.pitch = Math.max(-1.45, Math.min(1.45, this.localPlayer.pitch - e.movementY * 0.0018))
      }
    })

    window.addEventListener('mousedown', (e) => {
      if (!document.pointerLockElement) {
        canvas.requestPointerLock?.()
        return
      }
      if (e.button === 0) {
        this.shoot()
      }
    })

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = !!document.pointerLockElement
    })
  }

  private toggleCrouch() {
    if (!this.localPlayer.alive) return
    this.localPlayer.crouching = !this.localPlayer.crouching
    if (!this.localPlayer.crouching) {
      this.lastMoveTime = Date.now()
      sound.stopRecharge()
    } else {
      sound.startRecharge()
    }
    if (this.mode === 'client') {
      this.client?.send({ type: 'crouch', state: this.localPlayer.crouching })
    }
  }

  private triggerJump() {
    if (!this.localPlayer.alive) return
    const onGround = this.isOnGround(this.localPlayer)
    if (!onGround) return

    // Check super jump
    if (this.keys['shift'] && this.localPlayer.health > CFG.SUPER_JUMP_COST) {
      this.localPlayer.health -= CFG.SUPER_JUMP_COST
      this.lastHitTime = Date.now()
      this.vy = CFG.SUPER_JUMP_SPEED
      sound.playSuperJump()
      if (this.mode === 'client') {
        this.client?.send({ type: 'jump_super' })
      }
    } else {
      this.vy = CFG.JUMP_SPEED
      if (this.mode === 'client') {
        this.client?.send({ type: 'jump' })
      }
    }
  }

  private triggerSuper() {
    if (!this.localPlayer.alive || this.localPlayer.superActive) return
    if (this.localPlayer.health >= CFG.SUPER_COST + 1) {
      this.localPlayer.health -= CFG.SUPER_COST
      this.localPlayer.superActive = true
      this.localPlayer.superEnd = Date.now() + CFG.SUPER_DURATION
      this.lastHitTime = Date.now()
      sound.playSuper()
      if (this.mode === 'client') {
        this.client?.send({ type: 'super' })
      }
    }
  }

  private triggerShield() {
    if (!this.localPlayer.alive || this.localPlayer.shieldActive) return
    if (this.localPlayer.health >= CFG.SHIELD_COST + 1) {
      this.localPlayer.health -= CFG.SHIELD_COST
      this.localPlayer.shieldActive = true
      this.localPlayer.shieldEnd = Date.now() + CFG.SHIELD_DURATION
      this.lastHitTime = Date.now()
      sound.playShield()
      if (this.mode === 'client') {
        this.client?.send({ type: 'shield' })
      }
    }
  }

  private triggerClassAbility() {
    if (!this.localPlayer.alive) return
    const now = Date.now()
    const core = CORE_DETAILS[this.localPlayer.character]
    if (core.cooldown > 0 && now - this.lastAbilityUsedAt < core.cooldown) return

    this.lastAbilityUsedAt = now
    this.localPlayer.lastAbilityAt = now
    sound.playAbility()

    if (this.mode === 'client') {
      this.client?.send({ type: 'classAbility' })
      return
    }

    // Host or Solo execution of class ability
    this.applyAbility(this.localPlayer)
  }

  private applyAbility(player: PlayerState) {
    const now = Date.now()
    switch (player.character) {
      case 'telepotu': {
        const enemies = [...this.players.values()].filter(p => p.alive && p.id !== player.id)
        if (enemies.length > 0) {
          const target = enemies[Math.floor(Math.random() * enemies.length)]
          const tmp = { x: player.x, y: player.y, z: player.z }
          player.x = target.x; player.y = target.y; player.z = target.z
          target.x = tmp.x; target.y = tmp.y; target.z = tmp.z
        }
        break
      }
      case 'chumantr':
        player.invisible = true
        setTimeout(() => { player.invisible = false }, 10000)
        break
      case 'denja':
        // Overdrive: handled via speed multiplier in tick
        break
      case 'mednix':
        player.health = Math.min(CFG.MAX_HEALTH, player.health + Math.floor(Math.random() * 50) + 1)
        break
      case 'tank':
        // Bulwark: half damage for 8s
        break
      case 'anchor':
        player.shieldActive = true
        player.shieldEnd = now + 3000
        break
      case 'surge': {
        const enemies = [...this.players.values()].filter(p => p.alive && p.id !== player.id)
        let nearest: PlayerState | null = null
        let minDist = 40
        for (const e of enemies) {
          const d = Math.hypot(e.x - player.x, e.z - player.z)
          if (d < minDist) {
            minDist = d
            nearest = e
          }
        }
        if (nearest) {
          const drain = Math.min(30, nearest.health - 1)
          nearest.health -= drain
          player.health = Math.min(CFG.MAX_HEALTH, player.health + drain)
        }
        break
      }
      case 'gambler': {
        const r = Math.random()
        if (r < 0.33) {
          player.health = Math.min(CFG.MAX_HEALTH, player.health + 200)
        } else if (r < 0.66) {
          const enemies = [...this.players.values()].filter(p => p.alive && p.id !== player.id)
          if (enemies.length) {
            const target = enemies[Math.floor(Math.random() * enemies.length)]
            player.x = target.x; player.y = target.y; player.z = target.z
          }
        } else {
          this.applyDamage(player.id, player.health, player.id)
        }
        break
      }
      case 'parasite':
      case 'berserker':
        break
    }
  }

  private shoot() {
    if (!this.localPlayer.alive || this.localPlayer.invisible) return
    const now = Date.now()
    if (now - this.lastShotTime < 80) return
    if (this.localPlayer.health <= CFG.SHOT_COST_SINGLE) return

    this.lastShotTime = now
    this.localPlayer.health -= CFG.SHOT_COST_SINGLE
    this.lastHitTime = now
    sound.playShoot(this.localPlayer.superActive)

    if (this.mode === 'client') {
      this.client?.send({ type: 'shoot' })
      return
    }

    // Host or Solo hitscan
    this.processShot(this.localPlayer)
  }

  private processShot(shooter: PlayerState) {
    const yaw = shooter.yaw, pitch = shooter.pitch
    const dx = -Math.cos(pitch) * Math.sin(yaw)
    const dy = Math.sin(pitch)
    const dz = -Math.cos(pitch) * Math.cos(yaw)
    const ox = shooter.x
    const oy = shooter.y + CFG.EYE_HEIGHT
    const oz = shooter.z

    const targets = [...this.players.values()].filter(p => p.id !== shooter.id && p.alive)
    const hit = raycastPlayers(shooter.id, ox, oy, oz, dx, dy, dz, targets, this.map)

    if (hit) {
      const distMult = Math.max(0.25, 1 - hit.t / 160)
      const superMult = shooter.superActive ? CFG.SUPER_MULT : 1
      const dmg = CFG.DMG_SINGLE * superMult * distMult
      this.applyDamage(hit.id, dmg, shooter.id)
    }
  }

  applyDamage(targetId: number, dmg: number, shooterId: number) {
    const target = this.players.get(targetId)
    if (!target || !target.alive) return

    if (target.shieldActive && Date.now() < target.shieldEnd) return
    if (target.character === 'tank' && Date.now() - target.lastAbilityAt < 8000) {
      dmg *= 0.5
    }

    target.health -= dmg
    target.respawnAt = 0

    const shooter = this.players.get(shooterId)
    if (target.id === 1) {
      sound.playHit()
      this.callbacks.onHit(Math.round(dmg))
    }
    if (shooter && shooter.id === 1) {
      sound.playHitConfirm(target.health <= 0)
      this.callbacks.onHitConfirm({
        type: 'hitConfirm',
        amount: Math.round(dmg),
        targetName: target.name,
        killed: target.health <= 0
      })
    }

    if (target.health <= 0) {
      target.health = 0
      target.alive = false
      target.respawnAt = Date.now() + CFG.RESPAWN_DELAY

      if (shooter) {
        shooter.score++
        shooter.health = Math.min(CFG.MAX_HEALTH, shooter.health + CFG.KILL_BONUS_HP)
      }

      const killMsg: KillMsg = {
        type: 'kill',
        shooterId,
        targetId,
        shooterName: shooter?.name || '?',
        targetName: target.name
      }
      this.callbacks.onKill(killMsg)

      if (target.id === 1) {
        sound.playDie()
      } else if (shooter?.id === 1) {
        sound.playKill()
      }

      // Jinx passive retaliation
      if (target.character === 'jinx' && shooter && shooter.alive && shooter.id !== target.id) {
        this.applyDamage(shooter.id, 80, target.id)
      }

      if (this.host) {
        this.host.broadcast(killMsg)
      }
    }
  }

  private authoritativeTick() {
    const now = Date.now()
    const dt = CFG.TICK_MS / 1000

    this.matchTime = Math.max(0, this.matchTime - dt)

    // Tick bots if in solo mode
    if (this.mode === 'solo') {
      const bots = [...this.players.values()].filter(p => p.isBot)
      const targets = [...this.players.values()].map(p => ({
        id: p.id, x: p.x, y: p.y, z: p.z, alive: p.alive
      }))
      tickBots(bots, targets, this.map, this.nearbyBoxes, dt, (bot, target) => {
        const dx = target.x - bot.x
        const dy = (target.y + 1.2) - (bot.y + 1.2)
        const dz = target.z - bot.z
        const len = Math.hypot(dx, dy, dz)
        if (len > 0) {
          const hit = raycastPlayers(bot.id, bot.x, bot.y + 1.2, bot.z, dx / len, dy / len, dz / len, targets, this.map)
          if (hit) {
            this.applyDamage(hit.id, CFG.DMG_SINGLE * 0.5, bot.id)
          }
        }
      })
    }

    // Health regen for players
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.respawnAt > 0 && now >= p.respawnAt) {
          const s = this.map.spawns[Math.floor(Math.random() * this.map.spawns.length)]
          p.x = s.x; p.y = s.y; p.z = s.z
          p.health = Math.floor(CFG.MAX_HEALTH * 0.75)
          p.alive = true
          p.respawnAt = 0
        }
        continue
      }

      if (now - (p.id === 1 ? this.lastHitTime : 0) > CFG.REGEN_DELAY) {
        const rate = (p.crouching ? 3 : 1) * CFG.REGEN_RATE * dt
        p.health = Math.min(CFG.MAX_HEALTH, p.health + rate)
      }

      if (p.superActive && now > p.superEnd) p.superActive = false
      if (p.shieldActive && now > p.shieldEnd) p.shieldActive = false
    }

    // Update leaderboard & HVT
    const ranked = [...this.players.values()].sort((a, b) => b.score - a.score)
    const leaderboard = ranked.slice(0, 5).map(p => ({ id: p.id, name: p.name, score: p.score }))
    const hvt = ranked.find(p => p.alive && p.score > 0) || null
    this.callbacks.onLeaderboardUpdate(leaderboard)

    // Broadcast state if hosting
    if (this.host) {
      const stateMsg: NetMessage = {
        type: 'gameState',
        tick: Math.floor(now / CFG.TICK_MS),
        matchTime: this.matchTime,
        playerCount: this.players.size,
        aliveCount: [...this.players.values()].filter(p => p.alive).length,
        highValueTargetId: hvt?.id || null,
        leaderboard,
        players: [...this.players.values()]
      }
      this.host.broadcast(stateMsg)
    }
  }

  private isOnGround(p: PlayerState): boolean {
    if (p.y <= 1.65) return true
    for (const box of this.nearbyBoxes(p.x, p.z)) {
      const bTop = box.y + box.h / 2
      const hw = box.w / 2 + CFG.PLAYER_RADIUS
      const hd = box.d / 2 + CFG.PLAYER_RADIUS
      if (Math.abs(p.y - bTop) < 0.15 && Math.abs(p.x - box.x) < hw && Math.abs(p.z - box.z) < hd) {
        return true
      }
    }
    return false
  }

  private renderLoop = (time: number) => {
    if (!this.isRunning) return
    const dt = Math.min(0.1, (time - this.lastFrameTime) / 1000)
    this.lastFrameTime = time

    if (this.localPlayer.alive) {
      // WASD movement calculation
      let mx = 0, mz = 0
      const yaw = this.localPlayer.yaw
      if (this.keys['w']) { mx -= Math.sin(yaw); mz -= Math.cos(yaw) }
      if (this.keys['s']) { mx += Math.sin(yaw); mz += Math.cos(yaw) }
      if (this.keys['a']) { mx += Math.sin(yaw - Math.PI / 2); mz += Math.cos(yaw - Math.PI / 2) }
      if (this.keys['d']) { mx += Math.sin(yaw + Math.PI / 2); mz += Math.cos(yaw + Math.PI / 2) }

      const len = Math.hypot(mx, mz)
      const isRunning = this.keys['shift']
      const speed = this.localPlayer.crouching
        ? CFG.CROUCH_SPEED
        : isRunning
        ? CFG.RUN_SPEED
        : CFG.PLAYER_SPEED

      if (len > 0) {
        mx = (mx / len) * speed * dt
        mz = (mz / len) * speed * dt
        const col = resolveCollision(this.localPlayer.x + mx, this.localPlayer.y, this.localPlayer.z + mz, this.map, this.nearbyBoxes)
        this.localPlayer.x = col.x
        this.localPlayer.z = col.z
        this.lastMoveTime = Date.now()
        sound.startFootsteps(isRunning)
      } else {
        sound.stopFootsteps()
      }

      // Vertical gravity & ground detection
      this.vy -= CFG.GRAVITY * dt
      this.localPlayer.y += this.vy * dt

      if (this.vy <= 0) {
        for (const box of this.nearbyBoxes(this.localPlayer.x, this.localPlayer.z)) {
          const bTop = box.y + box.h / 2
          const hw = box.w / 2 + CFG.PLAYER_RADIUS
          const hd = box.d / 2 + CFG.PLAYER_RADIUS
          if (this.localPlayer.y <= bTop && this.localPlayer.y >= bTop - 0.2 &&
              Math.abs(this.localPlayer.x - box.x) < hw && Math.abs(this.localPlayer.z - box.z) < hd) {
            this.localPlayer.y = bTop
            this.vy = 0
            break
          }
        }
      }

      if (this.localPlayer.y <= 1.6) {
        this.localPlayer.y = 1.6
        this.vy = 0
      }

      // Camera position
      const eyeH = this.localPlayer.crouching ? CFG.CROUCH_EYE_HEIGHT : CFG.EYE_HEIGHT
      this.scene.camera.position.set(this.localPlayer.x, this.localPlayer.y + eyeH, this.localPlayer.z)
      this.scene.camera.rotation.order = 'YXZ'
      this.scene.camera.rotation.y = this.localPlayer.yaw
      this.scene.camera.rotation.x = this.localPlayer.pitch

      // Send client input packet if connected as client
      if (this.mode === 'client') {
        this.client?.send({
          type: 'input',
          forward: !!this.keys['w'],
          back: !!this.keys['s'],
          left: !!this.keys['a'],
          right: !!this.keys['d'],
          run: isRunning,
          yaw: this.localPlayer.yaw,
          pitch: this.localPlayer.pitch,
          dt
        })
      }
    }

    // Update 3D scene players
    this.scene.updatePlayers([...this.players.values()], this.localPlayer.id)
    this.scene.render(dt)

    // Notify UI
    this.callbacks.onHudUpdate(this.localPlayer, this.matchTime, null)

    requestAnimationFrame(this.renderLoop)
  }

  handleNetworkMessage(msg: NetMessage, fromId?: number) {
    if (msg.type === 'gameState') {
      this.matchTime = msg.matchTime
      for (const p of msg.players) {
        if (p.id === this.localPlayer.id) {
          // Sync server-authoritative health, score, status
          this.localPlayer.health = p.health
          this.localPlayer.score = p.score
          this.localPlayer.alive = p.alive
          this.localPlayer.superActive = p.superActive
          this.localPlayer.shieldActive = p.shieldActive
        } else {
          this.players.set(p.id, p)
        }
      }
      this.callbacks.onLeaderboardUpdate(msg.leaderboard)
    } else if (msg.type === 'hit') {
      sound.playHit()
      this.callbacks.onHit(msg.amount)
    } else if (msg.type === 'hitConfirm') {
      sound.playHitConfirm(msg.killed)
      this.callbacks.onHitConfirm(msg)
    } else if (msg.type === 'kill') {
      this.callbacks.onKill(msg)
    } else if (msg.type === 'input' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      p.yaw = msg.yaw
      p.pitch = msg.pitch
      let mx = 0, mz = 0
      if (msg.forward) { mx -= Math.sin(p.yaw); mz -= Math.cos(p.yaw) }
      if (msg.back) { mx += Math.sin(p.yaw); mz += Math.cos(p.yaw) }
      if (msg.left) { mx += Math.sin(p.yaw - Math.PI / 2); mz += Math.cos(p.yaw - Math.PI / 2) }
      if (msg.right) { mx += Math.sin(p.yaw + Math.PI / 2); mz += Math.cos(p.yaw + Math.PI / 2) }
      const len = Math.hypot(mx, mz)
      if (len > 0) {
        const speed = p.crouching ? CFG.CROUCH_SPEED : msg.run ? CFG.RUN_SPEED : CFG.PLAYER_SPEED
        mx = (mx / len) * speed * msg.dt
        mz = (mz / len) * speed * msg.dt
        const col = resolveCollision(p.x + mx, p.y, p.z + mz, this.map, this.nearbyBoxes)
        p.x = col.x
        p.z = col.z
      }
    } else if (msg.type === 'shoot' && fromId && this.players.has(fromId)) {
      this.processShot(this.players.get(fromId)!)
    }
  }

  destroy() {
    this.isRunning = false
    if (this.tickInterval) clearInterval(this.tickInterval)
    sound.stopFootsteps()
    sound.stopRecharge()
    this.scene.destroy()
    this.host?.destroy()
    this.client?.destroy()
  }
}

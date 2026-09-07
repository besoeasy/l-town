import { CFG, type CoreId, CORE_DETAILS } from './config'
import { generateMap, type MapData } from './map'
import { createBoxGrid, resolveCollision, raycastPlayers } from './physics'
import { spawnBots, tickBots } from './bots'
import { sound } from './audio'
import type { SceneRenderer } from './scene'
import type { PlayerState, NetMessage, KillMsg, HitConfirmMsg, TelemetryData, MatchResults } from '../net/types'
import { P2PHost, P2PClient } from '../net/webrtc'

export type GameMode = 'solo' | 'host' | 'client'

export interface GameCallbacks {
  onHudUpdate: (
    player: PlayerState,
    matchTime: number,
    hvtId: number | null,
    telemetry: TelemetryData
  ) => void
  onHit: (amount: number) => void
  onHitConfirm: (msg: HitConfirmMsg) => void
  onKill: (msg: KillMsg) => void
  onLeaderboardUpdate: (leaderboard: { id: number; name: string; score: number; isBot?: boolean; ping?: number }[]) => void
  onMatchEnd: (results: MatchResults) => void
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
  public isGameOver = false
  public ping = 0
  public fps = 60

  private keys: Record<string, boolean> = {}
  private scene: SceneRenderer
  private callbacks: GameCallbacks
  private host: P2PHost | null = null
  private client: P2PClient | null = null
  private tickInterval: any = null
  private pingInterval: any = null
  private frameCount = 0
  private lastFpsUpdate = performance.now()
  private lastFrameTime = performance.now()
  private vy = 0
  private lastShotTime = 0
  private lastHitTime = 0
  private lastMoveTime = Date.now()
  private lastAbilityUsedAt = 0
  private isMouseHeld = false

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

    const openSpawns = this.map.spawns.filter(s => {
      const d = Math.hypot(s.x, s.z)
      return (d >= 40 && d <= 80) || d >= 240
    })
    const spawnPool = openSpawns.length > 0 ? openSpawns : this.map.spawns
    const spawn = spawnPool[Math.floor(Math.random() * spawnPool.length)] || { x: 0, y: 1.6, z: 50 }
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
    for (const [id] of host.peers) {
      if (!this.players.has(id)) {
        this.addRemotePlayer(id, `Pilot-${id}`, 'telepotu')
      }
    }
  }

  setClientNetwork(client: P2PClient) {
    this.client = client
    this.client.send({
      type: 'join',
      name: this.localPlayer.name,
      character: this.localPlayer.character
    })
  }

  onPeerConnected(peerId: number, name?: string, character?: CoreId) {
    if (!this.players.has(peerId)) {
      this.addRemotePlayer(peerId, name || `Pilot-${peerId}`, character || 'telepotu')
    }
  }

  onPeerDisconnected(peerId: number) {
    this.players.delete(peerId)
  }

  addRemotePlayer(id: number, name: string, character: CoreId) {
    const openSpawns = this.map.spawns.filter(s => {
      const d = Math.hypot(s.x, s.z)
      return (d >= 40 && d <= 80) || d >= 240
    })
    const spawnPool = openSpawns.length > 0 ? openSpawns : this.map.spawns
    const spawn = spawnPool[Math.floor(Math.random() * spawnPool.length)] || { x: 0, y: 1.6, z: 50 }
    const player: PlayerState = {
      id,
      name: name || `Pilot-${id}`,
      character: character || 'telepotu',
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
    this.players.set(id, player)
    console.log(`[Host Engine] Registered remote player ${id} (${player.name})`)
  }

  start() {
    this.isRunning = true
    this.isGameOver = false
    this.lastFrameTime = performance.now()
    this.lastFpsUpdate = performance.now()
    this.frameCount = 0

    if (this.mode === 'solo') {
      const bots = spawnBots(7, this.map)
      for (const b of bots) {
        this.players.set(b.id, b)
      }
    }

    if (this.mode === 'solo' || this.mode === 'host') {
      this.tickInterval = setInterval(() => this.authoritativeTick(), CFG.TICK_MS)
    }

    // Ping interval for WebRTC RTT tracking
    if (this.mode === 'client') {
      this.pingInterval = setInterval(() => {
        if (this.client?.isConnected) {
          this.client.send({ type: 'ping', t: performance.now() })
        }
      }, 1000)
    } else if (this.mode === 'host') {
      this.pingInterval = setInterval(() => {
        if (this.host && this.host.peers.size > 0) {
          this.host.broadcast({ type: 'ping', t: performance.now() })
        }
      }, 1000)
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
      if (e.button !== 0) return
      this.isMouseHeld = true
      if (!document.pointerLockElement) {
        canvas.requestPointerLock?.()
        return
      }
      this.shoot()
    })

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.isMouseHeld = false
      }
    })

    window.addEventListener('blur', () => {
      this.isMouseHeld = false
      this.keys = {}
    })

    document.addEventListener('pointerlockchange', () => {
      this.isPointerLocked = !!document.pointerLockElement
      if (!document.pointerLockElement) {
        this.isMouseHeld = false
      }
    })
  }

  private setCrouching(state: boolean) {
    if (!this.localPlayer.alive) return
    if (this.localPlayer.crouching === state) return
    this.localPlayer.crouching = state
    if (!state) {
      this.lastMoveTime = Date.now()
      sound.stopRecharge()
    } else {
      sound.startRecharge()
    }
    if (this.mode === 'client') {
      this.client?.send({ type: 'crouch', state })
    }
  }

  private toggleCrouch() {
    this.setCrouching(!this.localPlayer.crouching)
  }

  private triggerJump() {
    if (!this.localPlayer.alive || this.localPlayer.crouching) return
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
    if (!this.localPlayer.alive || this.localPlayer.superActive || this.localPlayer.invisible) return
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
    if (!this.localPlayer.alive || this.localPlayer.shieldActive || this.localPlayer.superActive || this.localPlayer.invisible) return
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
    if (!this.localPlayer.alive || this.localPlayer.superActive || this.localPlayer.invisible) return
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
        const enemies = [...this.players.values()].filter(p => {
          if (!p.alive || p.id === player.id || p.invisible) return false
          return Math.hypot(p.x - player.x, p.z - player.z) <= 120
        })
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
        const enemies = [...this.players.values()].filter(p => p.alive && p.id !== player.id && !p.invisible)
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
          if (drain > 0) {
            nearest.health -= drain
            player.health = Math.min(CFG.MAX_HEALTH, player.health + Math.min(15, drain))
          }
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
      case 'parasite': {
        // Leech Burst: 8/s off all strangers within 15u for 6s, kin (other parasites) immune, keeper gains half.
        let ticks = 0
        const leech = setInterval(() => {
          ticks++
          if (!player.alive || ticks > 6) {
            clearInterval(leech)
            return
          }
          let drainedTotal = 0
          for (const e of this.players.values()) {
            if (e.id === player.id || !e.alive || e.invisible || e.character === 'parasite') continue
            if (Math.hypot(e.x - player.x, e.z - player.z) > 15) continue
            const drain = Math.min(8, e.health - 1)
            if (drain > 0) {
              e.health -= drain
              drainedTotal += drain
            }
          }
          if (drainedTotal > 0) {
            player.health = Math.min(CFG.MAX_HEALTH, player.health + Math.floor(drainedTotal / 2))
          }
          if (ticks >= 6) clearInterval(leech)
        }, 1000)
        break
      }
      case 'berserker': {
        // Red Rage: +50% dmg / +25% speed handled via lastAbilityAt window. Burnout crash -50 after 8s.
        setTimeout(() => {
          if (player.alive) {
            this.applyDamage(player.id, 50, player.id)
          }
        }, 8000)
        break
      }
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

    const yaw = this.localPlayer.yaw, pitch = this.localPlayer.pitch
    const dx = -Math.cos(pitch) * Math.sin(yaw)
    const dy = Math.sin(pitch)
    const dz = -Math.cos(pitch) * Math.cos(yaw)
    const ox = this.localPlayer.x
    const oy = this.localPlayer.y + CFG.EYE_HEIGHT - 0.1
    const oz = this.localPlayer.z

    // 1. Robot hand recoil & muzzle flash
    this.scene.triggerShoot(this.localPlayer.superActive)

    // 2. Visible traveling energy packet
    this.scene.spawnProjectile(ox, oy, oz, dx, dy, dz, this.localPlayer.superActive)

    if (this.mode === 'client') {
      this.client?.send({ type: 'shoot', ox, oy, oz, dx, dy, dz })
      return
    }

    // Host or Solo hitscan
    this.processShot(this.localPlayer)

    if (this.host) {
      this.host.broadcast({
        type: 'projectile',
        ox, oy, oz,
        dx, dy, dz,
        shooterId: this.localPlayer.id,
        superActive: this.localPlayer.superActive
      })
    }
  }

  private processShot(shooter: PlayerState) {
    const yaw = shooter.yaw, pitch = shooter.pitch
    const dx = -Math.cos(pitch) * Math.sin(yaw)
    const dy = Math.sin(pitch)
    const dz = -Math.cos(pitch) * Math.cos(yaw)
    const ox = shooter.x
    const oy = shooter.y + CFG.EYE_HEIGHT
    const oz = shooter.z

    const targets = [...this.players.values()].filter(p => p.id !== shooter.id && p.alive && !p.invisible)
    const hit = raycastPlayers(shooter.id, ox, oy, oz, dx, dy, dz, targets, this.map)

    if (hit) {
      const distMult = Math.max(0.25, 1 - hit.t / 160)
      const superMult = shooter.superActive ? CFG.SUPER_MULT : 1
      const rageMult = shooter.character === 'berserker' && Date.now() - shooter.lastAbilityAt < 8000 ? 1.5 : 1
      const dmg = CFG.DMG_SINGLE * superMult * rageMult * distMult
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
        sound.stopRecharge()
      } else if (shooter?.id === 1) {
        sound.playKill()
      }

      // Jinx passive retaliation (60u range, fizzle if killer gone/dead)
      if (target.character === 'jinx' && shooter && shooter.alive && shooter.id !== target.id) {
        const dist = Math.hypot(shooter.x - target.x, shooter.z - target.z)
        if (dist <= 60) {
          this.applyDamage(shooter.id, 80, target.id)
        }
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
      const targets = [...this.players.values()]
        .filter(p => p.alive && !p.invisible)
        .map(p => ({
          id: p.id, x: p.x, y: p.y, z: p.z, alive: p.alive
        }))
      tickBots(bots, targets, this.map, this.nearbyBoxes, dt, (bot, target) => {
        const dx = target.x - bot.x
        const dy = (target.y + 1.2) - (bot.y + 1.2)
        const dz = target.z - bot.z
        const len = Math.hypot(dx, dy, dz)
        if (len > 0) {
          // Visible projectile for bot shot
          this.scene.spawnProjectile(bot.x, bot.y + 1.2, bot.z, dx / len, dy / len, dz / len, false)
          const hit = raycastPlayers(bot.id, bot.x, bot.y + 1.2, bot.z, dx / len, dy / len, dz / len, targets, this.map)
          if (hit) {
            const rageMult = bot.character === 'berserker' && Date.now() - bot.lastAbilityAt < 8000 ? 1.5 : 1
            this.applyDamage(hit.id, CFG.DMG_SINGLE * 0.5 * rageMult, bot.id)
          }
        }
      })
    }

    // Health regen for players
    for (const p of this.players.values()) {
      if (!p.alive) {
        if (p.respawnAt > 0 && now >= p.respawnAt) {
          const openSpawns = this.map.spawns.filter(s => {
            const d = Math.hypot(s.x, s.z)
            return (d >= 40 && d <= 80) || d >= 240
          })
          const spawnPool = openSpawns.length > 0 ? openSpawns : this.map.spawns
          const s = spawnPool[Math.floor(Math.random() * spawnPool.length)] || { x: 0, y: 1.6, z: 50 }
          p.x = s.x; p.y = s.y; p.z = s.z
          p.health = Math.floor(CFG.MAX_HEALTH * 0.75)
          p.alive = true
          p.respawnAt = 0
          p.crouching = false
          if (p.id === this.localPlayer.id) {
            this.lastMoveTime = Date.now()
            sound.stopRecharge()
          }
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
    const leaderboard = ranked.slice(0, 5).map(p => ({
      id: p.id,
      name: p.name,
      score: p.score,
      isBot: p.isBot,
      ping: p.ping || (p.id === this.localPlayer.id ? (this.mode === 'solo' ? 0 : this.ping) : 0)
    }))
    const hvt = ranked.find(p => p.alive && p.score > 0) || null
    this.callbacks.onLeaderboardUpdate(leaderboard)

    if (this.matchTime <= 0 && !this.isGameOver) {
      this.finishMatch()
    }

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

  public finishMatch() {
    if (this.isGameOver) return
    this.isGameOver = true
    document.exitPointerLock?.()

    const ranked = [...this.players.values()].sort((a, b) => b.score - a.score)
    const winner = ranked[0]
    const localRank = ranked.findIndex(p => p.id === this.localPlayer.id) + 1

    const results: MatchResults = {
      rank: localRank > 0 ? localRank : 1,
      totalPlayers: this.players.size,
      winnerName: winner ? winner.name : this.localPlayer.name,
      winnerScore: winner ? winner.score : this.localPlayer.score,
      playerScore: this.localPlayer.score,
      isWinner: winner ? winner.id === this.localPlayer.id : true,
      leaderboard: ranked.map(p => ({
        id: p.id,
        name: p.name,
        score: p.score,
        isBot: p.isBot,
        ping: p.ping || (p.id === this.localPlayer.id ? (this.mode === 'solo' ? 0 : this.ping) : 0)
      }))
    }

    if (this.host) {
      this.host.broadcast({
        type: 'matchEnd',
        winnerId: winner?.id || 1,
        winnerName: winner?.name || 'Pilot',
        winnerScore: winner?.score || 0
      })
    }

    this.callbacks.onMatchEnd(results)
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
      // Crouched players are stationary: any WASD input stands back up first
      const wantsMove = !!this.keys['w'] || !!this.keys['s'] || !!this.keys['a'] || !!this.keys['d']
      if (this.localPlayer.crouching && wantsMove) {
        this.setCrouching(false)
      }

      // WASD movement calculation (skipped entirely while crouched)
      let mx = 0, mz = 0
      const yaw = this.localPlayer.yaw
      if (!this.localPlayer.crouching) {
        if (this.keys['w']) { mx -= Math.sin(yaw); mz -= Math.cos(yaw) }
        if (this.keys['s']) { mx += Math.sin(yaw); mz += Math.cos(yaw) }
        if (this.keys['a']) { mx += Math.sin(yaw - Math.PI / 2); mz += Math.cos(yaw - Math.PI / 2) }
        if (this.keys['d']) { mx += Math.sin(yaw + Math.PI / 2); mz += Math.cos(yaw + Math.PI / 2) }
      }

      const len = Math.hypot(mx, mz)
      const isRunning = this.keys['shift']
      let speed = isRunning
        ? CFG.RUN_SPEED
        : CFG.PLAYER_SPEED

      if (this.localPlayer.superActive) {
        speed *= 2.0
      }
      const rageNow = Date.now()
      if (this.localPlayer.character === 'denja' && rageNow - this.localPlayer.lastAbilityAt < 8000) {
        speed *= 2.0
      }
      if (this.localPlayer.character === 'berserker' && rageNow - this.localPlayer.lastAbilityAt < 8000) {
        speed *= 1.25
      }

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
        // Auto-crouch after 5s of no WASD movement
        if (!this.localPlayer.crouching && Date.now() - this.lastMoveTime > CFG.AUTO_CROUCH_MS) {
          this.setCrouching(true)
        }
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

      // Hold-to-fire: works while stationary or moving (shoot() rate-limits via lastShotTime)
      if (this.isMouseHeld && document.pointerLockElement) {
        this.shoot()
      }

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
    const isMoving = this.localPlayer.alive && (!!this.keys['w'] || !!this.keys['s'] || !!this.keys['a'] || !!this.keys['d'])
    this.scene.render(dt, isMoving, this.localPlayer.superActive, this.localPlayer.shieldActive)

    // Calculate rolling FPS
    this.frameCount++
    if (time - this.lastFpsUpdate >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (time - this.lastFpsUpdate))
      this.frameCount = 0
      this.lastFpsUpdate = time
    }

    const humanCount = [...this.players.values()].filter(p => !p.isBot).length
    const botCount = [...this.players.values()].filter(p => p.isBot).length

    const telemetry: TelemetryData = {
      ping: this.mode === 'solo' ? 0 : this.ping,
      fps: this.fps,
      connectedPlayers: this.players.size,
      humanPlayers: humanCount,
      botPlayers: botCount,
      mode: this.mode,
      tickRate: 20
    }

    // Check match completion in render loop
    if (this.matchTime <= 0 && !this.isGameOver) {
      this.finishMatch()
    }

    // Notify UI
    this.callbacks.onHudUpdate(this.localPlayer, this.matchTime, null, telemetry)

    requestAnimationFrame(this.renderLoop)
  }

  handleNetworkMessage(msg: NetMessage, fromId?: number) {
    if (msg.type === 'gameState') {
      this.matchTime = msg.matchTime
      if (this.matchTime <= 0 && !this.isGameOver) {
        this.finishMatch()
      }
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
      // Crouched remotes are stationary until they send uncrouch
      if (p.crouching) return
      let mx = 0, mz = 0
      if (msg.forward) { mx -= Math.sin(p.yaw); mz -= Math.cos(p.yaw) }
      if (msg.back) { mx += Math.sin(p.yaw); mz += Math.cos(p.yaw) }
      if (msg.left) { mx += Math.sin(p.yaw - Math.PI / 2); mz += Math.cos(p.yaw - Math.PI / 2) }
      if (msg.right) { mx += Math.sin(p.yaw + Math.PI / 2); mz += Math.cos(p.yaw + Math.PI / 2) }
      const len = Math.hypot(mx, mz)
      if (len > 0) {
        let speed = msg.run ? CFG.RUN_SPEED : CFG.PLAYER_SPEED
        if (p.superActive) {
          speed *= 2.0
        }
        const rn = Date.now()
        if (p.character === 'denja' && rn - p.lastAbilityAt < 8000) {
          speed *= 2.0
        }
        if (p.character === 'berserker' && rn - p.lastAbilityAt < 8000) {
          speed *= 1.25
        }
        mx = (mx / len) * speed * msg.dt
        mz = (mz / len) * speed * msg.dt
        const col = resolveCollision(p.x + mx, p.y, p.z + mz, this.map, this.nearbyBoxes)
        p.x = col.x
        p.z = col.z
      }
    } else if (msg.type === 'shoot' && fromId && this.players.has(fromId)) {
      const shooter = this.players.get(fromId)!
      if (!shooter.alive || shooter.invisible) return
      if (shooter.health <= CFG.SHOT_COST_SINGLE) return
      shooter.health -= CFG.SHOT_COST_SINGLE
      this.processShot(shooter)
      const yaw = shooter.yaw, pitch = shooter.pitch
      const dx = msg.dx ?? (-Math.cos(pitch) * Math.sin(yaw))
      const dy = msg.dy ?? Math.sin(pitch)
      const dz = msg.dz ?? (-Math.cos(pitch) * Math.cos(yaw))
      const ox = msg.ox ?? shooter.x
      const oy = msg.oy ?? (shooter.y + CFG.EYE_HEIGHT - 0.1)
      const oz = msg.oz ?? shooter.z

      // Host spawns projectile so host can see remote shot
      this.scene.spawnProjectile(ox, oy, oz, dx, dy, dz, shooter.superActive)

      // Host broadcasts to all other clients
      if (this.host) {
        this.host.broadcast({
          type: 'projectile',
          ox, oy, oz,
          dx, dy, dz,
          shooterId: shooter.id,
          superActive: shooter.superActive
        }, fromId)
      }
    } else if (msg.type === 'projectile') {
      this.scene.spawnProjectile(msg.ox, msg.oy, msg.oz, msg.dx, msg.dy, msg.dz, msg.superActive)
    } else if (msg.type === 'ping') {
      if (this.mode === 'client') {
        this.client?.send({ type: 'pong', t: msg.t })
      } else if (this.mode === 'host' && fromId) {
        this.host?.sendTo(fromId, { type: 'pong', t: msg.t, fromId })
      }
    } else if (msg.type === 'pong') {
      const rtt = Math.max(1, Math.round(performance.now() - msg.t))
      this.ping = this.ping ? Math.round(this.ping * 0.7 + rtt * 0.3) : rtt
      if (fromId && this.players.has(fromId)) {
        this.players.get(fromId)!.ping = rtt
      }
    } else if (msg.type === 'matchEnd') {
      this.finishMatch()
    } else if (msg.type === 'welcome') {
      this.localPlayer.id = msg.playerId
      console.log(`[Client] Received welcome packet. Assigned player ID: ${msg.playerId}`)
      this.client?.send({
        type: 'join',
        name: this.localPlayer.name,
        character: this.localPlayer.character
      })
    } else if (msg.type === 'join' && fromId) {
      const p = this.players.get(fromId)
      if (p) {
        p.name = msg.name
        p.character = msg.character
      } else {
        this.addRemotePlayer(fromId, msg.name, msg.character)
      }
    } else if (msg.type === 'super' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (p.alive && !p.superActive && !p.invisible && p.health >= CFG.SUPER_COST + 1) {
        p.health -= CFG.SUPER_COST
        p.superActive = true
        p.superEnd = Date.now() + CFG.SUPER_DURATION
      }
    } else if (msg.type === 'shield' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (p.alive && !p.shieldActive && !p.superActive && !p.invisible && p.health >= CFG.SHIELD_COST + 1) {
        p.health -= CFG.SHIELD_COST
        p.shieldActive = true
        p.shieldEnd = Date.now() + CFG.SHIELD_DURATION
      }
    } else if (msg.type === 'classAbility' && fromId && this.players.has(fromId)) {
      const p = this.players.get(fromId)!
      if (p.alive && !p.superActive && !p.invisible) {
        p.lastAbilityAt = Date.now()
        this.applyAbility(p)
      }
    } else if (msg.type === 'crouch' && fromId && this.players.has(fromId)) {
      this.players.get(fromId)!.crouching = msg.state
    }
  }

  destroy() {
    this.isRunning = false
    if (this.tickInterval) clearInterval(this.tickInterval)
    if (this.pingInterval) clearInterval(this.pingInterval)
    sound.stopFootsteps()
    sound.stopRecharge()
    this.scene.destroy()
    this.host?.destroy()
    this.client?.destroy()
  }
}

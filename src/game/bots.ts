import { CFG, type CoreId, CORE_IDS } from './config'
import type { MapData } from './map'
import { groundHeight } from './map'
import type { PlayerState, NaniteCache } from '../net/types'
import { resolveCollision } from './physics'

export function spawnBots(count: number, map: MapData): PlayerState[] {
  const bots: PlayerState[] = []
  for (let i = 0; i < count; i++) {
    const s = map.spawns[Math.floor(Math.random() * map.spawns.length)] || { x: (i - count / 2) * 10, y: 1.6, z: 20 }
    const core = CORE_IDS[(i + 1) % CORE_IDS.length]
    bots.push({
      id: 1000 + i,
      name: `RX11-BOT-${i + 1}`,
      character: core,
      x: s.x,
      y: s.y,
      z: s.z,
      yaw: Math.random() * Math.PI * 2,
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
      lastAbilityAt: 0,
      isBot: true
    })
  }
  return bots
}

export function tickBots(
  bots: PlayerState[],
  targets: { id: number; x: number; y: number; z: number; alive: boolean }[],
  map: MapData,
  nearby: (x: number, z: number) => any[],
  dt: number,
  onBotShoot?: (bot: PlayerState, target: { id: number; x: number; y: number; z: number }) => void,
  caches?: NaniteCache[]
) {
  const now = Date.now()
  for (const bot of bots) {
    if (!bot.alive) {
      if (bot.respawnAt > 0 && now >= bot.respawnAt) {
        const s = map.spawns[Math.floor(Math.random() * map.spawns.length)]
        bot.x = s.x
        bot.y = s.y
        bot.z = s.z
        bot.yaw = Math.random() * Math.PI * 2
        bot.health = CFG.MAX_HEALTH
        bot.alive = true
        bot.respawnAt = 0
      }
      continue
    }

    // Check for nearby dropped nanite caches to scavenge if damaged
    let nearestCache: NaniteCache | null = null
    if (caches && caches.length > 0 && bot.health < CFG.MAX_HEALTH) {
      let minCacheDist = 30
      for (const c of caches) {
        const d = Math.hypot(c.x - bot.x, c.z - bot.z)
        if (d < minCacheDist) {
          minCacheDist = d
          nearestCache = c
        }
      }
    }

    // Find nearest alive enemy target
    let nearest: { id: number; x: number; y: number; z: number } | null = null
    let minDist = Infinity
    for (const t of targets) {
      if (t.id === bot.id || !t.alive) continue
      const dist = Math.hypot(t.x - bot.x, t.z - bot.z)
      if (dist < minDist) {
        minDist = dist
        nearest = t
      }
    }

    // If critically damaged and a cache is nearby, prioritize salvaging the cache
    if (nearestCache && (bot.health < 250 || !nearest || minDist > 25)) {
      const dx = nearestCache.x - bot.x
      const dz = nearestCache.z - bot.z
      const desiredYaw = Math.atan2(-dx, -dz)
      bot.yaw += (desiredYaw - bot.yaw) * 0.25
      const mx = -Math.sin(bot.yaw) * CFG.PLAYER_SPEED * 0.9 * dt
      const mz = -Math.cos(bot.yaw) * CFG.PLAYER_SPEED * 0.9 * dt
      const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
      bot.x = col.x
      bot.z = col.z
    } else if (nearest && minDist < 60) {
      // Aim at target
      const dx = nearest.x - bot.x
      const dz = nearest.z - bot.z
      const desiredYaw = Math.atan2(-dx, -dz)
      bot.yaw += (desiredYaw - bot.yaw) * 0.1

      // Move toward or strafe
      if (minDist > 12) {
        const mx = -Math.sin(bot.yaw) * CFG.PLAYER_SPEED * 0.8 * dt
        const mz = -Math.cos(bot.yaw) * CFG.PLAYER_SPEED * 0.8 * dt
        const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
        bot.x = col.x
        bot.z = col.z
      } else {
        // Strafe
        const strafe = (Math.sin(now * 0.003 + bot.id) > 0 ? 1 : -1) * CFG.PLAYER_SPEED * 0.6 * dt
        const mx = Math.cos(bot.yaw) * strafe
        const mz = -Math.sin(bot.yaw) * strafe
        const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
        bot.x = col.x
        bot.z = col.z
      }

      // Random bot shooting
      if (Math.random() < 0.04 && onBotShoot) {
        onBotShoot(bot, nearest)
      }
    } else if (nearestCache) {
      // No combat target, navigate to scavenge cache
      const dx = nearestCache.x - bot.x
      const dz = nearestCache.z - bot.z
      const desiredYaw = Math.atan2(-dx, -dz)
      bot.yaw += (desiredYaw - bot.yaw) * 0.15
      const mx = -Math.sin(bot.yaw) * CFG.PLAYER_SPEED * 0.6 * dt
      const mz = -Math.cos(bot.yaw) * CFG.PLAYER_SPEED * 0.6 * dt
      const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
      bot.x = col.x
      bot.z = col.z
    } else {
      // Idle wander
      bot.yaw += (Math.random() - 0.5) * 0.1
      const mx = -Math.sin(bot.yaw) * CFG.PLAYER_SPEED * 0.3 * dt
      const mz = -Math.cos(bot.yaw) * CFG.PLAYER_SPEED * 0.3 * dt
      const col = resolveCollision(bot.x + mx, bot.y, bot.z + mz, map, nearby)
      bot.x = col.x
      bot.z = col.z
    }

    // Follow the rolling terrain
    bot.y = groundHeight(bot.x, bot.z, map.seed) + 1.6
  }
}

// 3049 Remote Age — Canon specifications from lore.md & commit e392b58b6b4981ece32cff242cbda5a07fceb0f4
export const CFG = {
  TICK_MS: 50,              // 20 Hz simulation
  MATCH_DURATION: 600,      // 10 minutes (seconds)
  MAX_PLAYERS: 16,          // WebRTC P2P mesh room limit
  VIS_RADIUS: 120,          // Distance culling limit
  PLAYER_SPEED: 9,          // units/sec base walk speed
  RUN_SPEED: 15,            // units/sec sprint
  CROUCH_SPEED: 0,          // units/sec while crouched (stationary lock)
  PLAYER_RADIUS: 0.45,
  PLAYER_HEIGHT: 2.3,
  EYE_HEIGHT: 1.95,
  CROUCH_EYE_HEIGHT: 0.85,
  AUTO_CROUCH_MS: 5000,     // Auto-crouch after 5s of no movement
  MAX_HEALTH: 500,          // Hull = nanite census (lore.md:23)
  REGEN_DELAY: 2000,        // Calm period before hull regen starts
  REGEN_RATE: 2,            // 2 nanites regenerated per second (base)
  SHOT_COST_SINGLE: 2,      // Nanite mass spent per single shot
  CHARGE_MAX: 4,            // Max charge shot bursts
  SUPER_COST: 50,           // Nanite mass spent to trigger Super overclock
  SUPER_DURATION: 10000,    // 10s Super duration
  RESPAWN_DELAY: 7000,      // 7s reprint delay
  NANITE_CACHE_AMOUNT: 100, // Nanite cache dropped on death
  NANITE_CACHE_RADIUS: 5.0, // Pickup radius in world units
  JUMP_SPEED: 18,           // Base vertical jump velocity
  GRAVITY: 32,              // Gravity units/sec^2
  SUPER_JUMP_SPEED: 44,     // High jump velocity (~10x height)
  SUPER_JUMP_COST: 20,      // Nanite mass spent per Super Jump
  DMG_SINGLE: 20,           // Base hitscan damage
  SUPER_MULT: 3,            // 3x damage multiplier while Super is active
  SHIELD_COST: 80,          // Nanite mass spent to deploy shield
  SHIELD_DURATION: 10000,   // 10s damage immunity
  RECONNECT_GRACE_MS: 15000,// 15s grace for reconnect
} as const

export const CHASSIS = {
  hull: CFG.MAX_HEALTH,
  speed: CFG.PLAYER_SPEED,
  superCost: CFG.SUPER_COST,
  shieldCost: CFG.SHIELD_COST,
} as const

export type CoreId =
  | 'telepotu'
  | 'chumantr'
  | 'denja'
  | 'mednix'
  | 'tank'
  | 'anchor'
  | 'surge'
  | 'jinx'
  | 'gambler'
  | 'parasite'
  | 'berserker'

export interface CoreInfo {
  id: CoreId
  name: string
  maker: string
  ability: string
  cooldown: number // ms, -1 for passive
  color: string
  badge: string
  desc: string
  lore: string
}

export const CORE_DETAILS: Record<CoreId, CoreInfo> = {
  telepotu: {
    id: 'telepotu',
    name: 'Telepotu',
    maker: 'Vela Relay Compact',
    ability: 'Warp Logistics',
    cooldown: 60000,
    color: '#00f0ff',
    badge: '⚡',
    desc: 'Swaps positions with a random alive enemy within 120 units. Fizzles on no target.',
    lore: 'Escape tool developed for orbital cave-ins and freight ambushes.'
  },
  chumantr: {
    id: 'chumantr',
    name: 'Chumantr',
    maker: 'Pale Choir',
    ability: 'Stealth Cloak',
    cooldown: 30000,
    color: '#a855f7',
    badge: '👻',
    desc: 'Full ghost for 10s: move only, no shoot or abilities.',
    lore: 'Survey sneak algorithm designed by cult ghosts for hostile surface scans.'
  },
  denja: {
    id: 'denja',
    name: 'Denja',
    maker: 'Kuro Racer Syndicate',
    ability: 'Overdrive',
    cooldown: 30000,
    color: '#f97316',
    badge: '🔥',
    desc: 'Overclocks chassis mobility to 2× speed for 8s.',
    lore: 'Pit-racer governor removal burst; burns raw nanite conduits.'
  },
  mednix: {
    id: 'mednix',
    name: 'Mednix',
    maker: 'Helix Med-Corps',
    ability: 'Field Repair',
    cooldown: 20000,
    color: '#10b981',
    badge: '💊',
    desc: 'Recycles waste heat to restore 1–50 Hull immediately.',
    lore: 'Rapid field fabrication protocol from frontline orbital trauma units.'
  },
  tank: {
    id: 'tank',
    name: 'Tank',
    maker: 'Bastion Siege Foundry',
    ability: 'Bulwark',
    cooldown: 35000,
    color: '#3b82f6',
    badge: '🛡️',
    desc: 'Reinforces nanite density: 50% damage reduction for 8s.',
    lore: 'Siege barrier architecture capable of withstanding direct kinetic strikes.'
  },
  anchor: {
    id: 'anchor',
    name: 'Anchor',
    maker: 'Orbital Guard',
    ability: 'Aegis',
    cooldown: 40000,
    color: '#06b6d4',
    badge: '⚓',
    desc: 'Deploys a pre-charged cell for 3s of full immunity with 0 Hull cost.',
    lore: 'Standard military guard cell designed for breaching hot drop zones.'
  },
  surge: {
    id: 'surge',
    name: 'Surge',
    maker: 'Deep Vein Mining Guild',
    ability: 'Siphon Field',
    cooldown: 25000,
    color: '#eab308',
    badge: '🌀',
    desc: 'Rips 30 Hull off nearest enemy in 40u, keeps 15. Fizzles on no target.',
    lore: 'Adapted from magnetic slag extractors used in deep core mining.'
  },
  jinx: {
    id: 'jinx',
    name: 'Jinx',
    maker: 'Black Lotus AI Lab',
    ability: 'Death Curse',
    cooldown: -1,
    color: '#ec4899',
    badge: '💀',
    desc: 'Passive: killer within 60u takes 80 Hull on your death.',
    lore: 'Black-box retaliation firmware with copied consciousness mind-loop.'
  },
  gambler: {
    id: 'gambler',
    name: 'Gambler',
    maker: 'Vesper Casino-State',
    ability: 'Desperate Odds',
    cooldown: 45000,
    color: '#f59e0b',
    badge: '🎲',
    desc: 'Rolls the dice: 1/3 heal +200 Hull, 1/3 teleport onto enemy, 1/3 instant death.',
    lore: 'High-variance algorithmic betting core favored by outer rim thrill-seekers.'
  },
  parasite: {
    id: 'parasite',
    name: 'Parasite',
    maker: 'Green Hive',
    ability: 'Leech Burst',
    cooldown: 30000,
    color: '#84cc16',
    badge: '🧫',
    desc: 'Drains 8/s off strangers in 15u for 6s, keeps half. Parasite kin immune.',
    lore: 'Ecological swarm leech that consumes alien nanite alloys on contact.'
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    maker: 'Red Pit Fighters',
    ability: 'Red Rage',
    cooldown: 35000,
    color: '#ef4444',
    badge: '🔴',
    desc: '+50% damage and +25% speed 8s, then burnout -50 Hull.',
    lore: 'Chemical overclock for chassis while pilot neural link stays cool.'
  },
}

export const CORE_IDS: CoreId[] = Object.keys(CORE_DETAILS) as CoreId[]

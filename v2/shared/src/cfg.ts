// Shared cfg — single source, lore-canon RX-11 chassis fixed by charter
export const CFG = {
  TICK_MS: 50,
  MATCH_DURATION: 600,
  MAX_PLAYERS: 300,
  VIS_RADIUS: 120,
  PLAYER_SPEED: 9,
  RUN_SPEED: 15,
  CROUCH_SPEED: 4,
  PLAYER_RADIUS: 0.45,
  PLAYER_HEIGHT: 2.3,
  EYE_HEIGHT: 1.95,
  CROUCH_EYE_HEIGHT: 0.85,
  AUTO_CROUCH_MS: 10000,
  MAX_HEALTH: 500, // hull = nanite census (lore.md:23)
  REGEN_DELAY: 2000,
  SHOT_COST_SINGLE: 2,
  CHARGE_MAX: 4,
  SUPER_COST: 50,
  SUPER_DURATION: 10000,
  RESPAWN_DELAY: 7000,
  KILL_BONUS_HP: 100,
  JUMP_SPEED: 18,
  GRAVITY: 32,
  SUPER_JUMP_SPEED: 44,
  SUPER_JUMP_COST: 20,
  DMG_SINGLE: 20,
  SUPER_MULT: 3,
  SHIELD_COST: 80,
  SHIELD_DURATION: 10000,
  RECONNECT_GRACE_MS: 15000,
} as const

export const CHASSIS = {
  hull: CFG.MAX_HEALTH,
  speed: CFG.PLAYER_SPEED,
  superCost: CFG.SUPER_COST,
  shieldCost: CFG.SHIELD_COST,
} as const

export type CoreId = 'telepotu'|'chumantr'|'denja'|'mednix'|'tank'|'anchor'|'surge'|'jinx'|'gambler'|'parasite'|'berserker'
export const CORE_IDS: CoreId[] = ['telepotu','chumantr','denja','mednix','tank','anchor','surge','jinx','gambler','parasite','berserker']
export const CORE_CD: Record<CoreId, number> = {
  telepotu:60000, chumantr:30000, denja:30000, mednix:20000, tank:35000, anchor:40000, surge:25000, jinx:-1, gambler:45000, parasite:30000, berserker:35000
}
// Lore Makers
export const CORE_MAKER: Record<CoreId, string> = {
  telepotu: 'Meridian Transit Cartel',
  chumantr: 'Pale Choir',
  denja: 'Kuro Racer Syndicate',
  mednix: 'Helix Med-Corps',
  tank: 'Bastion Siege Foundry',
  anchor: 'Orbital Guard',
  surge: 'Deep Vein Mining Guild',
  jinx: 'Black Lotus AI Lab',
  gambler: 'Vesper Casino-State',
  parasite: 'Green Hive',
  berserker: 'Red Pit Fighters',
}

import type { CoreId } from '../game/config'

export interface PlayerState {
  id: number
  name: string
  character: CoreId
  x: number
  y: number
  z: number
  yaw: number
  pitch: number
  health: number
  score: number
  alive: boolean
  respawnAt: number
  crouching: boolean
  superActive: boolean
  superEnd: number
  shieldActive: boolean
  shieldEnd: number
  invisible: boolean
  lastAbilityAt: number
  isBot?: boolean
}

export interface GameStateMsg {
  type: 'gameState'
  tick: number
  matchTime: number
  playerCount: number
  aliveCount: number
  highValueTargetId: number | null
  leaderboard: { id: number; name: string; score: number }[]
  players: PlayerState[]
}

export interface InputMsg {
  type: 'input'
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  run: boolean
  yaw: number
  pitch: number
  dt: number
}

export interface ShootMsg {
  type: 'shoot'
}

export interface ChargedShootMsg {
  type: 'chargedShoot'
  count: number
}

export interface AbilityMsg {
  type: 'classAbility'
}

export interface SuperMsg {
  type: 'super'
}

export interface ShieldMsg {
  type: 'shield'
}

export interface JumpMsg {
  type: 'jump'
}

export interface SuperJumpMsg {
  type: 'jump_super'
}

export interface CrouchMsg {
  type: 'crouch'
  state: boolean
}

export interface HitMsg {
  type: 'hit'
  amount: number
}

export interface HitConfirmMsg {
  type: 'hitConfirm'
  amount: number
  targetName: string
  killed: boolean
}

export interface KillMsg {
  type: 'kill'
  shooterId: number
  targetId: number
  shooterName: string
  targetName: string
}

export interface TeleportedMsg {
  type: 'teleported'
  x: number
  y: number
  z: number
  targetName: string
}

export interface WelcomeMsg {
  type: 'welcome'
  playerId: number
  seed: number
  hostId: number
}

export type NetMessage =
  | GameStateMsg
  | InputMsg
  | ShootMsg
  | ChargedShootMsg
  | AbilityMsg
  | SuperMsg
  | ShieldMsg
  | JumpMsg
  | SuperJumpMsg
  | CrouchMsg
  | HitMsg
  | HitConfirmMsg
  | KillMsg
  | TeleportedMsg
  | WelcomeMsg

export interface NostrRoom {
  id: string
  name: string
  seed: number
  core: CoreId
  players: number
  maxPlayers: number
  createdAt: number
  pubkey: string
  relay?: string
}

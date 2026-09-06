import type { CoreId } from './cfg.js'
export type Vec3 = { x:number; y:number; z:number }
export type PlayerSnapshot = {
  id:number; name:string; character:CoreId
  x:number; y:number; z:number; yaw:number; pitch:number
  health:number; score:number; alive:boolean; respawnAt:number; crouching:boolean
  superActive:boolean; superEnd:number; shieldActive:boolean; shieldEnd:number
  invisible:boolean; lastAbilityAt:number
}
export type GameStateMsg = {
  type:'gameState'
  matchTime:number; playerCount:number; aliveCount:number; maxPlayers:number
  highValueTargetId:number|null; leaderboard:{id:number;name:string;score:number}[]
  players:PlayerSnapshot[]
}
export type WelcomeMsg = { type:'welcome'; playerId:number; seed:number; cfg:typeof import('./cfg.js').CFG; reconnectToken:string; graceMs:number; rejoined?:boolean; x?:number;y?:number;z?:number }

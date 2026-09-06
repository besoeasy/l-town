// Minimal ECS — lore: RX-11 chassis same body, core = soul
import type { CoreId } from '@l-town/shared/dist/cfg.js'
export type Entity = number
export type Comp<T> = Map<Entity, T>
export const Position: Comp<{x:number;y:number;z:number;yaw:number;pitch:number}> = new Map()
export const Velocity: Comp<{vy:number}> = new Map()
export const Hull: Comp<{health:number;alive:boolean;respawnAt:number;lastHit:number}> = new Map()
export const Core: Comp<{id:CoreId; invisible:boolean; invisibleEnd:number; overdriveEnd:number; bulwarkEnd:number; aegisEnd:number; leechEnd:number; rageEnd:number; lastAbility:number}> = new Map()
export const Score: Comp<{value:number}> = new Map()

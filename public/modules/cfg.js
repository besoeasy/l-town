export const CFG = {
  TICK_MS:           50,     // 20 Hz
  MATCH_DURATION:   600,     // seconds
  MAX_PLAYERS:      300,
  PLAYER_SPEED:       9,     // units/s
  RUN_SPEED:         15,     // units/s while sprinting
  CROUCH_SPEED:       4,     // units/s while crouching
  PLAYER_RADIUS:    0.45,
  PLAYER_HEIGHT:    2.3,
  EYE_HEIGHT:       1.95,
  CROUCH_EYE_HEIGHT: 0.85,
  AUTO_CROUCH_MS:  10000,    // ms of no movement before auto-crouch
  MAX_HEALTH:       500,
  REGEN_DELAY:     2000,     // ms after last damage
  SHOT_COST_SINGLE:   2,     // HP drained per single shot
  CHARGE_MAX:         4,     // max charged shots
  SUPER_COST:        50,     // HP
  SUPER_DURATION: 10000,     // ms
  RESPAWN_DELAY:   7000,     // ms
  KILL_BONUS_HP: 100,       // flat HP awarded on kill
  JUMP_SPEED:        18,     // units/s initial upward velocity
  GRAVITY:           32,    // units/s² downward
  SUPER_JUMP_SPEED:  44,    // ~10x the height of regular jump
  SUPER_JUMP_COST:   20,    // HP cost for charged super jump
  DMG_SINGLE:        20,
  SUPER_MULT:         3,
  SHIELD_COST:        80,    // HP cost to activate shield
  SHIELD_DURATION: 10000,    // ms of full damage immunity
};

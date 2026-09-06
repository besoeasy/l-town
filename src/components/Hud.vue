<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { CFG, CORE_DETAILS, type CoreId } from '../game/config'
import type { PlayerState, KillMsg } from '../net/types'

const props = defineProps<{
  player: PlayerState
  matchTime: number
  killFeed: KillMsg[]
  hitFlash: boolean
  hitConfirm: { show: boolean; amount: number; killed: boolean }
}>()

const currentTime = ref(Date.now())
let timerRaf: number | null = null

onMounted(() => {
  const loop = () => {
    currentTime.value = Date.now()
    timerRaf = requestAnimationFrame(loop)
  }
  timerRaf = requestAnimationFrame(loop)
})

onUnmounted(() => {
  if (timerRaf) cancelAnimationFrame(timerRaf)
})

const core = computed(() => CORE_DETAILS[props.player.character] || CORE_DETAILS.telepotu)

const hullPercent = computed(() => {
  return Math.max(0, Math.min(100, (props.player.health / CFG.MAX_HEALTH) * 100))
})

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Q Ability Timer
const qTimeRemaining = computed(() => {
  if (props.player.superActive) return 0
  if (core.value.cooldown <= 0) return 0
  const elapsed = currentTime.value - (props.player.lastAbilityAt || 0)
  return Math.max(0, (core.value.cooldown - elapsed) / 1000)
})

const qPercent = computed(() => {
  if (props.player.superActive) return 0
  if (core.value.cooldown <= 0) return 100
  const elapsed = currentTime.value - (props.player.lastAbilityAt || 0)
  return Math.min(100, Math.max(0, (elapsed / core.value.cooldown) * 100))
})

const abilityReady = computed(() => !props.player.superActive && qTimeRemaining.value <= 0)

// E Super Timer (duration = 10s)
const eTimeRemaining = computed(() => {
  if (!props.player.superActive || !props.player.superEnd) return 0
  return Math.max(0, (props.player.superEnd - currentTime.value) / 1000)
})

const ePercent = computed(() => {
  if (props.player.superActive && props.player.superEnd) {
    return Math.min(100, Math.max(0, (eTimeRemaining.value / (CFG.SUPER_DURATION / 1000)) * 100))
  }
  return props.player.health >= 51 ? 100 : Math.max(0, (props.player.health / 50) * 100)
})

// R Shield Timer (duration = 10s)
const rTimeRemaining = computed(() => {
  if (!props.player.shieldActive || !props.player.shieldEnd) return 0
  return Math.max(0, (props.player.shieldEnd - currentTime.value) / 1000)
})

const rPercent = computed(() => {
  if (props.player.superActive) return 0
  if (props.player.shieldActive && props.player.shieldEnd) {
    return Math.min(100, Math.max(0, (rTimeRemaining.value / (CFG.SHIELD_DURATION / 1000)) * 100))
  }
  return props.player.health >= 81 ? 100 : Math.max(0, (props.player.health / 80) * 100)
})

// C Crouch / Hull Fabrication Timer
const cTimeRemaining = computed(() => {
  if (props.player.health >= CFG.MAX_HEALTH) return 0
  const needed = CFG.MAX_HEALTH - props.player.health
  const rate = props.player.crouching ? CFG.REGEN_RATE * 3 : CFG.REGEN_RATE
  return Math.max(0, needed / rate)
})

const cPercent = computed(() => {
  return Math.min(100, Math.max(0, (props.player.health / CFG.MAX_HEALTH) * 100))
})
</script>

<template>
  <div class="hud-overlay" :class="{ 'hit-vignette': hitFlash }">
    <!-- Top Match Header -->
    <div class="hud-top">
      <div class="match-timer">
        <span class="timer-label">TRIAL CLOCK</span>
        <span class="timer-val">{{ formatTime(matchTime) }}</span>
      </div>
      <div class="pilot-badge">
        <span class="core-icon">{{ core.badge }}</span>
        <span class="core-name">{{ core.name }}</span>
        <span class="core-maker">{{ core.maker }}</span>
      </div>
    </div>

    <!-- Kill Feed -->
    <div class="kill-feed">
      <div v-for="(k, i) in killFeed" :key="i" class="kill-item">
        <span class="killer">{{ k.shooterName }}</span>
        <span class="skull">☠️</span>
        <span class="victim">{{ k.targetName }}</span>
      </div>
    </div>

    <!-- Center Crosshair & Hit Markers -->
    <div class="crosshair-container">
      <div class="crosshair" :class="{ 'hit-confirm': hitConfirm.show }">
        <div class="ch-line ch-top"></div>
        <div class="ch-line ch-bottom"></div>
        <div class="ch-line ch-left"></div>
        <div class="ch-line ch-right"></div>
        <div class="ch-dot"></div>
      </div>
      <div v-if="hitConfirm.show" class="damage-popup" :class="{ 'kill-popup': hitConfirm.killed }">
        {{ hitConfirm.killed ? 'FRAG!' : `-${hitConfirm.amount}` }}
      </div>
    </div>

    <!-- Bottom Status Panel -->
    <div class="hud-bottom">
      <!-- Nanite Census / Hull Bar -->
      <div class="hull-container">
        <div class="hull-header">
          <span class="hull-title">RX-11 NANITE CENSUS</span>
          <span class="hull-val">{{ Math.ceil(player.health) }} / {{ CFG.MAX_HEALTH }}</span>
        </div>
        <div class="hull-track">
          <div
            class="hull-fill"
            :style="{
              width: `${hullPercent}%`,
              background: hullPercent < 25 ? '#ef4444' : hullPercent < 50 ? '#f59e0b' : '#00f0ff'
            }"
          ></div>
        </div>
      </div>

      <!-- Action & Ability Indicators with Border Timer Lines -->
      <div class="actions-panel">
        <!-- Q Ability -->
        <div
          class="action-card"
          :class="{
            ready: abilityReady,
            cooldown: !abilityReady && !player.superActive,
            disabled: player.superActive
          }"
        >
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - qPercent}`,
                stroke: player.superActive ? 'rgba(255, 255, 255, 0.15)' : abilityReady ? '#00f0ff' : '#0ea5e9'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind" :class="{ 'key-disabled': player.superActive }">Q</div>
            <div class="action-info">
              <span class="action-name">{{ core.ability }}</span>
              <span class="action-status">
                {{ player.superActive ? 'DISABLED (SUPER)' : abilityReady ? 'READY' : `${qTimeRemaining.toFixed(1)}s` }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${qPercent}%`,
              backgroundColor: player.superActive ? 'transparent' : abilityReady ? '#00f0ff' : '#0ea5e9'
            }"
          ></div>
        </div>

        <!-- E Super -->
        <div class="action-card" :class="{ active: player.superActive }">
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - ePercent}`,
                stroke: player.superActive ? '#f59e0b' : '#78716c'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind">E</div>
            <div class="action-info">
              <span class="action-name">SUPER (2× SPD, 3× DMG)</span>
              <span class="action-status">
                {{ player.superActive ? `${eTimeRemaining.toFixed(1)}s LEFT` : '50 HULL' }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${ePercent}%`,
              backgroundColor: player.superActive ? '#f59e0b' : 'rgba(245, 158, 11, 0.4)'
            }"
          ></div>
        </div>

        <!-- R Shield -->
        <div
          class="action-card"
          :class="{
            active: player.shieldActive,
            disabled: player.superActive
          }"
        >
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - rPercent}`,
                stroke: player.superActive ? 'rgba(255, 255, 255, 0.15)' : player.shieldActive ? '#00f0ff' : '#64748b'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind" :class="{ 'key-disabled': player.superActive }">R</div>
            <div class="action-info">
              <span class="action-name">SHIELD</span>
              <span class="action-status">
                {{ player.superActive ? 'DISABLED (SUPER)' : player.shieldActive ? `${rTimeRemaining.toFixed(1)}s IMMUNE` : '80 HULL' }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${rPercent}%`,
              backgroundColor: player.superActive ? 'transparent' : player.shieldActive ? '#00f0ff' : 'rgba(0, 240, 255, 0.4)'
            }"
          ></div>
        </div>

        <!-- C Crouch / Space Jump -->
        <div class="action-card" :class="{ active: player.crouching }">
          <svg class="card-border-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
            <rect x="1" y="1" width="98" height="98" rx="5" class="svg-border-track" />
            <rect
              x="1" y="1" width="98" height="98" rx="5"
              class="svg-border-line"
              pathLength="100"
              :style="{
                strokeDasharray: '100',
                strokeDashoffset: `${100 - cPercent}`,
                stroke: player.crouching ? '#10b981' : '#475569'
              }"
            />
          </svg>
          <div class="card-inner">
            <div class="key-bind">C</div>
            <div class="action-info">
              <span class="action-name">CROUCH</span>
              <span class="action-status">
                {{ player.crouching ? (cTimeRemaining > 0 ? `${cTimeRemaining.toFixed(1)}s (3× REGEN)` : 'FULL HULL') : 'STAND' }}
              </span>
            </div>
          </div>
          <div
            class="bottom-border-line"
            :style="{
              width: `${cPercent}%`,
              backgroundColor: player.crouching ? '#10b981' : 'rgba(16, 185, 129, 0.4)'
            }"
          ></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hud-overlay {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: 'Rajdhani', sans-serif;
  color: #fff;
  transition: box-shadow 0.15s ease;
  user-select: none;
}

.hit-vignette {
  box-shadow: inset 0 0 100px rgba(239, 68, 68, 0.7);
}

.hud-top {
  position: absolute;
  top: 24px;
  left: 28px;
  right: 28px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.match-timer {
  display: flex;
  flex-direction: column;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(0, 240, 255, 0.3);
  padding: 6px 18px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.timer-label {
  font-size: 11px;
  letter-spacing: 2px;
  color: #00f0ff;
  font-weight: 700;
}

.timer-val {
  font-size: 28px;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  color: #ffffff;
}

.pilot-badge {
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 8px 18px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.core-icon {
  font-size: 22px;
}

.core-name {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 1px;
}

.core-maker {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  border-left: 1px solid rgba(255, 255, 255, 0.2);
  padding-left: 10px;
}

.kill-feed {
  position: absolute;
  top: 85px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.kill-item {
  background: rgba(16, 20, 30, 0.8);
  border-left: 3px solid #ff0055;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 600;
  animation: fadeIn 0.2s ease;
}

.killer {
  color: #00f0ff;
}

.skull {
  margin: 0 6px;
}

.victim {
  color: #ff6688;
}

.crosshair-container {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  flex-direction: column;
  align-items: center;
}

.crosshair {
  width: 28px;
  height: 28px;
  position: relative;
  transition: transform 0.08s ease;
}

.crosshair.hit-confirm {
  transform: scale(1.4);
}

.ch-line {
  position: absolute;
  background: rgba(0, 240, 255, 0.8);
}

.crosshair.hit-confirm .ch-line {
  background: #ff0055;
}

.ch-top {
  top: 0;
  left: 13px;
  width: 2px;
  height: 8px;
}

.ch-bottom {
  bottom: 0;
  left: 13px;
  width: 2px;
  height: 8px;
}

.ch-left {
  top: 13px;
  left: 0;
  width: 8px;
  height: 2px;
}

.ch-right {
  top: 13px;
  right: 0;
  width: 8px;
  height: 2px;
}

.ch-dot {
  position: absolute;
  top: 12px;
  left: 12px;
  width: 4px;
  height: 4px;
  background: #ffffff;
  border-radius: 50%;
}

.damage-popup {
  margin-top: 18px;
  font-size: 18px;
  font-weight: 700;
  color: #ff0055;
  animation: floatUp 0.3s ease;
}

.damage-popup.kill-popup {
  color: #ffcc00;
  font-size: 22px;
}

.hud-bottom {
  position: absolute;
  bottom: 24px;
  left: 28px;
  right: 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hull-container {
  max-width: 420px;
  background: rgba(11, 14, 22, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.15);
  padding: 10px 16px;
  border-radius: 6px;
  backdrop-filter: blur(8px);
}

.hull-header {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 700;
  margin-bottom: 6px;
}

.hull-title {
  color: rgba(255, 255, 255, 0.7);
  letter-spacing: 1px;
}

.hull-val {
  color: #00f0ff;
  font-family: 'JetBrains Mono', monospace;
}

.hull-track {
  height: 10px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
}

.hull-fill {
  height: 100%;
  transition: width 0.1s ease, background 0.2s ease;
}

.actions-panel {
  display: flex;
  gap: 12px;
}

.action-card {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  background: rgba(11, 14, 22, 0.88);
  border-radius: 6px;
  backdrop-filter: blur(8px);
  min-width: 140px;
}

.card-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  position: relative;
  z-index: 2;
  width: 100%;
}

.card-border-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 1;
}

.svg-border-track {
  fill: none;
  stroke: rgba(255, 255, 255, 0.1);
  stroke-width: 1.5;
  vector-effect: non-scaling-stroke;
}

.svg-border-line {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
  transition: stroke-dashoffset 0.08s linear;
  filter: drop-shadow(0 0 4px currentColor);
}

.bottom-border-line {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 3px;
  z-index: 3;
  transition: width 0.08s linear;
  box-shadow: 0 0 6px currentColor;
}

.action-card.ready {
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.2);
}

.action-card.active {
  background: rgba(245, 158, 11, 0.18);
  box-shadow: 0 0 12px rgba(245, 158, 11, 0.25);
}

.action-card.cooldown {
  opacity: 0.75;
}

.action-card.disabled {
  opacity: 0.42;
  filter: grayscale(0.85);
  box-shadow: none !important;
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.key-bind {
  font-family: 'JetBrains Mono', monospace;
  background: rgba(255, 255, 255, 0.15);
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 14px;
  font-weight: 700;
  color: #00f0ff;
}

.key-bind.key-disabled {
  color: rgba(255, 255, 255, 0.35);
  background: rgba(255, 255, 255, 0.08);
}

.action-info {
  display: flex;
  flex-direction: column;
}

.action-name {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
}

.action-status {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes floatUp {
  0% { opacity: 0; transform: translateY(10px); }
  50% { opacity: 1; transform: translateY(0); }
  100% { opacity: 0; transform: translateY(-10px); }
}
</style>

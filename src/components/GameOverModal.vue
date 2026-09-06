<script setup lang="ts">
import { computed } from 'vue'
import type { MatchResults } from '../net/types'

const props = defineProps<{
  show: boolean
  results: MatchResults | null
  localPlayerId: number
}>()

const emit = defineEmits<{
  (e: 'playAgain'): void
  (e: 'returnToLobby'): void
}>()

const isWinner = computed(() => props.results?.isWinner ?? false)
const rank = computed(() => props.results?.rank ?? 1)
const isPodium = computed(() => rank.value <= 3)

const rankTitle = computed(() => {
  if (isWinner.value) return 'APEX OPERATIVE — VICTORY'
  if (rank.value === 2) return 'RUNNER-UP — PODIUM SECURED'
  if (rank.value === 3) return '3RD PLACE — PODIUM SECURED'
  return 'TRIAL CONCLUDED — COMBAT SUMMARY'
})
</script>

<template>
  <div v-if="show && results" class="game-over-backdrop">
    <div class="game-over-card" :class="{ 'card-victory': isWinner, 'card-podium': isPodium && !isWinner }">
      <!-- Glow Accent Header -->
      <div class="header-banner">
        <div class="badge-icon">
          {{ isWinner ? '🏆' : rank.value === 2 ? '🥈' : rank.value === 3 ? '🥉' : '⚔️' }}
        </div>
        <h1 class="headline">{{ rankTitle }}</h1>
        <p class="subheadline">
          MERIDIAN TRIAL ARENA // AUTHORITATIVE FINAL COMBAT STANDINGS
        </p>
      </div>

      <!-- Quick Stats Strip -->
      <div class="stats-grid">
        <div class="stat-box">
          <span class="stat-label">FINAL STANDING</span>
          <span class="stat-val" :class="{ 'text-gold': isWinner, 'text-cyan': !isWinner }">
            #{{ rank }} / {{ results.totalPlayers }}
          </span>
        </div>
        <div class="stat-box">
          <span class="stat-label">YOUR FRAGS</span>
          <span class="stat-val text-white">{{ results.playerScore }}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">ARENA CHAMPION</span>
          <span class="stat-val text-gold">{{ results.winnerName }}</span>
        </div>
        <div class="stat-box">
          <span class="stat-label">TOP SCORE</span>
          <span class="stat-val text-amber">{{ results.winnerScore }} FRAGS</span>
        </div>
      </div>

      <!-- Final Full Leaderboard -->
      <div class="table-container">
        <table class="final-leaderboard">
          <thead>
            <tr>
              <th>RANK</th>
              <th>CALLSIGN</th>
              <th>TYPE</th>
              <th>PING</th>
              <th>SCORE</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(pilot, idx) in results.leaderboard"
              :key="pilot.id"
              :class="{
                'is-self': pilot.id === localPlayerId,
                'is-champ': idx === 0
              }"
            >
              <td class="rank-cell">
                <span v-if="idx === 0" class="medal">🥇 1st</span>
                <span v-else-if="idx === 1" class="medal">🥈 2nd</span>
                <span v-else-if="idx === 2" class="medal">🥉 3rd</span>
                <span v-else class="rank-num">#{{ idx + 1 }}</span>
              </td>
              <td class="name-cell">
                {{ pilot.name }}
                <span v-if="pilot.id === localPlayerId" class="tag-you">(YOU)</span>
              </td>
              <td class="type-cell">
                <span class="type-tag" :class="pilot.isBot ? 'tag-bot' : 'tag-pilot'">
                  {{ pilot.isBot ? 'AI BOT' : 'PILOT' }}
                </span>
              </td>
              <td class="ping-cell">
                <span class="ping-val">{{ pilot.ping ? `${pilot.ping}ms` : '<1ms' }}</span>
              </td>
              <td class="score-cell">{{ pilot.score }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Actions -->
      <div class="actions-row">
        <button class="action-btn btn-primary" @click="emit('playAgain')">
          ⚔️ PLAY AGAIN / NEW TRIAL
        </button>
        <button class="action-btn btn-secondary" @click="emit('returnToLobby')">
          ↩ RETURN TO LOBBY
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.game-over-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(4, 6, 12, 0.88);
  backdrop-filter: blur(14px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
  font-family: 'Rajdhani', sans-serif;
  color: #fff;
  user-select: none;
  animation: fadeIn 0.3s ease-out;
}

@keyframes fadeIn {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

.game-over-card {
  background: rgba(13, 17, 26, 0.96);
  border: 1px solid rgba(0, 240, 255, 0.35);
  border-radius: 12px;
  width: 90%;
  max-width: 720px;
  padding: 32px;
  box-shadow: 0 0 50px rgba(0, 240, 255, 0.2);
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.card-victory {
  border-color: rgba(245, 158, 11, 0.6);
  box-shadow: 0 0 60px rgba(245, 158, 11, 0.35);
}

.card-podium {
  border-color: rgba(0, 240, 255, 0.5);
}

.header-banner {
  text-align: center;
}

.badge-icon {
  font-size: 42px;
  margin-bottom: 6px;
}

.headline {
  margin: 0;
  font-size: 32px;
  font-weight: 800;
  letter-spacing: 2px;
  text-transform: uppercase;
}

.card-victory .headline {
  color: #f59e0b;
  text-shadow: 0 0 20px rgba(245, 158, 11, 0.5);
}

.subheadline {
  margin: 6px 0 0;
  font-size: 13px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.5);
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.stat-box {
  background: rgba(20, 26, 38, 0.85);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-label {
  font-size: 11px;
  letter-spacing: 1.5px;
  color: rgba(255, 255, 255, 0.5);
  font-weight: 700;
}

.stat-val {
  font-size: 20px;
  font-weight: 800;
  font-family: 'JetBrains Mono', monospace;
}

.text-gold { color: #f59e0b; }
.text-cyan { color: #00f0ff; }
.text-white { color: #ffffff; }
.text-amber { color: #fbbf24; }

.table-container {
  max-height: 230px;
  overflow-y: auto;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(8, 11, 18, 0.6);
}

.final-leaderboard {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
}

.final-leaderboard th {
  background: rgba(20, 26, 38, 0.9);
  padding: 10px 14px;
  font-size: 12px;
  letter-spacing: 1.5px;
  color: rgba(255, 255, 255, 0.6);
  border-bottom: 1px solid rgba(255, 255, 255, 0.15);
  position: sticky;
  top: 0;
}

.final-leaderboard td {
  padding: 10px 14px;
  font-size: 15px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.is-self {
  background: rgba(0, 240, 255, 0.12) !important;
}

.is-champ {
  background: rgba(245, 158, 11, 0.08);
}

.medal {
  font-weight: 700;
  color: #f59e0b;
}

.tag-you {
  color: #00f0ff;
  font-size: 11px;
  font-weight: 700;
  margin-left: 6px;
}

.type-tag {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 700;
}

.tag-pilot {
  background: rgba(0, 240, 255, 0.2);
  color: #00f0ff;
  border: 1px solid rgba(0, 240, 255, 0.4);
}

.tag-bot {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.ping-cell {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #10b981;
}

.score-cell {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 800;
  font-size: 18px;
  color: #ffffff;
}

.actions-row {
  display: flex;
  gap: 14px;
  margin-top: 4px;
}

.action-btn {
  flex: 1;
  padding: 14px 20px;
  border-radius: 6px;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1.5px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-family: 'Rajdhani', sans-serif;
  text-transform: uppercase;
}

.btn-primary {
  background: #00f0ff;
  color: #080a10;
  border: none;
  box-shadow: 0 0 20px rgba(0, 240, 255, 0.4);
}

.btn-primary:hover {
  background: #38bdf8;
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.6);
  transform: translateY(-1px);
}

.card-victory .btn-primary {
  background: #f59e0b;
  color: #080a10;
  box-shadow: 0 0 20px rgba(245, 158, 11, 0.4);
}

.card-victory .btn-primary:hover {
  background: #fbbf24;
  box-shadow: 0 0 30px rgba(245, 158, 11, 0.6);
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.08);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.2);
}

.btn-secondary:hover {
  background: rgba(255, 255, 255, 0.15);
  border-color: rgba(255, 255, 255, 0.35);
}
</style>

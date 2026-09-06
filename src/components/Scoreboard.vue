<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  show: boolean
  leaderboard: { id: number; name: string; score: number; isBot?: boolean; ping?: number }[]
  hvtId: number | null
  localPlayerId: number
}>()
</script>

<template>
  <div v-if="show" class="scoreboard-backdrop">
    <div class="scoreboard-modal">
      <div class="modal-header">
        <h2>MERIDIAN ARENA LEADERBOARD</h2>
        <span class="subtitle">TOP 3 EARN HEADLINE SLOTS & OFF-WORLD CONTRACTS</span>
      </div>

      <table class="leaderboard-table">
        <thead>
          <tr>
            <th>RANK</th>
            <th>CALLSIGN</th>
            <th>STATUS</th>
            <th>PING</th>
            <th>SCORE (FRAGS)</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(pilot, index) in leaderboard"
            :key="pilot.id"
            :class="{
              'is-local': pilot.id === localPlayerId,
              'top-rank': index < 3,
              'is-hvt': pilot.id === hvtId
            }"
          >
            <td class="rank-col">
              <span v-if="index === 0" class="crown">🥇</span>
              <span v-else-if="index === 1" class="crown">🥈</span>
              <span v-else-if="index === 2" class="crown">🥉</span>
              <span v-else>{{ index + 1 }}</span>
            </td>
            <td class="name-col">
              {{ pilot.name }}
              <span v-if="pilot.id === localPlayerId" class="you-tag">(YOU)</span>
            </td>
            <td class="status-col">
              <span v-if="pilot.id === hvtId" class="hvt-tag">TARGET</span>
              <span v-else-if="pilot.isBot" class="bot-tag">AI BOT</span>
              <span v-else class="online-tag">LINKED</span>
            </td>
            <td class="ping-col">
              <span class="ping-text">{{ pilot.ping ? `${pilot.ping}ms` : '<1ms' }}</span>
            </td>
            <td class="score-col">{{ pilot.score }}</td>
          </tr>
        </tbody>
      </table>

      <div class="modal-footer">
        <span>HOLD [TAB] OR [F] TO VIEW LEADERBOARD</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scoreboard-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(8, 10, 16, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 50;
  font-family: 'Rajdhani', sans-serif;
  color: #fff;
  user-select: none;
}

.scoreboard-modal {
  background: rgba(15, 18, 28, 0.95);
  border: 1px solid rgba(0, 240, 255, 0.3);
  border-radius: 8px;
  width: 90%;
  max-width: 640px;
  padding: 24px;
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.15);
}

.modal-header {
  text-align: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 14px;
  margin-bottom: 16px;
}

.modal-header h2 {
  font-size: 24px;
  font-weight: 700;
  letter-spacing: 2px;
  margin: 0;
  color: #00f0ff;
}

.subtitle {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 1px;
}

.leaderboard-table {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 16px;
}

.leaderboard-table th {
  text-align: left;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  letter-spacing: 1px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.leaderboard-table td {
  padding: 10px 12px;
  font-size: 15px;
  font-weight: 600;
}

.top-rank {
  background: rgba(0, 240, 255, 0.05);
}

.is-local {
  border-left: 3px solid #00f0ff;
  background: rgba(0, 240, 255, 0.1);
}

.is-hvt {
  background: rgba(255, 0, 85, 0.1);
}

.crown {
  font-size: 16px;
}

.you-tag {
  color: #00f0ff;
  font-size: 12px;
  margin-left: 6px;
}

.hvt-tag {
  background: #ff0055;
  color: #fff;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 700;
  letter-spacing: 1px;
}

.online-tag {
  color: #10b981;
  font-size: 11px;
}

.bot-tag {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.6);
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  font-weight: 700;
}

.ping-col {
  font-family: 'JetBrains Mono', monospace;
  font-size: 13px;
  color: #10b981;
}

.score-col {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  color: #00f0ff;
}

.modal-footer {
  text-align: center;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 1px;
}
</style>

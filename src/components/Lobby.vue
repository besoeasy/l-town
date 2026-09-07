<script setup lang="ts">
import { ref } from 'vue'
import { CORE_DETAILS, CORE_IDS, type CoreId } from '../game/config'
import type { NostrRoom } from '../net/types'

const props = defineProps<{
  callsign: string
  selectedCore: CoreId
  rooms: NostrRoom[]
  isPublishing: boolean
  inviteRoomCode?: string
  isConnecting?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:callsign', val: string): void
  (e: 'update:selectedCore', val: CoreId): void
  (e: 'startSolo'): void
  (e: 'createPeerRoom'): void
  (e: 'joinPeerRoom', code: string): void
  (e: 'createNostrRoom'): void
  (e: 'joinNostrRoom', room: NostrRoom): void
  (e: 'refreshRooms'): void
}>()

const activeTab = ref<'cores' | 'rooms' | 'controls'>('cores')
const roomCodeInput = ref('')

const handleJoinInput = () => {
  const code = roomCodeInput.value.trim().toUpperCase()
  if (code) {
    emit('joinPeerRoom', code)
  }
}
</script>

<template>
  <div class="lobby-backdrop">
    <div class="lobby-container">
      <!-- Header -->
      <header class="lobby-header">
        <div class="brand">
          <h1>L-TOWN</h1>
          <span class="sub-brand">3049 REMOTE AGE // ATMA CORES</span>
        </div>
        <div class="version-tag">CLIENT-ONLY PWA // P2P WEBRTC</div>
      </header>

      <!-- Pilot Callsign Bar -->
      <div class="callsign-bar">
        <div class="input-group">
          <label>OPERATOR CALLSIGN</label>
          <input
            type="text"
            maxlength="18"
            placeholder="Enter Callsign..."
            :value="callsign"
            @input="emit('update:callsign', ($event.target as HTMLInputElement).value)"
            class="callsign-input"
          />
        </div>
        <div class="selected-core-summary">
          <span class="badge">{{ CORE_DETAILS[selectedCore].badge }}</span>
          <div class="core-text">
            <span class="name">{{ CORE_DETAILS[selectedCore].name }}</span>
            <span class="maker">{{ CORE_DETAILS[selectedCore].maker }}</span>
          </div>
        </div>
      </div>

      <!-- Direct Room Invitation Banner -->
      <div v-if="inviteRoomCode" class="invite-banner">
        <div class="invite-info">
          <span class="invite-bolt">⚡</span>
          <div class="invite-details">
            <span class="invite-heading">INVITATION DETECTED</span>
            <span class="invite-sub">Room Host Code: <strong>{{ inviteRoomCode }}</strong></span>
          </div>
        </div>
        <button class="invite-join-btn" :disabled="isConnecting" @click="emit('joinPeerRoom', inviteRoomCode)">
          {{ isConnecting ? 'CONNECTING P2P...' : 'CONNECT & PLAY NOW' }}
        </button>
      </div>

      <!-- Navigation Tabs -->
      <nav class="lobby-tabs">
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'cores' }"
          @click="activeTab = 'cores'"
        >
          11 ATMA CORES
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'rooms' }"
          @click="activeTab = 'rooms'"
        >
          NOSTR ROOMS ({{ rooms.length }})
        </button>
        <button
          class="tab-btn"
          :class="{ active: activeTab === 'controls' }"
          @click="activeTab = 'controls'"
        >
          CONTROLS & LORE
        </button>
      </nav>

      <!-- Main Content Area -->
      <div class="tab-content">
        <!-- 11 Atma Cores Grid -->
        <div v-if="activeTab === 'cores'" class="cores-grid">
          <div
            v-for="cid in CORE_IDS"
            :key="cid"
            class="core-card"
            :class="{ selected: selectedCore === cid }"
            @click="emit('update:selectedCore', cid)"
          >
            <div class="card-header">
              <span class="card-badge">{{ CORE_DETAILS[cid].badge }}</span>
              <span class="card-name">{{ CORE_DETAILS[cid].name }}</span>
            </div>
            <div class="card-maker">{{ CORE_DETAILS[cid].maker }}</div>
            <div class="card-ability">
              <span class="key-tag">Q</span>
              <span class="ability-name">{{ CORE_DETAILS[cid].ability }}</span>
              <span class="cd-tag">
                {{ CORE_DETAILS[cid].cooldown > 0 ? `${CORE_DETAILS[cid].cooldown / 1000}s` : 'PASSIVE' }}
              </span>
            </div>
            <p class="card-desc">{{ CORE_DETAILS[cid].desc }}</p>
          </div>
        </div>

        <!-- NOSTR Public Room Browser -->
        <div v-else-if="activeTab === 'rooms'" class="rooms-panel">
          <div class="rooms-toolbar">
            <span class="toolbar-title">DECENTRALIZED RELAY ROOM DISCOVERY</span>
            <button class="refresh-btn" @click="emit('refreshRooms')">REFRESH RELAYS</button>
          </div>

          <div v-if="rooms.length === 0" class="empty-rooms">
            <p>No active public rooms discovered on NOSTR relays.</p>
            <p class="empty-sub">Create a room below to broadcast your P2P match, or launch a Solo Trial.</p>
          </div>

          <div v-else class="room-list">
            <div v-for="r in rooms" :key="r.id" class="room-row">
              <div class="room-info">
                <span class="room-name">{{ r.name }}</span>
                <span class="room-core">Core: {{ r.core }}</span>
                <span class="room-players">{{ r.players }} / 16 PILOTS</span>
              </div>
              <button class="join-btn" @click="emit('joinNostrRoom', r)">CONNECT P2P</button>
            </div>
          </div>
        </div>

        <!-- Controls & Canon Lore -->
        <div v-else class="controls-panel">
          <div class="controls-grid">
            <div class="control-box">
              <h3>PILOT CONTROLS</h3>
              <ul>
                <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — Move Nanite Chassis</li>
                <li><kbd>MOUSE</kbd> — Aim Reticle & Head</li>
                <li><kbd>L-CLICK</kbd> — Hitscan Discharge (-2 Hull)</li>
                <li><kbd>Q</kbd> — Atma Core Ability</li>
                <li><kbd>E</kbd> — Super Overclock (-50 Hull, 3× Damage)</li>
                <li><kbd>R</kbd> — Nanite Barrier (-80 Hull, 10s Immunity)</li>
                <li><kbd>SPACE</kbd> — Jump (Hold Shift for Super Jump)</li>
                <li><kbd>C</kbd> — Crouch (Triggers 3× Hull Regeneration)</li>
                <li><kbd>TAB</kbd> / <kbd>F</kbd> — Meridian Leaderboard</li>
              </ul>
            </div>
            <div class="control-box">
              <h3>3049 CANON CHARTER</h3>
              <p>
                Surface environments are stripped by Helios solar storms. Humans remain in orbit and pilot expendable
                <strong>RX-11</strong> humanoid nanite swarms.
              </p>
              <p>
                <strong>Hull is Ammunition:</strong> Every shot, jump, shield, and ability drains nanites from your chassis. Standing still or crouching shifts core cycles to matter fabrication.
              </p>
              <p>
                <strong>Fair Charter:</strong> All chassis share identical hitboxes, speeds, and costs. Only your Atma Core soul pattern determines your unique Q ability.
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Unified P2P Action Footer -->
      <footer class="lobby-footer">
        <button class="action-btn solo-btn" @click="emit('startSolo')">
          SOLO TRIAL (BOTS)
        </button>

        <button class="action-btn host-btn" :disabled="isConnecting" @click="emit('createPeerRoom')">
          ⚡ HOST MATCH (P2P)
        </button>

        <div class="join-match-box">
          <input
            type="text"
            v-model="roomCodeInput"
            placeholder="ROOM CODE"
            maxlength="8"
            class="room-code-input"
            @keyup.enter="handleJoinInput"
          />
          <button
            class="action-btn join-match-btn"
            :disabled="!roomCodeInput.trim() || isConnecting"
            @click="handleJoinInput"
          >
            {{ isConnecting ? 'CONNECTING...' : 'JOIN MATCH' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.lobby-backdrop {
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at center, #101422 0%, #080a10 100%);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 20;
  font-family: 'Rajdhani', sans-serif;
  color: #fff;
  padding: 20px;
}

.lobby-container {
  background: rgba(14, 18, 28, 0.95);
  border: 1px solid rgba(0, 240, 255, 0.3);
  border-radius: 8px;
  width: 100%;
  max-width: 1080px;
  height: 90vh;
  max-height: 820px;
  display: flex;
  flex-direction: column;
  padding: 24px;
  box-shadow: 0 0 40px rgba(0, 240, 255, 0.15);
}

.lobby-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 14px;
}

.brand h1 {
  font-size: 32px;
  font-weight: 700;
  letter-spacing: 3px;
  margin: 0;
  color: #00f0ff;
}

.sub-brand {
  font-size: 11px;
  letter-spacing: 2px;
  color: rgba(255, 255, 255, 0.5);
}

.version-tag {
  background: rgba(0, 240, 255, 0.1);
  color: #00f0ff;
  border: 1px solid rgba(0, 240, 255, 0.3);
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 1px;
}

.callsign-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 16px 0;
  gap: 20px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.input-group label {
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.6);
}

.callsign-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 240, 255, 0.4);
  color: #fff;
  font-family: 'Rajdhani', sans-serif;
  font-size: 18px;
  font-weight: 700;
  padding: 8px 14px;
  border-radius: 4px;
  outline: none;
}

.callsign-input:focus {
  border-color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.3);
}

.selected-core-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  background: rgba(0, 240, 255, 0.08);
  border: 1px solid rgba(0, 240, 255, 0.3);
  padding: 8px 16px;
  border-radius: 6px;
}

.selected-core-summary .badge {
  font-size: 24px;
}

.core-text .name {
  font-size: 16px;
  font-weight: 700;
  color: #00f0ff;
}

.core-text .maker {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  display: block;
}

.lobby-tabs {
  display: flex;
  gap: 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 8px;
}

.tab-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.6);
  font-family: 'Rajdhani', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.tab-btn.active {
  background: rgba(0, 240, 255, 0.15);
  color: #00f0ff;
}

.tab-content {
  flex: 1;
  overflow-y: auto;
  margin: 14px 0;
  padding-right: 4px;
}

.cores-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}

.core-card {
  background: rgba(20, 25, 38, 0.75);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.core-card:hover {
  border-color: rgba(0, 240, 255, 0.5);
  transform: translateY(-2px);
}

.core-card.selected {
  border-color: #00f0ff;
  background: rgba(0, 240, 255, 0.12);
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.25);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-badge {
  font-size: 18px;
}

.card-name {
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
}

.card-maker {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  margin: 2px 0 6px 0;
}

.card-ability {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.key-tag {
  background: #00f0ff;
  color: #0a0c14;
  font-weight: 700;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 3px;
}

.ability-name {
  font-size: 12px;
  font-weight: 700;
}

.cd-tag {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  margin-left: auto;
}

.card-desc {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.3;
  margin: 0;
}

.rooms-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.rooms-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.toolbar-title {
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.6);
}

.refresh-btn {
  background: transparent;
  border: 1px solid #00f0ff;
  color: #00f0ff;
  font-family: 'Rajdhani', sans-serif;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.empty-rooms {
  text-align: center;
  padding: 60px 20px;
  color: rgba(255, 255, 255, 0.7);
}

.empty-sub {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.4);
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.room-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(20, 25, 38, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 10px 16px;
  border-radius: 6px;
}

.room-name {
  font-size: 15px;
  font-weight: 700;
  margin-right: 14px;
}

.room-core {
  font-size: 12px;
  color: #00f0ff;
  margin-right: 14px;
}

.room-players {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.join-btn {
  background: #00f0ff;
  border: none;
  color: #0a0c14;
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px;
  font-weight: 700;
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
}

.controls-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px;
}

.control-box {
  background: rgba(20, 25, 38, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 16px;
}

.control-box h3 {
  margin: 0 0 12px 0;
  font-size: 16px;
  color: #00f0ff;
}

.control-box ul {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.control-box li {
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 8px;
}

kbd {
  background: rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  padding: 2px 6px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
}

.control-box p {
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 255, 255, 0.8);
  margin-bottom: 10px;
}

.lobby-footer {
  display: flex;
  gap: 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  padding-top: 14px;
}

.action-btn {
  flex: 1;
  font-family: 'Rajdhani', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 12px 14px;
  border-radius: 6px;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.solo-btn {
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.15);
}

.host-btn {
  background: linear-gradient(135deg, #00f0ff 0%, #3b82f6 100%);
  color: #080a10;
  font-weight: 800;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.3);
}

.join-match-box {
  flex: 1.5;
  display: flex;
  gap: 8px;
}

.room-code-input {
  flex: 1;
  background: rgba(10, 14, 24, 0.9);
  border: 1px solid rgba(0, 240, 255, 0.3);
  border-radius: 6px;
  color: #00f0ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 2px;
  text-align: center;
  text-transform: uppercase;
  padding: 0 12px;
}

.room-code-input::placeholder {
  font-family: 'Rajdhani', sans-serif;
  font-size: 13px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.35);
}

.room-code-input:focus {
  outline: none;
  border-color: #00f0ff;
  box-shadow: 0 0 10px rgba(0, 240, 255, 0.4);
}

.join-match-btn {
  background: #10b981;
  color: #080a10;
  font-weight: 800;
  flex: 1;
}

.action-btn:hover:not(:disabled) {
  transform: translateY(-2px);
  filter: brightness(1.15);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Invite Banner */
.invite-banner {
  margin: 0 0 16px 0;
  background: linear-gradient(90deg, rgba(0, 240, 255, 0.15) 0%, rgba(59, 130, 246, 0.2) 100%);
  border: 1px solid rgba(0, 240, 255, 0.6);
  border-radius: 8px;
  padding: 12px 18px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 0 20px rgba(0, 240, 255, 0.25);
  animation: bannerPulse 2s infinite ease-in-out;
}

@keyframes bannerPulse {
  0%, 100% { border-color: rgba(0, 240, 255, 0.6); box-shadow: 0 0 15px rgba(0, 240, 255, 0.2); }
  50% { border-color: rgba(0, 240, 255, 1); box-shadow: 0 0 25px rgba(0, 240, 255, 0.45); }
}

.invite-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.invite-bolt {
  font-size: 24px;
}

.invite-details {
  display: flex;
  flex-direction: column;
}

.invite-heading {
  font-size: 11px;
  letter-spacing: 2px;
  color: #00f0ff;
  font-weight: 700;
}

.invite-sub {
  font-size: 15px;
  color: #fff;
}

.invite-sub strong {
  color: #00f0ff;
  font-family: 'JetBrains Mono', monospace;
  letter-spacing: 1px;
}

.invite-join-btn {
  background: #00f0ff;
  color: #080a10;
  border: none;
  font-family: 'Rajdhani', sans-serif;
  font-size: 15px;
  font-weight: 800;
  letter-spacing: 1px;
  padding: 10px 20px;
  border-radius: 6px;
  cursor: pointer;
  box-shadow: 0 0 15px rgba(0, 240, 255, 0.5);
  transition: all 0.2s ease;
}

.invite-join-btn:hover:not(:disabled) {
  transform: scale(1.05);
  filter: brightness(1.2);
}
</style>

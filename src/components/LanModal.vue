<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { fetchServerInfo } from '../net/lan'

const props = defineProps<{
  show: boolean
  mode: 'host' | 'join'
  connectedPeersCount?: number
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'join', hostAddress: string): void
  (e: 'startMatch'): void
  (e: 'switchAirgap'): void
}>()

const hostIp = ref('')
const joinAddress = ref('')
const isConnecting = ref(false)
const errorMessage = ref('')

onMounted(async () => {
  const info = await fetchServerInfo()
  hostIp.value = `${info.localIp}:${info.port}`
  joinAddress.value = localStorage.getItem('ltown_last_lan_host') || (window.location.host || `${info.localIp}:${info.port}`)
})

const handleJoin = () => {
  if (!joinAddress.value.trim()) return
  errorMessage.value = ''
  isConnecting.value = true
  localStorage.setItem('ltown_last_lan_host', joinAddress.value.trim())
  emit('join', joinAddress.value.trim())
}

const copyAddress = async () => {
  await navigator.clipboard.writeText(hostIp.value)
}

const setConnecting = (val: boolean, err = '') => {
  isConnecting.value = val
  errorMessage.value = err
}

defineExpose({ setConnecting })
</script>

<template>
  <div v-if="show" class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-header">
        <h3>{{ mode === 'host' ? 'HOST LAN TRIAL' : 'JOIN LAN TRIAL' }}</h3>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <!-- HOST MODE -->
      <div v-if="mode === 'host'" class="modal-body">
        <p class="desc">
          Tell other players on your Wi-Fi/local network to enter this Host Address:
        </p>
        <div class="address-box" @click="copyAddress" title="Click to copy">
          <span class="ip-text">{{ hostIp || 'Detecting...' }}</span>
          <button class="copy-pill">COPY</button>
        </div>
        <div class="peers-status">
          <span class="pulse-dot"></span>
          <span>Waiting for players ({{ connectedPeersCount || 1 }} / 16 Linked)</span>
        </div>
        <div class="modal-actions">
          <button class="action-btn primary-btn" @click="emit('startMatch')">
            ENTER ARENA (HOST)
          </button>
        </div>
      </div>

      <!-- JOIN MODE -->
      <div v-else class="modal-body">
        <p class="desc">
          Enter the Host's IP address and port (e.g. <code>192.168.1.50:30300</code>):
        </p>
        <div class="input-group">
          <label>HOST ADDRESS</label>
          <input
            v-model="joinAddress"
            type="text"
            placeholder="192.168.1.XX:30300"
            class="address-input"
            :disabled="isConnecting"
            @keyup.enter="handleJoin"
          />
        </div>

        <div v-if="errorMessage" class="error-banner">
          {{ errorMessage }}
        </div>

        <div class="modal-actions">
          <button
            class="action-btn primary-btn"
            :disabled="isConnecting || !joinAddress.trim()"
            @click="handleJoin"
          >
            {{ isConnecting ? 'NEGOTIATING PEER LINK...' : 'CONNECT & ENTER ARENA' }}
          </button>
        </div>
      </div>

      <div class="modal-footer">
        <button class="airgap-link" @click="emit('switchAirgap')">
          Air-gapped manual token mode (QR code) ↗
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(8, 10, 16, 0.85);
  backdrop-filter: blur(8px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 100;
  font-family: 'Rajdhani', sans-serif;
  color: #fff;
  user-select: none;
}

.modal-card {
  background: #0e121d;
  border: 1px solid rgba(0, 240, 255, 0.4);
  border-radius: 8px;
  width: 90%;
  max-width: 480px;
  padding: 24px;
  box-shadow: 0 0 30px rgba(0, 240, 255, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  padding-bottom: 12px;
  margin-bottom: 16px;
}

.modal-header h3 {
  margin: 0;
  color: #00f0ff;
  font-size: 20px;
  letter-spacing: 2px;
}

.close-btn {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.5);
  font-size: 18px;
  cursor: pointer;
}

.desc {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  line-height: 1.4;
  margin-bottom: 16px;
}

code {
  background: rgba(0, 240, 255, 0.15);
  color: #00f0ff;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'JetBrains Mono', monospace;
}

.address-box {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: rgba(0, 240, 255, 0.08);
  border: 1px solid rgba(0, 240, 255, 0.4);
  padding: 12px 16px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 14px;
  transition: all 0.15s ease;
}

.address-box:hover {
  background: rgba(0, 240, 255, 0.15);
  border-color: #00f0ff;
}

.ip-text {
  font-family: 'JetBrains Mono', monospace;
  font-size: 18px;
  font-weight: 700;
  color: #00f0ff;
}

.copy-pill {
  background: #00f0ff;
  border: none;
  color: #0b0d17;
  font-weight: 700;
  font-size: 11px;
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.peers-status {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 18px;
}

.pulse-dot {
  width: 8px;
  height: 8px;
  background: #10b981;
  border-radius: 50%;
  box-shadow: 0 0 8px #10b981;
  animation: pulse 1.5s infinite;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 16px;
}

.input-group label {
  font-size: 11px;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.6);
}

.address-input {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(0, 240, 255, 0.4);
  color: #00f0ff;
  font-family: 'JetBrains Mono', monospace;
  font-size: 16px;
  padding: 10px 14px;
  border-radius: 4px;
  outline: none;
}

.address-input:focus {
  border-color: #00f0ff;
  box-shadow: 0 0 12px rgba(0, 240, 255, 0.3);
}

.error-banner {
  background: rgba(239, 68, 68, 0.15);
  border: 1px solid #ef4444;
  color: #fca5a5;
  font-size: 12px;
  padding: 8px 12px;
  border-radius: 4px;
  margin-bottom: 14px;
}

.modal-actions {
  display: flex;
  gap: 10px;
}

.action-btn {
  flex: 1;
  font-family: 'Rajdhani', sans-serif;
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 12px;
  border-radius: 4px;
  cursor: pointer;
  border: none;
  transition: all 0.15s ease;
}

.primary-btn {
  background: #00f0ff;
  color: #0a0c14;
}

.primary-btn:hover:not(:disabled) {
  filter: brightness(1.15);
  transform: translateY(-1px);
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.modal-footer {
  margin-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 12px;
  text-align: center;
}

.airgap-link {
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
  cursor: pointer;
}

.airgap-link:hover {
  color: #00f0ff;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.7; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.7; }
}
</style>

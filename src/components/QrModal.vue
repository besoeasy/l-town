<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { generateQrDataUrl } from '../net/qr'

const props = defineProps<{
  show: boolean
  title: string
  signalData: string
  mode: 'display' | 'input'
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'submitSignal', data: string): void
}>()

const qrUrl = ref('')
const inputVal = ref('')
const copied = ref(false)

const updateQr = async () => {
  if (props.signalData) {
    qrUrl.value = await generateQrDataUrl(props.signalData)
  }
}

onMounted(updateQr)
watch(() => props.signalData, updateQr)

const copyText = async () => {
  if (props.signalData) {
    await navigator.clipboard.writeText(props.signalData)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  }
}

const submit = () => {
  if (inputVal.value.trim()) {
    emit('submitSignal', inputVal.value.trim())
  }
}
</script>

<template>
  <div v-if="show" class="modal-backdrop">
    <div class="modal-card">
      <div class="modal-header">
        <h3>{{ title }}</h3>
        <button class="close-btn" @click="emit('close')">✕</button>
      </div>

      <div v-if="mode === 'display'" class="qr-content">
        <p class="desc">Scan with another device or copy the signal token for direct WebRTC LAN mesh:</p>
        <div v-if="qrUrl" class="qr-box">
          <img :src="qrUrl" alt="QR Code" class="qr-image" />
        </div>
        <div class="copy-bar">
          <input type="text" readonly :value="signalData" class="signal-input" />
          <button class="copy-btn" @click="copyText">
            {{ copied ? 'COPIED!' : 'COPY' }}
          </button>
        </div>
      </div>

      <div v-else class="input-content">
        <p class="desc">Paste the host's WebRTC offer or answer token below:</p>
        <textarea
          v-model="inputVal"
          rows="5"
          placeholder="Paste signal token here..."
          class="signal-textarea"
        ></textarea>
        <button class="submit-btn" @click="submit">CONNECT PEER</button>
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
}

.modal-card {
  background: #0e121d;
  border: 1px solid rgba(0, 240, 255, 0.4);
  border-radius: 8px;
  width: 90%;
  max-width: 480px;
  padding: 20px;
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
  letter-spacing: 1px;
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
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 14px;
}

.qr-box {
  display: flex;
  justify-content: center;
  margin-bottom: 16px;
}

.qr-image {
  width: 200px;
  height: 200px;
  border-radius: 6px;
  border: 2px solid #00f0ff;
}

.copy-bar {
  display: flex;
  gap: 8px;
}

.signal-input, .signal-textarea {
  flex: 1;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #00f0ff;
  font-family: 'JetBrains Mono', monospace;
  padding: 8px 12px;
  border-radius: 4px;
  font-size: 12px;
}

.copy-btn, .submit-btn {
  background: #00f0ff;
  border: none;
  color: #0b0d17;
  font-weight: 700;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  letter-spacing: 1px;
}

.submit-btn {
  width: 100%;
  margin-top: 14px;
}
</style>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import type { CoreId } from './game/config'
import { getDailySeed } from './game/prng'
import { SceneRenderer } from './game/scene'
import { GameEngine } from './game/engine'
import type { PlayerState, KillMsg, HitConfirmMsg, NostrRoom } from './net/types'
import { publishRoom, subscribeRooms, sendSignalingMessage, subscribeSignaling, myPubkey } from './net/nostr'
import { P2PHost, P2PClient } from './net/webrtc'
import { encodeSignal, decodeSignal } from './net/qr'

import Lobby from './components/Lobby.vue'
import Hud from './components/Hud.vue'
import Scoreboard from './components/Scoreboard.vue'
import QrModal from './components/QrModal.vue'
import LanModal from './components/LanModal.vue'
import { LanSignaler } from './net/lan'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const inLobby = ref(true)
const callsign = ref(localStorage.getItem('ltown_callsign') || 'Pilot-' + Math.floor(100 + Math.random() * 900))
const selectedCore = ref<CoreId>('telepotu')

// Match State
const localPlayer = ref<PlayerState>({} as any)
const matchTime = ref(600)
const leaderboard = ref<{ id: number; name: string; score: number }[]>([])
const hvtId = ref<number | null>(null)
const killFeed = ref<KillMsg[]>([])
const hitFlash = ref(false)
const hitConfirm = ref({ show: false, amount: 0, killed: false })
const showScoreboard = ref(false)

// NOSTR Rooms State
const nostrRooms = ref<NostrRoom[]>([])
const isPublishingRoom = ref(false)
let nostrSubClose: (() => void) | null = null

// QR / LAN Modal State
const qrModal = ref({
  show: false,
  title: '',
  signalData: '',
  mode: 'display' as 'display' | 'input',
  pendingCallback: null as ((data: any) => void) | null
})

// Simplified LAN Modal State
const lanModal = ref({
  show: false,
  mode: 'join' as 'host' | 'join',
  connectedPeersCount: 1
})
const lanModalRef = ref<InstanceType<typeof LanModal> | null>(null)
let lanSignaler: LanSignaler | null = null

let engine: GameEngine | null = null
let sceneRenderer: SceneRenderer | null = null
let p2pHost: P2PHost | null = null
let p2pClient: P2PClient | null = null

onMounted(() => {
  // Listen for Tab or F to toggle scoreboard
  window.addEventListener('keydown', handleGlobalKey)
  window.addEventListener('keyup', handleGlobalKeyUp)

  // Subscribe to NOSTR rooms
  nostrSubClose = subscribeRooms((room) => {
    if (!nostrRooms.value.some(r => r.id === room.id)) {
      nostrRooms.value.push(room)
    }
  })
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKey)
  window.removeEventListener('keyup', handleGlobalKeyUp)
  nostrSubClose?.()
  engine?.destroy()
})

const handleGlobalKey = (e: KeyboardEvent) => {
  if (e.key === 'Tab' || e.key.toLowerCase() === 'f') {
    e.preventDefault()
    showScoreboard.value = true
  }
}

const handleGlobalKeyUp = (e: KeyboardEvent) => {
  if (e.key === 'Tab' || e.key.toLowerCase() === 'f') {
    showScoreboard.value = false
  }
}

const initEngine = (seed: number, mode: 'solo' | 'host' | 'client') => {
  if (!canvasRef.value) return
  localStorage.setItem('ltown_callsign', callsign.value)

  sceneRenderer = new SceneRenderer(canvasRef.value)
  engine = new GameEngine(
    canvasRef.value,
    sceneRenderer,
    seed,
    callsign.value,
    selectedCore.value,
    mode,
    {
      onHudUpdate: (p, time, hvt) => {
        localPlayer.value = { ...p }
        matchTime.value = time
        hvtId.value = hvt
      },
      onHit: () => {
        hitFlash.value = true
        setTimeout(() => { hitFlash.value = false }, 150)
      },
      onHitConfirm: (msg: HitConfirmMsg) => {
        hitConfirm.value = { show: true, amount: msg.amount, killed: msg.killed }
        setTimeout(() => { hitConfirm.value.show = false }, 400)
      },
      onKill: (msg: KillMsg) => {
        killFeed.value.unshift(msg)
        if (killFeed.value.length > 5) killFeed.value.pop()
      },
      onLeaderboardUpdate: (lb) => {
        leaderboard.value = lb
      }
    }
  )

  inLobby.value = false
  engine.start()
}

// 1. Launch Solo Mode with Bots
const startSolo = () => {
  const seed = getDailySeed()
  initEngine(seed, 'solo')
}

// 2. Host NOSTR Match
const createNostrRoom = async () => {
  isPublishingRoom.value = true
  const roomId = crypto.randomUUID().slice(0, 8)
  const seed = getDailySeed()

  const room: NostrRoom = {
    id: roomId,
    name: `${callsign.value}'s Trial`,
    seed,
    core: selectedCore.value,
    players: 1,
    maxPlayers: 16,
    createdAt: Date.now(),
    pubkey: myPubkey
  }

  p2pHost = new P2PHost(
    (msg, fromId) => engine?.handleNetworkMessage(msg, fromId),
    (peer) => console.log('Peer joined trial:', peer.id),
    (id) => console.log('Peer left trial:', id)
  )

  // Listen for NOSTR signaling DMs
  subscribeSignaling(async (data, fromPubkey) => {
    if (data.type === 'offer') {
      const pid = await p2pHost!.handleIncomingOffer(data.offer, async (answer) => {
        await sendSignalingMessage(fromPubkey, { type: 'answer', answer, playerId: pid })
      })
    }
  })

  // Launch match immediately for host (no blocking on remote relay network)
  initEngine(seed, 'host')
  engine?.setHostNetwork(p2pHost)

  // Publish room to NOSTR relays in background
  publishRoom(room).finally(() => {
    isPublishingRoom.value = false
  })
}

// 3. Join NOSTR Room
const joinNostrRoom = async (room: NostrRoom) => {
  p2pClient = new P2PClient(
    (msg) => engine?.handleNetworkMessage(msg),
    () => console.log('Connected to P2P Host'),
    () => console.log('Disconnected from P2P Host')
  )

  // Listen for answer from host
  const unsub = subscribeSignaling(async (data) => {
    if (data.type === 'answer') {
      await p2pClient!.handleAnswer(data.answer)
      unsub()
    }
  })

  // Create offer and send to host
  await p2pClient.createOffer(async (offer) => {
    await sendSignalingMessage(room.pubkey, { type: 'offer', offer })
  })

  initEngine(room.seed || getDailySeed(), 'client')
  engine?.setClientNetwork(p2pClient)
}

// 4. Host LAN via simple Host Address
const hostLan = async () => {
  const seed = getDailySeed()
  p2pHost = new P2PHost(
    (msg, fromId) => engine?.handleNetworkMessage(msg, fromId),
    () => {
      lanModal.value.connectedPeersCount = (p2pHost?.peers.size || 0) + 1
    },
    () => {
      lanModal.value.connectedPeersCount = (p2pHost?.peers.size || 0) + 1
    }
  )

  lanSignaler = new LanSignaler()
  try {
    const ws = await lanSignaler.connect(window.location.host || 'localhost:30300')
    ws.send(JSON.stringify({
      type: 'register_host',
      seed,
      name: callsign.value,
      core: selectedCore.value
    }))

    ws.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'peer_offer') {
          await p2pHost!.handleIncomingOffer(msg.offer, (answer) => {
            ws.send(JSON.stringify({
              type: 'host_answer',
              peerId: msg.peerId,
              answer
            }))
          })
        }
      } catch (err) {
        console.warn('LAN signaling error:', err)
      }
    }
  } catch (err) {
    console.warn('Local LAN websocket signaling broker unavailable:', err)
  }

  lanModal.value = {
    show: true,
    mode: 'host',
    connectedPeersCount: 1
  }
}

const startHostMatch = () => {
  const seed = getDailySeed()
  lanModal.value.show = false
  initEngine(seed, 'host')
  engine?.setHostNetwork(p2pHost!)
}

// 5. Join LAN via Host Address
const joinLan = () => {
  lanModal.value = {
    show: true,
    mode: 'join',
    connectedPeersCount: 1
  }
}

const handleJoinLan = async (hostAddress: string) => {
  lanSignaler = new LanSignaler()
  try {
    const ws = await lanSignaler.connect(hostAddress)
    p2pClient = new P2PClient(
      (msg) => engine?.handleNetworkMessage(msg),
      () => console.log('Connected to LAN host DataChannel!')
    )

    ws.onmessage = async (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'host_answer') {
          await p2pClient!.handleAnswer(msg.answer)
          lanModal.value.show = false
          initEngine(msg.seed || getDailySeed(), 'client')
          engine?.setClientNetwork(p2pClient!)
        } else if (msg.type === 'error') {
          lanModalRef.value?.setConnecting(false, msg.message)
        }
      } catch (err) {
        lanModalRef.value?.setConnecting(false, 'Failed to process host answer')
      }
    }

    await p2pClient.createOffer((offer) => {
      ws.send(JSON.stringify({
        type: 'peer_offer',
        offer,
        callsign: callsign.value
      }))
    })
  } catch (err: any) {
    lanModalRef.value?.setConnecting(false, err.message || 'Could not connect to host address')
  }
}

const switchToAirgap = () => {
  lanModal.value.show = false
  qrModal.value = {
    show: true,
    title: 'AIR-GAP SIGNALING',
    signalData: '',
    mode: 'input',
    pendingCallback: null
  }
}

const handleSignalSubmit = (val: string) => {
  if (qrModal.value.pendingCallback) {
    qrModal.value.pendingCallback(val)
  } else if (p2pClient) {
    try {
      const answer = decodeSignal(val)
      p2pClient.handleAnswer(answer)
      qrModal.value.show = false
    } catch {
      alert('Failed to parse answer token')
    }
  }
}
</script>

<template>
  <div class="app-root">
    <!-- 3D WebGL Canvas -->
    <canvas ref="canvasRef" class="render-canvas"></canvas>

    <!-- Lobby Menu Overlay -->
    <Lobby
      v-if="inLobby"
      v-model:callsign="callsign"
      v-model:selectedCore="selectedCore"
      :rooms="nostrRooms"
      :is-publishing="isPublishingRoom"
      @start-solo="startSolo"
      @create-nostr-room="createNostrRoom"
      @join-nostr-room="joinNostrRoom"
      @host-lan="hostLan"
      @join-lan="joinLan"
      @refresh-rooms="() => {}"
    />

    <!-- In-Game HUD -->
    <Hud
      v-else
      :player="localPlayer"
      :match-time="matchTime"
      :kill-feed="killFeed"
      :hit-flash="hitFlash"
      :hit-confirm="hitConfirm"
    />

    <!-- Tab / F Scoreboard -->
    <Scoreboard
      :show="showScoreboard"
      :leaderboard="leaderboard"
      :hvt-id="hvtId"
      :local-player-id="localPlayer.id || 1"
    />

    <!-- Simplified LAN Modal (Host Address) -->
    <LanModal
      ref="lanModalRef"
      :show="lanModal.show"
      :mode="lanModal.mode"
      :connected-peers-count="lanModal.connectedPeersCount"
      @close="lanModal.show = false"
      @join="handleJoinLan"
      @start-match="startHostMatch"
      @switch-airgap="switchToAirgap"
    />

    <!-- Air-gapped QR / Token Modal -->
    <QrModal
      :show="qrModal.show"
      :title="qrModal.title"
      :signal-data="qrModal.signalData"
      :mode="qrModal.mode"
      @close="qrModal.show = false"
      @submit-signal="handleSignalSubmit"
    />
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

body, html {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #080a10;
}

.app-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.render-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>

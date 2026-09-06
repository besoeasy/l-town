import type { NetMessage, PlayerState, GameStateMsg } from './types'

export interface PeerConnection {
  id: number
  pc: RTCPeerConnection
  dc: RTCDataChannel | null
  player: PlayerState
}

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' }
  ]
}

export class P2PHost {
  public peers = new Map<number, PeerConnection>()
  private nextPlayerId = 2
  private onMessageCallback?: (msg: NetMessage, fromId: number) => void
  private onPeerJoinedCallback?: (peer: PeerConnection) => void
  private onPeerLeftCallback?: (playerId: number) => void

  constructor(
    onMessage: (msg: NetMessage, fromId: number) => void,
    onPeerJoined?: (peer: PeerConnection) => void,
    onPeerLeft?: (playerId: number) => void
  ) {
    this.onMessageCallback = onMessage
    this.onPeerJoinedCallback = onPeerJoined
    this.onPeerLeftCallback = onPeerLeft
  }

  async handleIncomingOffer(
    offer: RTCSessionDescriptionInit,
    onSignalReady: (answer: RTCSessionDescriptionInit) => void
  ): Promise<number> {
    const playerId = this.nextPlayerId++
    const pc = new RTCPeerConnection(RTC_CONFIG)
    const peer: PeerConnection = {
      id: playerId,
      pc,
      dc: null,
      player: {} as any
    }

    pc.ondatachannel = (e) => {
      peer.dc = e.channel
      this.setupDataChannel(peer)
    }

    pc.onicecandidate = (e) => {
      // trickle or gathered
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    // Wait briefly for candidate gathering
    setTimeout(() => {
      if (pc.localDescription) {
        onSignalReady(pc.localDescription)
      }
    }, 200)

    this.peers.set(playerId, peer)
    return playerId
  }

  addIceCandidate(playerId: number, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(playerId)
    if (peer && peer.pc) {
      peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn)
    }
  }

  private setupDataChannel(peer: PeerConnection) {
    if (!peer.dc) return
    peer.dc.onopen = () => {
      console.log(`[Host] Peer ${peer.id} connected via DataChannel`)
      if (this.onPeerJoinedCallback) {
        this.onPeerJoinedCallback(peer)
      }
    }
    peer.dc.onclose = () => {
      console.log(`[Host] Peer ${peer.id} disconnected`)
      this.peers.delete(peer.id)
      if (this.onPeerLeftCallback) {
        this.onPeerLeftCallback(peer.id)
      }
    }
    peer.dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as NetMessage
        if (this.onMessageCallback) {
          this.onMessageCallback(msg, peer.id)
        }
      } catch (err) {
        console.warn('Error parsing peer message:', err)
      }
    }
  }

  broadcast(msg: NetMessage, exceptId?: number) {
    const data = JSON.stringify(msg)
    for (const [id, peer] of this.peers) {
      if (id === exceptId) continue
      if (peer.dc && peer.dc.readyState === 'open') {
        try {
          peer.dc.send(data)
        } catch {}
      }
    }
  }

  sendTo(playerId: number, msg: NetMessage) {
    const peer = this.peers.get(playerId)
    if (peer && peer.dc && peer.dc.readyState === 'open') {
      try {
        peer.dc.send(JSON.stringify(msg))
      } catch {}
    }
  }

  destroy() {
    for (const peer of this.peers.values()) {
      peer.dc?.close()
      peer.pc.close()
    }
    this.peers.clear()
  }
}

export class P2PClient {
  public pc: RTCPeerConnection | null = null
  public dc: RTCDataChannel | null = null
  public isConnected = false
  private onMessageCallback?: (msg: NetMessage) => void
  private onConnectedCallback?: () => void
  private onDisconnectedCallback?: () => void

  constructor(
    onMessage: (msg: NetMessage) => void,
    onConnected?: () => void,
    onDisconnected?: () => void
  ) {
    this.onMessageCallback = onMessage
    this.onConnectedCallback = onConnected
    this.onDisconnectedCallback = onDisconnected
  }

  async createOffer(onSignalReady: (offer: RTCSessionDescriptionInit) => void): Promise<RTCPeerConnection> {
    this.pc = new RTCPeerConnection(RTC_CONFIG)
    this.dc = this.pc.createDataChannel('game', {
      ordered: false,
      maxRetransmits: 0 // low-latency unreliable for game ticks
    })

    this.dc.onopen = () => {
      console.log('[Client] Connected to host DataChannel')
      this.isConnected = true
      if (this.onConnectedCallback) this.onConnectedCallback()
    }

    this.dc.onclose = () => {
      console.log('[Client] DataChannel closed')
      this.isConnected = false
      if (this.onDisconnectedCallback) this.onDisconnectedCallback()
    }

    this.dc.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data) as NetMessage
        if (this.onMessageCallback) {
          this.onMessageCallback(msg)
        }
      } catch (err) {
        console.warn('Failed to parse host msg:', err)
      }
    }

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    setTimeout(() => {
      if (this.pc?.localDescription) {
        onSignalReady(this.pc.localDescription)
      }
    }, 200)

    return this.pc
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (this.pc) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer))
    }
  }

  addIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.pc) {
      this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(console.warn)
    }
  }

  send(msg: NetMessage) {
    if (this.dc && this.dc.readyState === 'open') {
      try {
        this.dc.send(JSON.stringify(msg))
      } catch {}
    }
  }

  destroy() {
    this.dc?.close()
    this.pc?.close()
    this.dc = null
    this.pc = null
    this.isConnected = false
  }
}

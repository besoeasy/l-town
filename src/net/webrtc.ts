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
    { urls: 'stun:global.stun.twilio.com:3478' },
    // Free fallback TURN for symmetric NATs (best-effort; host/srflx tried first)
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
  ]
}

export type IceCandidateHandler = (candidate: RTCIceCandidateInit) => void
export type ConnStateHandler = (state: RTCPeerConnectionState, peerId?: number) => void

export class P2PHost {
  public peers = new Map<number, PeerConnection>()
  private nextPlayerId = 2
  private pubkeyToPeer = new Map<string, number>()
  private pendingIce = new Map<number, RTCIceCandidateInit[]>()
  private onMessageCallback?: (msg: NetMessage, fromId: number) => void
  private onPeerJoinedCallback?: (peer: PeerConnection) => void
  private onPeerLeftCallback?: (playerId: number) => void
  private onStateChange?: ConnStateHandler

  constructor(
    onMessage: (msg: NetMessage, fromId: number) => void,
    onPeerJoined?: (peer: PeerConnection) => void,
    onPeerLeft?: (playerId: number) => void,
    onStateChange?: ConnStateHandler
  ) {
    this.onMessageCallback = onMessage
    this.onPeerJoinedCallback = onPeerJoined
    this.onPeerLeftCallback = onPeerLeft
    this.onStateChange = onStateChange
  }

  /** Remember which peer belongs to a signaling identity (Nostr pubkey). */
  bindPubkey(pubkey: string, playerId: number) {
    this.pubkeyToPeer.set(pubkey, playerId)
  }

  /**
   * Drop a previous peer from the same identity if it never connected
   * (lost offer/answer, duplicate delivery). Never touches live peers.
   * Returns true if a live peer already exists (offer is a duplicate).
   */
  replaceStalePeer(pubkey: string): boolean {
    const existing = this.pubkeyToPeer.get(pubkey)
    if (existing === undefined) return false
    const peer = this.peers.get(existing)
    if (!peer) {
      this.pubkeyToPeer.delete(pubkey)
      return false
    }
    if (peer.dc && peer.dc.readyState === 'open') return true
    try { peer.dc?.close() } catch {}
    try { peer.pc.close() } catch {}
    this.peers.delete(existing)
    return false
  }

  isPeerLive(playerId: number): boolean {
    const peer = this.peers.get(playerId)
    return !!peer?.dc && peer.dc.readyState === 'open'
  }

  async handleIncomingOffer(
    offer: RTCSessionDescriptionInit,
    onSignalReady: (answer: RTCSessionDescriptionInit) => void,
    onIceCandidate?: IceCandidateHandler,
    assignedId?: number
  ): Promise<number> {
    const playerId = assignedId || this.nextPlayerId++
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

    // Trickle ICE: stream candidates as they gather (no waiting)
    pc.onicecandidate = (e) => {
      if (e.candidate && onIceCandidate) {
        const c = e.candidate.toJSON()
        if (c.candidate) onIceCandidate(c)
      }
    }
    pc.onconnectionstatechange = () => {
      console.log(`[Host] Peer ${playerId} connection: ${pc.connectionState}`)
      if (this.onStateChange) this.onStateChange(pc.connectionState, playerId)
      if ((pc.connectionState === 'failed' || pc.connectionState === 'closed') && !this.isPeerLive(playerId)) {
        this.peers.delete(playerId)
      }
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer))
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)

    // Flush any ICE candidates that arrived before the remote description
    const queued = this.pendingIce.get(playerId)
    if (queued) {
      this.pendingIce.delete(playerId)
      for (const c of queued) {
        pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      }
    }

    // Send the answer immediately; remaining candidates trickle afterwards
    if (pc.localDescription) {
      onSignalReady(pc.localDescription)
    }

    this.peers.set(playerId, peer)
    return playerId
  }

  addIceCandidate(playerId: number, candidate: RTCIceCandidateInit) {
    const peer = this.peers.get(playerId)
    if (!peer || !peer.pc) return
    if (peer.pc.remoteDescription) {
      peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
    } else {
      let arr = this.pendingIce.get(playerId)
      if (!arr) {
        arr = []
        this.pendingIce.set(playerId, arr)
      }
      arr.push(candidate)
    }
  }

  addIceCandidateByPubkey(pubkey: string, candidate: RTCIceCandidateInit) {
    const id = this.pubkeyToPeer.get(pubkey)
    if (id !== undefined) this.addIceCandidate(id, candidate)
  }

  private setupDataChannel(peer: PeerConnection) {
    if (!peer.dc) return
    peer.dc.onopen = () => {
      console.log(`[Host] Peer ${peer.id} connected via DataChannel`)
      peer.dc?.send(JSON.stringify({
        type: 'welcome',
        playerId: peer.id,
        seed: 12345,
        hostId: 1
      }))
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
      try { peer.dc?.close() } catch {}
      try { peer.pc.close() } catch {}
    }
    this.peers.clear()
    this.pubkeyToPeer.clear()
    this.pendingIce.clear()
  }
}

export class P2PClient {
  public pc: RTCPeerConnection | null = null
  public dc: RTCDataChannel | null = null
  public isConnected = false
  private pendingIce: RTCIceCandidateInit[] = []
  private onMessageCallback?: (msg: NetMessage) => void
  private onConnectedCallback?: () => void
  private onDisconnectedCallback?: () => void
  private onStateChange?: ConnStateHandler

  constructor(
    onMessage: (msg: NetMessage) => void,
    onConnected?: () => void,
    onDisconnected?: () => void,
    onStateChange?: ConnStateHandler
  ) {
    this.onMessageCallback = onMessage
    this.onConnectedCallback = onConnected
    this.onDisconnectedCallback = onDisconnected
    this.onStateChange = onStateChange
  }

  async createOffer(
    onSignalReady: (offer: RTCSessionDescriptionInit) => void,
    onIceCandidate?: IceCandidateHandler
  ): Promise<RTCPeerConnection> {
    this.pc = new RTCPeerConnection(RTC_CONFIG)
    this.dc = this.pc.createDataChannel('game', {
      ordered: true
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

    // Trickle ICE: stream candidates as they gather (no waiting)
    this.pc.onicecandidate = (e) => {
      if (e.candidate && onIceCandidate) {
        const c = e.candidate.toJSON()
        if (c.candidate) onIceCandidate(c)
      }
    }
    this.pc.onconnectionstatechange = () => {
      const st = this.pc?.connectionState
      console.log(`[Client] connection: ${st}`)
      if (st && this.onStateChange) this.onStateChange(st)
    }

    const offer = await this.pc.createOffer()
    await this.pc.setLocalDescription(offer)

    // Send the offer immediately; remaining candidates trickle afterwards
    if (this.pc.localDescription) {
      onSignalReady(this.pc.localDescription)
    }

    return this.pc
  }

  async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (this.pc) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer))
      // Flush ICE candidates that arrived before the answer
      const queued = this.pendingIce
      this.pendingIce = []
      for (const c of queued) {
        this.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
      }
    }
  }

  addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.pc) return
    if (this.pc.remoteDescription) {
      this.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {})
    } else {
      this.pendingIce.push(candidate)
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

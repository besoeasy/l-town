import { Peer, type DataConnection } from 'peerjs'
import type { NetMessage, WelcomeMsg } from './types'

// Public PeerJS Cloud broker + Google/Twilio STUN + OpenRelay TURN
export const PEERJS_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  secure: true,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' }
    ]
  }
}

const PEER_PREFIX = 'ltown3049-'
const CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

export function generateRoomCode(): string {
  let code = ''
  for (let i = 0; i < 4; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  }
  return code
}

export class PeerJSHost {
  public peers = new Map<number, DataConnection>()
  private nextPlayerId = 2
  public seed = 12345
  public peer: Peer | null = null
  public roomCode: string
  public isOpen = false

  constructor(
    roomCode: string,
    private onMessage: (msg: NetMessage, fromId: number) => void,
    private onPeerJoined?: (peerId: number) => void,
    private onPeerLeft?: (peerId: number) => void,
    private onReady?: (code: string) => void,
    private onError?: (err: any) => void
  ) {
    this.roomCode = roomCode.trim().toUpperCase()
    const hostPeerId = `${PEER_PREFIX}${this.roomCode}`

    this.peer = new Peer(hostPeerId, PEERJS_CONFIG)

    this.peer.on('open', (id) => {
      console.log(`[PeerJSHost] Room ${this.roomCode} opened on PeerJS Cloud (${id})`)
      this.isOpen = true
      if (this.onReady) this.onReady(this.roomCode)
    })

    this.peer.on('connection', (conn) => {
      const assignedPlayerId = this.nextPlayerId++
      console.log(`[PeerJSHost] Connection from ${conn.peer}, assigned ID ${assignedPlayerId}`)

      conn.on('open', () => {
        this.peers.set(assignedPlayerId, conn)
        console.log(`[PeerJSHost] Peer ${assignedPlayerId} DataChannel OPEN. Total: ${this.peers.size}`)

        const welcome: WelcomeMsg = {
          type: 'welcome',
          playerId: assignedPlayerId,
          seed: this.seed,
          hostId: 1
        }
        conn.send(welcome)

        if (this.onPeerJoined) this.onPeerJoined(assignedPlayerId)
      })

      conn.on('data', (raw: any) => {
        try {
          const msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as NetMessage
          this.onMessage(msg, assignedPlayerId)
        } catch (e) {
          console.warn(`[PeerJSHost] Bad msg from ${assignedPlayerId}:`, e)
        }
      })

      conn.on('close', () => {
        console.log(`[PeerJSHost] Peer ${assignedPlayerId} disconnected`)
        this.peers.delete(assignedPlayerId)
        if (this.onPeerLeft) this.onPeerLeft(assignedPlayerId)
      })

      conn.on('error', (err) => {
        console.warn(`[PeerJSHost] Peer ${assignedPlayerId} error:`, err)
      })
    })

    this.peer.on('error', (err: any) => {
      console.error('[PeerJSHost] Fatal peer error:', err)
      if (this.onError) this.onError(err)
    })
  }

  setSeed(seed: number) {
    this.seed = seed
  }

  broadcast(msg: NetMessage, exceptId?: number) {
    for (const [id, conn] of this.peers) {
      if (id !== exceptId && conn.open) {
        try {
          conn.send(msg)
        } catch {}
      }
    }
  }

  sendTo(peerId: number, msg: NetMessage) {
    const conn = this.peers.get(peerId)
    if (conn && conn.open) {
      try {
        conn.send(msg)
      } catch {}
    }
  }

  destroy() {
    for (const conn of this.peers.values()) {
      try { conn.close() } catch {}
    }
    this.peers.clear()
    this.peer?.destroy()
    this.peer = null
    this.isOpen = false
  }
}

export class PeerJSClient {
  public isConnected = false
  public peer: Peer | null = null
  public conn: DataConnection | null = null
  public roomCode: string

  constructor(
    roomCode: string,
    private onMessage: (msg: NetMessage) => void,
    private onConnected?: () => void,
    private onDisconnected?: () => void,
    private onError?: (err: any) => void
  ) {
    this.roomCode = roomCode.trim().toUpperCase()
    const targetHostPeerId = `${PEER_PREFIX}${this.roomCode}`

    this.peer = new Peer(PEERJS_CONFIG)

    this.peer.on('open', (myId) => {
      console.log(`[PeerJSClient] My peer ID: ${myId}. Connecting to ${targetHostPeerId}...`)
      const conn = this.peer!.connect(targetHostPeerId, {
        reliable: true
      })
      this.conn = conn

      conn.on('open', () => {
        console.log(`[PeerJSClient] Connected to host ${targetHostPeerId} DataChannel!`)
        this.isConnected = true
        if (this.onConnected) this.onConnected()
      })

      conn.on('data', (raw: any) => {
        try {
          const msg = (typeof raw === 'string' ? JSON.parse(raw) : raw) as NetMessage
          this.onMessage(msg)
        } catch (e) {
          console.warn('[PeerJSClient] Parse error:', e)
        }
      })

      conn.on('close', () => {
        console.log('[PeerJSClient] Disconnected from host')
        this.isConnected = false
        if (this.onDisconnected) this.onDisconnected()
      })

      conn.on('error', (err) => {
        console.warn('[PeerJSClient] Connection error:', err)
        if (this.onError) this.onError(err)
      })
    })

    this.peer.on('error', (err: any) => {
      console.error('[PeerJSClient] Fatal peer error:', err)
      this.isConnected = false
      if (this.onError) this.onError(err)
    })
  }

  send(msg: NetMessage) {
    if (this.conn && this.conn.open) {
      try {
        this.conn.send(msg)
      } catch {}
    }
  }

  destroy() {
    this.conn?.close()
    this.peer?.destroy()
    this.conn = null
    this.peer = null
    this.isConnected = false
  }
}

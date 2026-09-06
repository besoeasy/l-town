import { SimplePool, generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools'
import { nip04 } from 'nostr-tools'
import type { NostrRoom } from './types'

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex
  const out = new Uint8Array(clean.length / 2)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

function getInitialRelays(): string[] {
  const relays: string[] = []
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    const isLocal = host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      window.location.port === '30300'
    if (isLocal) {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      relays.push(`${proto}//${window.location.host}/nostr`)
    }
  }
  relays.push(
    'wss://relay.damus.io',
    'wss://relay.primal.net',
    'wss://nostr.mom',
    'wss://nos.lol'
  )
  return relays
}

export const NOSTR_RELAYS = getInitialRelays()

const KIND_ROOM = 30303
const pool = new SimplePool()

let skHex = localStorage.getItem('ltown_nostr_sk')
if (!skHex) {
  const sk = generateSecretKey()
  skHex = bytesToHex(sk)
  localStorage.setItem('ltown_nostr_sk', skHex)
}
const secretKeyBytes = hexToBytes(skHex)
export const myPubkey = getPublicKey(secretKeyBytes)

export async function publishRoom(room: NostrRoom) {
  try {
    const event = finalizeEvent({
      kind: KIND_ROOM,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['d', `ltown-${room.id}`],
        ['t', 'l-town'],
        ['name', room.name],
        ['core', room.core],
        ['seed', String(room.seed)]
      ],
      content: JSON.stringify(room)
    }, secretKeyBytes)

    await Promise.any(pool.publish(NOSTR_RELAYS, event))
    return event
  } catch (e) {
    console.warn('Failed to publish NOSTR room:', e)
    return null
  }
}

export function subscribeRooms(onRoom: (room: NostrRoom) => void): () => void {
  try {
    const sub = pool.subscribeMany(NOSTR_RELAYS, [
      {
        kinds: [KIND_ROOM],
        '#t': ['l-town'],
        limit: 30
      }
    ], {
      onevent(ev) {
        try {
          const room = JSON.parse(ev.content) as NostrRoom
          room.pubkey = ev.pubkey
          onRoom(room)
        } catch {}
      }
    })
    return () => sub.close()
  } catch (e) {
    console.warn('NOSTR room subscription error:', e)
    return () => {}
  }
}

export async function sendSignalingMessage(targetPubkey: string, data: any) {
  try {
    const json = JSON.stringify(data)
    const encrypted = await nip04.encrypt(secretKeyBytes, targetPubkey, json)
    const event = finalizeEvent({
      kind: 4,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', targetPubkey]],
      content: encrypted
    }, secretKeyBytes)

    await Promise.any(pool.publish(NOSTR_RELAYS, event))
  } catch (e) {
    console.warn('Failed to send NOSTR signaling msg:', e)
  }
}

export function subscribeSignaling(onMessage: (data: any, fromPubkey: string) => void): () => void {
  try {
    const sub = pool.subscribeMany(NOSTR_RELAYS, [
      {
        kinds: [4],
        '#p': [myPubkey],
        since: Math.floor(Date.now() / 1000) - 30
      }
    ], {
      async onevent(ev) {
        try {
          const decrypted = await nip04.decrypt(secretKeyBytes, ev.pubkey, ev.content)
          const data = JSON.parse(decrypted)
          onMessage(data, ev.pubkey)
        } catch {}
      }
    })
    return () => sub.close()
  } catch (e) {
    console.warn('NOSTR signaling subscription error:', e)
    return () => {}
  }
}

// Automated LAN signaling over local WebSocket
export interface ServerInfo {
  localIp: string
  port: number
}

export async function fetchServerInfo(): Promise<ServerInfo> {
  try {
    const res = await fetch('/api/info')
    if (res.ok) return await res.json()
  } catch {}
  return {
    localIp: window.location.hostname || 'localhost',
    port: Number(window.location.port) || 30300
  }
}

export class LanSignaler {
  private ws: WebSocket | null = null

  connect(hostAddress: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      // Clean host address (strip http:// or https:// if user pasted full URL)
      let clean = hostAddress.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
      if (!clean) clean = window.location.host || 'localhost:30300'
      if (!clean.includes(':')) clean = `${clean}:30300`

      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const url = `${proto}//${clean}`

      const ws = new WebSocket(url)
      this.ws = ws

      const timer = setTimeout(() => {
        ws.close()
        reject(new Error('Connection timed out to ' + url))
      }, 5000)

      ws.onopen = () => {
        clearTimeout(timer)
        resolve(ws)
      }

      ws.onerror = (e) => {
        clearTimeout(timer)
        reject(new Error('Could not connect to LAN host at ' + url))
      }
    })
  }

  send(msg: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg))
    }
  }

  close() {
    this.ws?.close()
    this.ws = null
  }
}

// JL-136: Minimal browser WebSocket client for real-time collaboration.
//
// Connects to the backend `/ws` endpoint with the auth token as a query param,
// auto-reconnects with exponential backoff, lets callers join/leave rooms and
// subscribe to server messages. Designed to degrade gracefully: if the socket
// can't be created or drops, the app keeps working — callbacks simply stop
// firing until the connection recovers.

const TOKEN_KEY = 'jira_auth_token'

function getToken() {
  try {
    return (
      window.localStorage.getItem(TOKEN_KEY) ||
      window.sessionStorage.getItem(TOKEN_KEY) ||
      null
    )
  } catch {
    return null
  }
}

function buildUrl() {
  const token = getToken()
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const base = `${proto}//${window.location.host}/ws`
  return token ? `${base}?token=${encodeURIComponent(token)}` : base
}

export class RealtimeClient {
  constructor() {
    this.ws = null
    this.rooms = new Set()
    this.listeners = new Set()
    this.reconnectAttempts = 0
    this.reconnectTimer = null
    this.shouldReconnect = true
    this.connected = false
  }

  connect() {
    this.shouldReconnect = true
    this._open()
  }

  _open() {
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) return
    let socket
    try {
      socket = new WebSocket(buildUrl())
    } catch {
      this._scheduleReconnect()
      return
    }
    this.ws = socket

    socket.onopen = () => {
      this.connected = true
      this.reconnectAttempts = 0
      // Re-join any rooms we were in before a reconnect.
      for (const room of this.rooms) this._send({ type: 'join', room })
    }

    socket.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      for (const cb of this.listeners) {
        try {
          cb(msg)
        } catch {
          // A misbehaving listener must not break dispatch to the others.
        }
      }
    }

    socket.onclose = () => {
      this.connected = false
      this.ws = null
      if (this.shouldReconnect) this._scheduleReconnect()
    }

    socket.onerror = () => {
      // Let onclose handle reconnection; just avoid an unhandled error.
      try {
        socket.close()
      } catch {
        // ignore
      }
    }
  }

  _scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer) return
    // Exponential backoff capped at 30s (1s, 2s, 4s, ... 30s).
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30000)
    this.reconnectAttempts += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._open()
    }, delay)
  }

  _send(message) {
    try {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(JSON.stringify(message))
        return true
      }
    } catch {
      // ignore — will re-send relevant state (joins) on reconnect
    }
    return false
  }

  join(room) {
    if (!room) return
    this.rooms.add(room)
    this._send({ type: 'join', room })
  }

  leave(room) {
    if (!room) return
    this.rooms.delete(room)
    this._send({ type: 'leave', room })
  }

  /** Subscribe to inbound messages. Returns an unsubscribe function. */
  on(callback) {
    this.listeners.add(callback)
    return () => this.listeners.delete(callback)
  }

  close() {
    this.shouldReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      this.ws?.close()
    } catch {
      // ignore
    }
    this.ws = null
    this.connected = false
    this.rooms.clear()
    this.listeners.clear()
  }
}

// Shared singleton so multiple components can piggyback on one connection.
let shared = null

/** Get (creating + connecting on first use) the shared realtime client. */
export function getRealtimeClient() {
  if (!shared) {
    shared = new RealtimeClient()
    shared.connect()
  }
  return shared
}

import { WebSocketServer } from 'ws'
import jwt from 'jsonwebtoken'
import { JWT_SECRET } from '../config.js'

/**
 * JL-136: Real-time collaboration hub.
 *
 * `RoomHub` is the PURE, unit-testable core: it has no `ws`/network
 * dependencies. It manages room membership and presence, and pushes messages
 * to clients through an injected `send(client, message)` function. In
 * production the injected `send` serializes to a live WebSocket; in tests it is
 * a spy. A "client" is any object carrying a `user` identity ({ id, email })
 * and an optional `rooms` Set (the hub maintains it).
 */
export class RoomHub {
  /**
   * @param {object} opts
   * @param {(client: any, message: object) => void} opts.send  Delivery function.
   */
  constructor({ send } = {}) {
    if (typeof send !== 'function') {
      throw new TypeError('RoomHub requires a send(client, message) function')
    }
    this.send = send
    /** @type {Map<string, Set<any>>} room key -> set of clients */
    this.rooms = new Map()
  }

  /** Add `client` to `room`, then broadcast the updated presence to the room. */
  join(client, room) {
    if (!room || !client) return
    let set = this.rooms.get(room)
    if (!set) {
      set = new Set()
      this.rooms.set(room, set)
    }
    set.add(client)
    if (!client.rooms) client.rooms = new Set()
    client.rooms.add(room)
    this._broadcastPresence(room)
  }

  /** Remove `client` from `room`, updating presence for any remaining members. */
  leave(client, room) {
    if (!room || !client) return
    const set = this.rooms.get(room)
    if (!set) return
    if (!set.delete(client)) return
    if (client.rooms) client.rooms.delete(room)
    if (set.size === 0) {
      this.rooms.delete(room)
    } else {
      this._broadcastPresence(room)
    }
  }

  /** Remove `client` from every room it belongs to (used on disconnect). */
  leaveAll(client) {
    if (!client || !client.rooms) return
    for (const room of [...client.rooms]) this.leave(client, room)
  }

  /**
   * Distinct user identities currently in `room`. A single user with multiple
   * connections (tabs) is listed once, keyed by email (falling back to id).
   * @returns {Array<{ id: any, email: string|undefined }>}
   */
  presence(room) {
    const set = this.rooms.get(room)
    if (!set) return []
    const seen = new Map()
    for (const client of set) {
      const u = client.user || {}
      const key = u.email != null ? u.email : u.id
      if (key == null) continue
      if (!seen.has(key)) seen.set(key, { id: u.id, email: u.email })
    }
    return [...seen.values()]
  }

  /**
   * Send `message` to every client in `room`, skipping `exceptClient` when
   * provided. No-op when the room has no members.
   */
  broadcast(room, message, exceptClient = null) {
    const set = this.rooms.get(room)
    if (!set) return
    for (const client of set) {
      if (client === exceptClient) continue
      this.send(client, message)
    }
  }

  _broadcastPresence(room) {
    this.broadcast(room, { type: 'presence', room, users: this.presence(room) })
  }
}

// Module-level hub — set once the WebSocket server is created. Stays null in
// unit tests and any context where realtime was never initialized, which is
// what makes `publish()` a safe no-op there.
let hub = null

const WS_OPEN = 1

/** Serialize + deliver `message` to a live socket, swallowing any error. */
function sendToSocket(client, message) {
  try {
    if (client.readyState === WS_OPEN) {
      client.send(JSON.stringify(message))
    }
  } catch {
    // A broken socket must never break a broadcast to the rest of the room.
  }
}

/**
 * Attach a `WebSocketServer` to an existing HTTP server and wire it to a
 * `RoomHub`. Authentication uses the same JWT secret/logic as `authGuard`,
 * read from a `?token=<JWT>` query param; invalid tokens are closed with 4401.
 *
 * @param {import('http').Server} httpServer
 * @param {{ path?: string }} [opts]
 * @returns {{ wss: WebSocketServer, hub: RoomHub }}
 */
export function createRealtimeServer(httpServer, { path = '/ws' } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path })
  hub = new RoomHub({ send: sendToSocket })

  wss.on('connection', (ws, req) => {
    let user
    try {
      const url = new URL(req.url, 'http://localhost')
      const token = url.searchParams.get('token')
      if (!token) throw new Error('missing token')
      const payload = jwt.verify(token, JWT_SECRET)
      user = { id: payload.sub, email: payload.email }
    } catch {
      // 4401: application-level "Unauthorized" close code (4000–4999 reserved for apps).
      ws.close(4401, 'Unauthorized')
      return
    }

    ws.user = user
    ws.rooms = new Set()

    ws.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(data.toString())
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      if (msg.type === 'join') hub.join(ws, msg.room)
      else if (msg.type === 'leave') hub.leave(ws, msg.room)
    })

    ws.on('close', () => {
      if (hub) hub.leaveAll(ws)
    })
    ws.on('error', () => {
      // Ignore socket-level errors; 'close' handles cleanup.
    })

    sendToSocket(ws, { type: 'connected' })
  })

  return { wss, hub }
}

/**
 * Push `message` to everyone in `room`. Safe no-op when realtime was never
 * initialized (e.g. under test), so route handlers can call it unconditionally.
 */
export function publish(room, message) {
  if (!hub) return
  hub.broadcast(room, message)
}

/** Test/introspection helper: the current module-level hub (or null). */
export function getHub() {
  return hub
}

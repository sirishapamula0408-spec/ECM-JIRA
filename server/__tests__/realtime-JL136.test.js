// @vitest-environment node
// JL-136: unit tests for the real-time collaboration hub.
//
// These exercise the PURE `RoomHub` core with an injected `send` spy — no real
// WebSocket sockets, servers, or timers are ever created. The module imports
// `ws`/`jsonwebtoken` at load, so the file forces the `node` environment (the
// repo default `jsdom` would browser-externalize node: builtins).
import { describe, it, expect, vi } from 'vitest'
import { RoomHub, publish, getHub } from '../services/realtime.js'

/** A minimal fake client: an identity plus the `rooms` Set the hub maintains. */
function makeClient(user) {
  return { user, rooms: new Set() }
}

describe('RoomHub', () => {
  it('requires a send function', () => {
    expect(() => new RoomHub({})).toThrow(TypeError)
  })

  it('join adds a client to a room and notifies the room with presence', () => {
    const send = vi.fn()
    const hub = new RoomHub({ send })
    const a = makeClient({ id: 1, email: 'a@test.com' })

    hub.join(a, 'issue:5')

    // Presence now contains the joined user.
    expect(hub.presence('issue:5')).toEqual([{ id: 1, email: 'a@test.com' }])
    // The room (just `a`) received a presence broadcast.
    expect(send).toHaveBeenCalledWith(
      a,
      expect.objectContaining({ type: 'presence', room: 'issue:5', users: [{ id: 1, email: 'a@test.com' }] }),
    )
  })

  it('presence lists distinct users (dedupes multiple connections of one user)', () => {
    const send = vi.fn()
    const hub = new RoomHub({ send })
    const aTab1 = makeClient({ id: 1, email: 'a@test.com' })
    const aTab2 = makeClient({ id: 1, email: 'a@test.com' }) // same user, second tab
    const b = makeClient({ id: 2, email: 'b@test.com' })

    hub.join(aTab1, 'issue:5')
    hub.join(aTab2, 'issue:5')
    hub.join(b, 'issue:5')

    const users = hub.presence('issue:5')
    expect(users).toHaveLength(2)
    expect(users.map((u) => u.email).sort()).toEqual(['a@test.com', 'b@test.com'])
  })

  it('leave removes a client and re-broadcasts presence to remaining members', () => {
    const send = vi.fn()
    const hub = new RoomHub({ send })
    const a = makeClient({ id: 1, email: 'a@test.com' })
    const b = makeClient({ id: 2, email: 'b@test.com' })
    hub.join(a, 'issue:5')
    hub.join(b, 'issue:5')
    send.mockClear()

    hub.leave(a, 'issue:5')

    expect(hub.presence('issue:5')).toEqual([{ id: 2, email: 'b@test.com' }])
    // The remaining member is notified; the departed member is not.
    expect(send).toHaveBeenCalledWith(b, expect.objectContaining({ type: 'presence', room: 'issue:5' }))
    expect(send).not.toHaveBeenCalledWith(a, expect.anything())
    // Client's own room set is cleaned up.
    expect(a.rooms.has('issue:5')).toBe(false)
  })

  it('leaving the last member drops the room entirely', () => {
    const send = vi.fn()
    const hub = new RoomHub({ send })
    const a = makeClient({ id: 1, email: 'a@test.com' })
    hub.join(a, 'issue:9')
    hub.leave(a, 'issue:9')
    expect(hub.rooms.has('issue:9')).toBe(false)
    expect(hub.presence('issue:9')).toEqual([])
  })

  it('leaveAll removes the client from every room it joined', () => {
    const send = vi.fn()
    const hub = new RoomHub({ send })
    const a = makeClient({ id: 1, email: 'a@test.com' })
    hub.join(a, 'issue:1')
    hub.join(a, 'issue:2')
    hub.leaveAll(a)
    expect(hub.presence('issue:1')).toEqual([])
    expect(hub.presence('issue:2')).toEqual([])
    expect(a.rooms.size).toBe(0)
  })

  it('broadcast reaches all room members except the sender', () => {
    const send = vi.fn()
    const hub = new RoomHub({ send })
    const a = makeClient({ id: 1, email: 'a@test.com' })
    const b = makeClient({ id: 2, email: 'b@test.com' })
    const c = makeClient({ id: 3, email: 'c@test.com' })
    hub.join(a, 'issue:5')
    hub.join(b, 'issue:5')
    hub.join(c, 'issue:5')
    send.mockClear()

    const msg = { type: 'update', entity: 'issue', id: 5, action: 'updated' }
    hub.broadcast('issue:5', msg, a)

    expect(send).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledWith(b, msg)
    expect(send).toHaveBeenCalledWith(c, msg)
    expect(send).not.toHaveBeenCalledWith(a, msg)
  })

  it('broadcast to an unknown/empty room does nothing', () => {
    const send = vi.fn()
    const hub = new RoomHub({ send })
    hub.broadcast('issue:does-not-exist', { type: 'update' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('publish (module-level, uninitialized in unit tests)', () => {
  it('is a no-op when the realtime hub was never initialized', () => {
    // createRealtimeServer is never called here, so the module hub stays null.
    expect(getHub()).toBeNull()
    expect(() => publish('issue:1', { type: 'update', entity: 'issue', id: 1 })).not.toThrow()
  })
})

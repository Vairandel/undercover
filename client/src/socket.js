import { io } from 'socket.io-client'

/**
 * Same-origin in production (one port for everything); Vite proxies in dev.
 *
 * Phones drop their socket constantly — screen lock, wifi handover, a tab going
 * to the background. The client must reconnect quickly and keep trying forever,
 * because giving up means a player is stranded mid-game with no way back.
 */
export const socket = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 400,
  reconnectionDelayMax: 3000,
  randomizationFactor: 0.4,
  timeout: 10000,
})

/**
 * Promise wrapper over socket.io acks, so screens can just `await send(...)`.
 *
 * Failures come in two flavours and callers must be able to tell them apart:
 * a `transient` one means the network hiccuped and the request can be retried,
 * anything else is the server actively refusing. Treating the first like the
 * second is how a player gets thrown out of a game over a slow second.
 */
export function send(event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.timeout(8000).emit(event, payload, (err, res) => {
      if (err) {
        const e = new Error('Le serveur ne répond pas.')
        e.transient = true
        return reject(e)
      }
      if (!res?.ok) return reject(new Error(res?.error ?? 'Erreur inconnue.'))
      resolve(res)
    })
  })
}

const KEY = 'undercover.session'

export function saveSession(session) {
  try {
    localStorage.setItem(KEY, JSON.stringify(session))
  } catch { /* private browsing */ }
}

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null')
  } catch {
    return null
  }
}

export function clearSession() {
  try {
    localStorage.removeItem(KEY)
  } catch { /* private browsing */ }
}

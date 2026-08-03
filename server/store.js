import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data')
const statePath = path.join(dataDir, 'state.json')

const EMPTY = { seenPairs: {}, gamesPlayed: 0, lastTheme: null, rooms: {} }

/** Saved rooms older than this are dropped on load — last night is over. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000

/**
 * Tiny JSON-file store. Deliberately not SQLite: the only thing we persist is
 * "which word pairs has this household already seen", which is a few thousand
 * short strings at most. No native modules, no build tools, no flags — the app
 * stays installable with a plain `npm install` on any machine.
 *
 * Writes are debounced and atomic (write temp, then rename) so a crash mid-game
 * can never leave a truncated file that would wipe the history.
 */
class Store {
  #state
  #timer = null

  constructor() {
    this.#state = this.#load()
  }

  #load() {
    try {
      const raw = fs.readFileSync(statePath, 'utf8')
      return { ...EMPTY, ...JSON.parse(raw) }
    } catch {
      return structuredClone(EMPTY)
    }
  }

  get state() {
    return this.#state
  }

  /** Has this exact pair already been played in this household? */
  hasSeen(themeId, pairIndex) {
    return Boolean(this.#state.seenPairs[themeId]?.includes(pairIndex))
  }

  seenCount(themeId) {
    return this.#state.seenPairs[themeId]?.length ?? 0
  }

  markSeen(themeId, pairIndex) {
    const list = (this.#state.seenPairs[themeId] ??= [])
    if (!list.includes(pairIndex)) list.push(pairIndex)
    this.#state.gamesPlayed += 1
    this.#state.lastTheme = themeId
    this.#persist()
  }

  /**
   * Remembers a room's roster, scores and settings across a restart.
   *
   * Deliberately *not* the game in progress: restoring a half-played round
   * faithfully (turn order, hidden words, pending interrupts) is fragile, while
   * the thing people actually mourn is the evening's leaderboard. So a restart
   * drops you back in the lobby with the same code, the same players and the
   * same scores.
   */
  saveRoom(code, snapshot) {
    this.#state.rooms[code] = { ...snapshot, savedAt: Date.now() }
    this.#persist()
  }

  forgetRoom(code) {
    if (!(code in this.#state.rooms)) return
    delete this.#state.rooms[code]
    this.#persist()
  }

  /** Saved rooms still young enough to be worth restoring. */
  freshRooms() {
    const now = Date.now()
    const out = []
    let expired = false
    for (const [code, room] of Object.entries(this.#state.rooms)) {
      if (now - (room.savedAt ?? 0) > ROOM_TTL_MS) {
        delete this.#state.rooms[code]
        expired = true
      } else {
        out.push([code, room])
      }
    }
    if (expired) this.#persist()
    return out
  }

  /** Called when a theme is exhausted, so it can start cycling again. */
  resetTheme(themeId) {
    delete this.#state.seenPairs[themeId]
    this.#persist()
  }

  resetAll() {
    this.#state = structuredClone(EMPTY)
    this.#persist()
  }

  #persist() {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      try {
        fs.mkdirSync(dataDir, { recursive: true })
        const tmp = `${statePath}.tmp`
        fs.writeFileSync(tmp, JSON.stringify(this.#state), 'utf8')
        fs.renameSync(tmp, statePath)
      } catch (err) {
        console.error('[store] could not persist word history:', err.message)
      }
    }, 250)
  }
}

export const store = new Store()

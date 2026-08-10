import fs from 'node:fs'
import { dataDir, statePath } from './paths.js'

const EMPTY = { seenPairs: {}, gamesPlayed: 0, lastTheme: null, rooms: {} }

/** Saved rooms older than this are dropped on load — last night is over. */
const ROOM_TTL_MS = 24 * 60 * 60 * 1000

/** Ceiling on the saved-room list, well above any real household's evening. */
const MAX_SAVED_ROOMS = 60

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
      const loaded = { ...EMPTY, ...JSON.parse(raw) }
      // Drop the old index-based history in one go: those numbers no longer
      // point at anything meaningful now that pairs are keyed by content.
      for (const [themeId, keys] of Object.entries(loaded.seenPairs ?? {})) {
        const strings = (keys ?? []).filter((k) => typeof k === 'string')
        if (strings.length) loaded.seenPairs[themeId] = strings
        else delete loaded.seenPairs[themeId]
      }
      return loaded
    } catch {
      return structuredClone(EMPTY)
    }
  }

  get state() {
    return this.#state
  }

  /**
   * Has this exact pair already been played in this household?
   *
   * Keyed by the words themselves, not by position in the file: adding or
   * removing a pair used to shift every later index and silently corrupt the
   * whole history. Numeric leftovers from that scheme are ignored on read.
   */
  hasSeen(themeId, pairKey) {
    return Boolean(this.#state.seenPairs[themeId]?.includes(pairKey))
  }

  seenCount(themeId) {
    return (this.#state.seenPairs[themeId] ?? []).filter((k) => typeof k === 'string').length
  }

  markSeen(themeId, pairKey) {
    const list = (this.#state.seenPairs[themeId] ??= [])
    if (!list.includes(pairKey)) list.push(pairKey)
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

    // A room is normally forgotten when the sweeper reclaims it — but a server
    // that is killed outright never sweeps, so its rooms sat in the file for a
    // full day. Enough restarts and the file grew without bound. Keeping only
    // the most recent puts a hard ceiling on it.
    const codes = Object.keys(this.#state.rooms)
    if (codes.length > MAX_SAVED_ROOMS) {
      codes
        .sort((a, b) => (this.#state.rooms[b].savedAt ?? 0) - (this.#state.rooms[a].savedAt ?? 0))
        .slice(MAX_SAVED_ROOMS)
        .forEach((c) => delete this.#state.rooms[c])
    }
    this.#persist()
  }

  forgetRoom(code) {
    if (!(code in this.#state.rooms)) return
    delete this.#state.rooms[code]
    this.#persist()
  }

  /**
   * Saved rooms still young enough to be worth restoring, most recent first.
   *
   * Order matters: the caller only brings back the first handful, and the one
   * you want back after a crash is the game you were playing a minute ago, not
   * a lobby from this morning.
   */
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
    return out.sort((a, b) => (b[1].savedAt ?? 0) - (a[1].savedAt ?? 0))
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

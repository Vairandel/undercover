import { randomUUID } from 'node:crypto'
import { drawPair, listThemes } from '../words.js'
import { getRole, ROLES, OPTIONAL_ROLES } from './roles/index.js'
import { getModifier, MODIFIERS, OPTIONAL_MODIFIERS } from './modifiers/index.js'
import { normalise, sameWord, tooClose } from './text.js'
import { COLORS, AVATARS, freeAvatar, isValidAvatar, isValidColor, randomColor } from './appearance.js'
import { scoreGame, resolvePoints, sanitisePoints, DEFAULT_POINTS } from './scoring.js'

export const PHASES = {
  LOBBY: 'lobby',
  REVEAL: 'reveal',
  DESCRIBE: 'describe',
  DISCUSS: 'discuss',
  VOTE: 'vote',
  TIEBREAK: 'tiebreak',
  REVENGE: 'revenge',
  VOTE_RESULT: 'voteResult',
  MRWHITE_GUESS: 'mrwhiteGuess',
  GAME_OVER: 'gameOver',
}

export const MIN_PLAYERS = 3
export const MAX_PLAYERS = 16

/** Watchers cost almost nothing, but the list still gets broadcast. */
export const MAX_SPECTATORS = 20

/** Placeholder shown when a player let the clock run out without speaking. */
export const NO_CLUE = '…'

/**
 * How long a lobby seat survives a dropped connection.
 *
 * Generous on purpose. Players answer a message, take a call, or let the screen
 * lock while waiting for the game to start — 45 seconds turned out to evict
 * real people mid-lobby. The host can always kick a genuine no-show, so erring
 * long costs nothing and erring short costs someone their seat.
 */
export const RECONNECT_GRACE_MS = 5 * 60_000

/**
 * Written debate, for tables playing with written clues.
 *
 * Kept per round and bounded: the whole log rides along in every state
 * broadcast, so it must stay small. A round's argument rarely needs more than
 * a few dozen lines anyway.
 */
export const CHAT_MAX_LEN = 140
export const CHAT_MAX_PER_ROUND = 60
const CHAT_COOLDOWN_MS = 500

export const DEFAULT_SETTINGS = {
  themeIds: [], // empty = draw from every theme
  undercoverCount: 'auto',
  undercoverKnowsRole: true,
  writtenClues: true,
  turnTimer: 0,
  discussTime: 60,
  points: { ...DEFAULT_POINTS },
  roles: {
    mrwhite: true,
    espion: false,
    justicier: false,
    maire: false,
    bouffon: false,
    amoureux: false,
  },
}

/** Suggested impostor count, mirroring how the physical game scales. */
function autoUndercoverCount(playerCount) {
  if (playerCount <= 6) return 1
  if (playerCount <= 9) return 2
  if (playerCount <= 12) return 3
  return 4
}

/**
 * How many optional roles a table of this size can carry.
 *
 * Small tables drown under special powers: with four players, two specials
 * already means half the room has a gimmick. The budget grows slowly so a big
 * table gets variety without turning into a role zoo.
 */
export function specialBudget(playerCount) {
  if (playerCount < 4) return 0
  if (playerCount <= 5) return 2
  if (playerCount <= 7) return 3
  if (playerCount <= 9) return 4
  if (playerCount <= 12) return 5
  return 6
}

/** Every optional trait the host can toggle, roles and modifiers alike. */
export const OPTIONAL_TRAITS = [...OPTIONAL_ROLES, ...OPTIONAL_MODIFIERS]

function traitDef(id) {
  return ROLES[id] ?? MODIFIERS[id]
}

export class Game {
  constructor(code, { onUpdate, onEvent } = {}) {
    this.code = code
    this.players = new Map()
    this.spectators = new Map()
    this.phase = PHASES.LOBBY
    this.settings = structuredClone(DEFAULT_SETTINGS)
    this.round = 0
    this.gameNumber = 0
    this.words = null
    this.theme = null
    this.themeInfo = null
    this.turnOrder = []
    this.turnIndex = 0
    this.clues = new Map() // playerId -> { text, timedOut }
    this.usedClues = []
    this.chat = [] // written debate for the current round
    this.votes = new Map()
    this.lastResult = null
    this.outcome = null
    this.scoreboard = null
    this.history = []
    this.turnDeadline = null
    this.phaseDeadline = null
    this.pendingGuesser = null
    this.pendingTiebreak = null
    this.pendingRevenge = null
    this.interruptQueue = []
    this.skipRequests = new Set()
    this.awards = []
    this.eliminationCounter = 0
    // Which optional traits win the draw when the table cannot hold them all.
    // Shuffled rather than ordered, so no role is structurally favoured.
    this.traitOrder = shuffle(OPTIONAL_TRAITS)
    this.createdAt = Date.now()

    this.onUpdate = onUpdate ?? (() => {})
    this.onEvent = onEvent ?? (() => {})
    this._timer = null
    this._phaseTimer = null
    // Pending lobby evictions, keyed by player — cancelled the moment they come
    // back. See `releaseSocket`.
    this._removalTimers = new Map()
  }

  // ---------------------------------------------------------------- players

  addPlayer(name, { avatar = null, color = null } = {}) {
    const clean = String(name ?? '').trim().slice(0, 16)
    if (!clean) throw new GameError('Choisis un pseudo.')
    if (this.phase !== PHASES.LOBBY) throw new GameError('La partie a déjà commencé.')
    if (this.players.size >= MAX_PLAYERS) throw new GameError(`Table pleine (${MAX_PLAYERS} joueurs).`)

    const taken = [...this.players.values()].some(
      (p) => p.name.toLowerCase() === clean.toLowerCase(),
    )
    if (taken) throw new GameError('Ce pseudo est déjà pris.')

    const usedAvatars = new Set([...this.players.values()].map((p) => p.avatar))
    const player = {
      id: randomUUID(),
      name: clean,
      avatar: freeAvatar(usedAvatars, avatar),
      color: isValidColor(color) ? color : randomColor(),
      socketId: null,
      connected: true,
      alive: true,
      left: false,
      kicked: false,
      roleId: null,
      modifiers: [],
      word: null,
      wordDef: null,
      data: {},
      ready: false,
      score: 0,
      roundPoints: 0,
      wins: 0,
      isHost: this.players.size === 0,
    }

    this.players.set(player.id, player)
    this.onEvent({ type: 'playerJoined', name: player.name })
    this.touch()
    return player
  }

  /**
   * Someone watching without a seat.
   *
   * A latecomer, a friend passing by, a player who had to drop. They receive
   * exactly the public state — the same view as the shared screen — so there is
   * nothing to leak: no word, no role, no private payload. They cannot vote,
   * write, or act in any way.
   */
  addSpectator(name) {
    const clean = String(name ?? '').trim().slice(0, 16) || 'Spectateur'
    if (this.spectators.size >= MAX_SPECTATORS) {
      throw new GameError('Trop de spectateurs.')
    }
    const spectator = { id: randomUUID(), name: clean, socketId: null, connected: true }
    this.spectators.set(spectator.id, spectator)
    this.touch()
    return spectator
  }

  removeSpectator(id) {
    if (this.spectators.delete(id)) this.touch()
  }

  setAppearance(playerId, { avatar, color }) {
    if (this.phase !== PHASES.LOBBY) throw new GameError('Impossible en cours de partie.')
    const player = this.players.get(playerId)
    if (!player) throw new GameError('Joueur inconnu.')

    if (avatar !== undefined && avatar !== player.avatar) {
      if (!isValidAvatar(avatar)) throw new GameError('Avatar invalide.')
      const owner = [...this.players.values()].find((p) => p.avatar === avatar && p.id !== playerId)
      if (owner) throw new GameError(`${owner.name} a déjà cet avatar.`)
      player.avatar = avatar
    }

    if (color !== undefined && color !== player.color) {
      if (!isValidColor(color)) throw new GameError('Couleur invalide.')
      player.color = color
    }

    this.touch()
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId)
    if (!player) return
    this.cancelRemoval(playerId)
    if (this.phase === PHASES.LOBBY) {
      this.players.delete(playerId)
      if (player.isHost) {
        const next = this.players.values().next().value
        if (next) next.isHost = true
      }
    } else {
      player.connected = false
    }
    this.touch()
  }

  /**
   * Hands the remote control to a specific player.
   *
   * The crown is what lets a phone drive the game instead of everyone waiting
   * on whoever is sitting at the shared screen. It moves at any point in a
   * game: if the host's battery dies mid-round, someone else picks it up.
   */
  setHost(playerId) {
    const target = this.players.get(playerId)
    if (!target) throw new GameError('Joueur inconnu.')
    if (target.left) throw new GameError('Ce joueur a quitté la partie.')

    for (const p of this.players.values()) p.isHost = p.id === playerId
    this.onEvent({ type: 'hostChanged', name: target.name })
    this.touch()
    return target
  }

  /** Nobody wearing the crown means nobody can start the next round. */
  ensureHost() {
    const players = [...this.players.values()].filter((p) => !p.left)
    if (players.some((p) => p.isHost)) return
    // Prefer someone actually reachable right now.
    const next = players.find((p) => p.connected) ?? players[0]
    if (next) next.isHost = true
  }

  /**
   * A socket takes ownership of a seat (fresh join, or a rejoin after a
   * refresh). Any pending eviction for that seat is called off.
   */
  claimSocket(playerId, socketId) {
    const player = this.players.get(playerId)
    if (!player) return
    this.cancelRemoval(playerId)
    player.socketId = socketId
    player.connected = true
    this.touch()
  }

  /**
   * A socket dropped.
   *
   * Refreshing a page closes one socket and opens another, and the two events
   * can arrive in either order — so a disconnect only counts if the socket that
   * died is still the one holding the seat. Otherwise the player has already
   * come back and we would be marking a live player as gone.
   *
   * In the lobby the seat is kept for `RECONNECT_GRACE_MS` instead of being
   * deleted on the spot: a reload took the connection down, not the player.
   */
  releaseSocket(playerId, socketId) {
    const player = this.players.get(playerId)
    if (!player || player.left) return
    if (socketId && player.socketId && player.socketId !== socketId) return

    player.connected = false

    if (this.phase === PHASES.LOBBY) {
      this.cancelRemoval(playerId)
      const timer = setTimeout(() => {
        this._removalTimers.delete(playerId)
        const p = this.players.get(playerId)
        // Still gone after the grace period: they really left.
        if (p && !p.connected && this.phase === PHASES.LOBBY) this.removePlayer(playerId)
      }, RECONNECT_GRACE_MS)
      timer.unref?.()
      this._removalTimers.set(playerId, timer)
    }

    this.touch()
  }

  cancelRemoval(playerId) {
    const timer = this._removalTimers.get(playerId)
    if (timer) {
      clearTimeout(timer)
      this._removalTimers.delete(playerId)
    }
  }

  clearAllRemovals() {
    for (const timer of this._removalTimers.values()) clearTimeout(timer)
    this._removalTimers.clear()
  }

  /** Thrown out by the host. Same mechanics as quitting, different wording. */
  kick(playerId) {
    const player = this.players.get(playerId)
    if (!player) throw new GameError('Joueur inconnu.')
    player.kicked = true
    this.onEvent({ type: 'playerKicked', name: player.name })
    this.quit(playerId)
    return player
  }

  /**
   * Leaving for good, mid-game.
   *
   * The seat is emptied rather than paused: the round must be able to continue
   * without them. Role hooks are deliberately NOT fired — quitting is not an
   * in-fiction death, and a Bouffon who could win by rage-quitting would be
   * absurd.
   */
  quit(playerId) {
    const player = this.players.get(playerId)
    if (!player) return
    if (this.phase === PHASES.LOBBY || this.phase === PHASES.GAME_OVER) {
      return this.removePlayer(playerId)
    }

    const wasSpeaking = this.currentSpeakerId === playerId
    player.left = true
    player.connected = false
    player.alive = false
    this.votes.delete(playerId)
    if (!player.kicked) this.onEvent({ type: 'playerLeft', name: player.name })

    // Losing the host mid-game would leave nobody able to advance the round.
    if (player.isHost) {
      player.isHost = false
      this.ensureHost()
    }

    const win = this.evaluateWin()
    if (win) return this.finish(win)

    switch (this.phase) {
      case PHASES.REVEAL:
        if (this.everyoneRevealed()) return this.beginDescribe()
        break
      case PHASES.DESCRIBE:
        if (wasSpeaking) return this.advanceTurn()
        break
      case PHASES.VOTE: {
        const voters = this.activeVoters()
        if (voters.length > 0 && voters.every((p) => this.votes.has(p.id))) return this.tallyVotes()
        break
      }
      case PHASES.TIEBREAK:
        if (this.pendingTiebreak?.playerId === playerId) {
          // The arbiter walked out: fall back to nobody being eliminated.
          this.pendingTiebreak = null
          if (this.lastResult) this.lastResult.tie = true
          this.phase = PHASES.VOTE_RESULT
          this.touch()
          return
        }
        break
      case PHASES.MRWHITE_GUESS:
        if (this.pendingGuesser === playerId) {
          this.pendingGuesser = null
          if (this.lastResult) this.lastResult.guess = { text: '(abandon)', correct: false }
          return this.runNextInterrupt()
        }
        break
      case PHASES.REVENGE:
        if (this.pendingRevenge?.playerId === playerId) {
          this.pendingRevenge = null
          return this.runNextInterrupt()
        }
        break
      case PHASES.DISCUSS: {
        this.skipRequests.delete(playerId)
        const eligible = this.activeVoters()
        if (eligible.length > 0 && eligible.every((p) => this.skipRequests.has(p.id))) {
          return this.beginVote()
        }
        break
      }
      default:
        break
    }

    this.touch()
  }

  setConnected(playerId, connected) {
    const player = this.players.get(playerId)
    if (!player || player.left) return
    player.connected = connected
    if (connected) this.cancelRemoval(playerId)
    this.touch()
  }

  get alivePlayers() {
    return [...this.players.values()].filter((p) => p.alive)
  }

  /**
   * Who is allowed to cast a ballot.
   *
   * Normally the living, but a trait can grant voting from beyond the grave —
   * the Fantôme does exactly that, which is why this is a capability check and
   * not a plain `alive` test.
   */
  canVote(player) {
    if (!player || player.left) return false
    if (player.alive) return true
    return this.traitsOf(player).some((t) => t.votesWhenDead)
  }

  activeVoters() {
    return [...this.players.values()].filter((p) => this.canVote(p) && p.connected)
  }

  everyoneRevealed() {
    return [...this.players.values()].every((p) => p.ready || p.left || !p.connected)
  }

  // --------------------------------------------------------------- settings

  updateSettings(patch) {
    if (this.phase !== PHASES.LOBBY) throw new GameError('Réglages verrouillés en cours de partie.')
    const roles = { ...this.settings.roles, ...(patch.roles ?? {}) }
    const themeIds = Array.isArray(patch.themeIds)
      ? patch.themeIds.filter((id) => listThemes().some((t) => t.id === id))
      : this.settings.themeIds
    // Re-roll the pecking order whenever the host changes which roles are on,
    // so switching two roles on and off does not keep favouring the same one.
    if (patch.roles) this.traitOrder = shuffle(OPTIONAL_TRAITS)

    // Point overrides are clamped on the way in, so a hand-crafted socket
    // payload cannot install a 9999-point civilian victory.
    const points = patch.points
      ? sanitisePoints(patch.points, this.settings.points)
      : this.settings.points

    this.settings = { ...this.settings, ...patch, roles, themeIds, points }
    this.touch()
  }

  /** The scale in force for this game, defaults merged with the host's tweaks. */
  get points() {
    return resolvePoints(this.settings)
  }

  resetPoints() {
    this.settings = { ...this.settings, points: { ...DEFAULT_POINTS } }
    this.touch()
  }

  /**
   * Which optional traits actually make it into a table of this size.
   *
   * Two gates: each trait has its own minimum table, and the table has an
   * overall budget of special roles. When more are switched on than the table
   * can hold, the winners are drawn from a shuffled order (`traitOrder`) rather
   * than a fixed list — otherwise the role declared first would always win,
   * which is exactly the bug this replaces.
   *
   * The order is stable between draws, so the lobby preview matches the deal.
   */
  activeTraits(playerCount = this.players.size) {
    const budget = specialBudget(playerCount)
    const kept = []
    const dropped = []

    for (const id of this.traitOrder) {
      if (!this.settings.roles?.[id]) continue
      const def = traitDef(id)
      if (!def) continue
      if (playerCount < (def.minPlayers ?? 3)) {
        dropped.push({ id, reason: 'table' })
      } else if (kept.length >= budget) {
        dropped.push({ id, reason: 'budget' })
      } else {
        kept.push(id)
      }
    }

    return { kept, dropped, budget }
  }

  /**
   * Who gets which role for a table of this size.
   *
   * Hard constraints: at least two plain civilians must remain so the special
   * roles do not swallow the table, and there is always at least one undercover.
   * Modifiers cost no seat — they layer onto players who already have a role.
   */
  composition(playerCount = this.players.size) {
    const { kept } = this.activeTraits(playerCount)
    const roleIds = kept.filter((id) => ROLES[id])
    const modifierIds = kept.filter((id) => MODIFIERS[id])

    const mrwhite = roleIds.includes('mrwhite') ? 1 : 0

    const requested = this.settings.undercoverCount === 'auto'
      ? autoUndercoverCount(playerCount)
      : Number(this.settings.undercoverCount)

    // Impostors must never start able to out-vote everyone else. Mister White
    // takes one of those seats when he is in.
    const ceiling = Math.max(1, Math.floor((playerCount - 1 - mrwhite) / 2))
    const undercover = Math.max(1, Math.min(requested, ceiling))

    let remaining = playerCount - undercover - mrwhite

    const specials = {}
    for (const id of roleIds) {
      if (id === 'mrwhite') continue
      const slots = ROLES[id].slots ?? 1
      if (remaining - slots >= 2) {
        specials[id] = slots
        remaining -= slots
      }
    }

    return {
      roles: { civilian: remaining, undercover, ...(mrwhite ? { mrwhite } : {}), ...specials },
      modifiers: modifierIds.filter((id) => playerCount >= (MODIFIERS[id].slots ?? 1) + 1),
    }
  }

  /** What the lobby preview shows. */
  compositionReport(playerCount = this.players.size) {
    const { kept, dropped, budget } = this.activeTraits(playerCount)
    const { roles, modifiers } = this.composition(playerCount)

    // A trait can clear the budget yet still find no seat once the two
    // mandatory civilians are reserved. Report that too, or it vanishes from
    // the lobby without explanation.
    const detail = [...dropped]
    for (const id of kept) {
      const seated = ROLES[id] ? Boolean(roles[id]) : modifiers.includes(id)
      if (!seated) detail.push({ id, reason: 'seats' })
    }

    const enabled = OPTIONAL_TRAITS.filter((id) => this.settings.roles?.[id])
    return {
      comp: roles,
      modifiers,
      dropped: detail.map((d) => d.id),
      droppedDetail: detail,
      budget,
      enabledCount: enabled.length,
    }
  }

  // ------------------------------------------------------------------ start

  start() {
    if (this.players.size < MIN_PLAYERS) {
      throw new GameError(`Il faut au moins ${MIN_PLAYERS} joueurs.`)
    }

    const draw = drawPair({ themeIds: this.settings.themeIds })
    this.words = {
      civilianWord: draw.civilianWord,
      civilianDef: draw.civilianDef ?? null,
      undercoverWord: draw.undercoverWord,
      undercoverDef: draw.undercoverDef ?? null,
    }
    this.theme = draw.theme
    this.themeInfo = { recycled: draw.recycled, remaining: draw.remaining }

    for (const p of this.players.values()) {
      p.alive = true
      p.ready = false
      p.left = false
      p.kicked = false
      p.data = {}
      p.modifiers = []
      p.roundPoints = 0
    }

    this.assignRoles()

    this.round = 1
    this.gameNumber += 1
    this.outcome = null
    this.scoreboard = null
    this.lastResult = null
    this.history = []
    this.usedClues = []
    this.chat = []
    this.clues.clear()
    this.votes.clear()
    this.pendingGuesser = null
    this.pendingTiebreak = null
    this.pendingRevenge = null
    this.interruptQueue = []
    this.skipRequests.clear()
    this.awards = []
    this.eliminationCounter = 0
    // Lobby evictions are meaningless once the game is on: everyone keeps their
    // seat from here, connected or not.
    this.clearAllRemovals()
    this.phase = PHASES.REVEAL

    this.onEvent({ type: 'gameStarted', theme: this.theme })
    this.touch()
  }

  assignRoles() {
    const ids = shuffle([...this.players.keys()])
    const { roles, modifiers } = this.composition(ids.length)

    const assignment = []
    for (const [roleId, count] of Object.entries(roles)) {
      for (let i = 0; i < count; i++) assignment.push(roleId)
    }
    while (assignment.length < ids.length) assignment.push('civilian')
    assignment.length = ids.length

    ids.forEach((id, i) => {
      this.players.get(id).roleId = assignment[i]
    })

    for (const player of this.players.values()) {
      const role = getRole(player.roleId)
      player.word = role.getWord({ words: this.words, player, game: this })
      player.wordDef = role.getDef?.({ words: this.words, player, game: this }) ?? this.defFor(player.word)
    }

    // Modifiers are dealt on top, over a fresh shuffle, so a trait can land on
    // any hand — the Amoureux can pair an Infiltré with a Civil. A modifier may
    // refuse a hand through `canApply` (the Fantôme only haunts civilians); if
    // it cannot fill its slots, it simply does not enter play.
    const ctx = this.context()
    for (const modId of modifiers) {
      const mod = MODIFIERS[modId]
      const slots = mod.slots ?? 1
      const pool = shuffle(
        [...this.players.values()].filter(
          (p) => !p.modifiers.includes(modId) && (mod.canApply?.(p, ctx) ?? true),
        ),
      )
      if (pool.length < slots) continue
      for (const player of pool.slice(0, slots)) player.modifiers.push(modId)
    }

    for (const player of this.players.values()) {
      for (const trait of this.traitsOf(player)) trait.onAssign?.(player, ctx)
    }
  }

  /** Every distinct role and modifier currently in play, deduplicated. */
  presentTraits() {
    const present = new Map()
    for (const p of this.players.values()) {
      for (const trait of this.traitsOf(p)) present.set(trait.id, trait)
    }
    return [...present.values()]
  }

  /** A player's role plus every modifier layered on them. */
  traitsOf(player) {
    if (!player.roleId) return []
    return [getRole(player.roleId), ...player.modifiers.map((id) => getModifier(id))]
  }

  defFor(word) {
    if (!word) return null
    if (word === this.words.civilianWord) return this.words.civilianDef
    if (word === this.words.undercoverWord) return this.words.undercoverDef
    return null
  }

  // ----------------------------------------------------------------- reveal

  markReady(playerId) {
    // Identity first, phase second. An unknown actor is an error worth
    // reporting; a real player tapping a beat after the phase moved on is not.
    const player = this.players.get(playerId)
    if (!player) throw new GameError("Tu n'as pas de place dans cette partie.")
    if (this.phase !== PHASES.REVEAL) return
    player.ready = true

    if (this.everyoneRevealed()) this.beginDescribe()
    else this.touch()
  }

  // --------------------------------------------------------------- describe

  beginDescribe() {
    this.clues.clear()
    this.votes.clear()
    // The debate belongs to the round that produced it.
    this.chat = []
    this.turnIndex = 0

    let order = shuffle(this.alivePlayers.filter((p) => !p.left).map((p) => p.id))
    // Mister White speaking first is a death sentence — he'd have nothing to go
    // on. The physical game has the same unwritten rule.
    if (order.length > 1 && this.players.get(order[0]).roleId === 'mrwhite') {
      order.push(order.shift())
    }
    this.turnOrder = order

    this.phase = PHASES.DESCRIBE
    this.onEvent({ type: 'roundStarted', round: this.round })

    if (!this.settleTurn()) return
    this.startTurnTimer()
    this.touch()
  }

  settleTurn() {
    while (
      this.turnIndex < this.turnOrder.length &&
      !this.players.get(this.turnOrder[this.turnIndex])?.alive
    ) {
      this.turnIndex += 1
    }
    if (this.turnIndex >= this.turnOrder.length) {
      this.beginDiscuss()
      return false
    }
    return true
  }

  get currentSpeakerId() {
    if (this.phase !== PHASES.DESCRIBE) return null
    return this.turnOrder[this.turnIndex] ?? null
  }

  submitClue(playerId, text) {
    if (this.phase !== PHASES.DESCRIBE) return
    if (playerId !== this.currentSpeakerId) throw new GameError("Ce n'est pas ton tour.")
    const player = this.players.get(playerId)

    if (!this.settings.writtenClues) {
      this.clues.set(playerId, { text: '', timedOut: false })
      this.onEvent({ type: 'clueGiven', playerId })
      return this.advanceTurn()
    }

    const clue = String(text ?? '').trim().slice(0, 40)
    if (!normalise(clue)) throw new GameError('Écris un vrai indice.')

    // Only ever checked against the player's *own* word.
    //
    // Rejecting "that word is in play this round" leaked the game: the refusal
    // itself was the answer. Mister White typing a guess would learn he had it
    // right and win on the spot, and an Infiltré typing the majority word would
    // learn he was not with the majority. Knowing your own word costs nothing —
    // you are holding it.
    if (tooClose(clue, player.word)) {
      throw new GameError("Interdit : c'est ton propre mot.")
    }

    const dup = this.usedClues.find((c) => sameWord(c.text, clue))
    if (dup) throw new GameError(`« ${dup.text} » a déjà été donné par ${dup.by}.`)

    this.usedClues.push({ text: clue, by: player.name, round: this.round })
    this.clues.set(playerId, { text: clue, timedOut: false })
    this.onEvent({ type: 'clueGiven', playerId })
    this.advanceTurn()
  }

  advanceTurn() {
    this.clearTimer()
    this.turnIndex += 1
    if (!this.settleTurn()) return
    this.startTurnTimer()
    this.touch()
  }

  startTurnTimer() {
    this.clearTimer()
    if (!this.settings.turnTimer) {
      this.turnDeadline = null
      return
    }
    this.turnDeadline = Date.now() + this.settings.turnTimer * 1000
    this._timer = setTimeout(() => {
      // Out of time: record an explicit blank so the table can see who froze,
      // rather than silently skipping them.
      const id = this.currentSpeakerId
      if (id && !this.clues.has(id)) this.clues.set(id, { text: NO_CLUE, timedOut: true })
      this.onEvent({ type: 'timeout' })
      this.advanceTurn()
    }, this.settings.turnTimer * 1000)
  }

  clearTimer() {
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
    this.turnDeadline = null
  }

  // ---------------------------------------------------------------- discuss

  /**
   * Open floor between the clues and the vote.
   *
   * This is where the game actually happens around a table — accusations,
   * bluffs, alliances. The app just holds the clock and gets out of the way.
   */
  beginDiscuss() {
    this.clearTimer()
    this.clearPhaseTimer()
    this.skipRequests.clear()

    if (!this.settings.discussTime) return this.beginVote()

    this.phase = PHASES.DISCUSS
    this.phaseDeadline = Date.now() + this.settings.discussTime * 1000
    this.onEvent({ type: 'discussStarted' })
    this._phaseTimer = setTimeout(() => this.beginVote(), this.settings.discussTime * 1000)
    this.touch()
  }

  /**
   * A line in the written debate.
   *
   * Only offered when the table plays with written clues — otherwise everyone
   * is arguing out loud and a chat box just splits attention. Only the living
   * may speak: an eliminated player weighing in would keep steering a game they
   * are out of, and a Fantôme typing would give himself away instantly.
   */
  postChat(playerId, text) {
    if (this.phase !== PHASES.DISCUSS) throw new GameError("Le chat n'est ouvert que pendant la discussion.")
    if (!this.settings.writtenClues) throw new GameError('Chat désactivé pour cette partie.')

    const player = this.players.get(playerId)
    if (!player || player.left) throw new GameError('Joueur inconnu.')
    if (!player.alive) throw new GameError('Les éliminés ne participent pas au débat.')

    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN)
    if (!clean) throw new GameError('Message vide.')

    const now = Date.now()
    if (player.lastChatAt && now - player.lastChatAt < CHAT_COOLDOWN_MS) {
      throw new GameError('Doucement…')
    }
    if (this.chat.length >= CHAT_MAX_PER_ROUND) {
      throw new GameError('Le débat déborde. Passez au vote.')
    }

    player.lastChatAt = now
    this.chat.push({
      id: `${playerId}:${now}`,
      playerId,
      name: player.name,
      avatar: player.avatar,
      color: player.color,
      text: clean,
      at: now,
    })

    this.onEvent({ type: 'chat', playerId })
    this.touch()
  }

  /** Host cutting the debate short — one click, no consensus needed. */
  skipDiscussion() {
    if (this.phase !== PHASES.DISCUSS) return
    this.beginVote()
  }

  /**
   * A player asking to move on.
   *
   * One impatient person must not be able to cut everyone else off, so the vote
   * only opens once *every* eligible player has asked. Anyone can take their
   * request back, and the host can always override with `skipDiscussion`.
   */
  requestSkipDiscussion(playerId) {
    if (this.phase !== PHASES.DISCUSS) return
    const player = this.players.get(playerId)
    if (!player || player.left) return

    if (this.skipRequests.has(playerId)) this.skipRequests.delete(playerId)
    else this.skipRequests.add(playerId)

    const eligible = this.activeVoters()
    if (eligible.length > 0 && eligible.every((p) => this.skipRequests.has(p.id))) {
      return this.beginVote()
    }
    this.touch()
  }

  clearPhaseTimer() {
    if (this._phaseTimer) clearTimeout(this._phaseTimer)
    this._phaseTimer = null
    this.phaseDeadline = null
  }

  // ------------------------------------------------------------------- vote

  beginVote() {
    this.clearTimer()
    this.clearPhaseTimer()
    this.votes.clear()
    this.phase = PHASES.VOTE
    this.onEvent({ type: 'voteStarted' })
    this.touch()
  }

  submitVote(voterId, targetId) {
    const voter = this.players.get(voterId)
    if (!voter) throw new GameError("Tu n'as pas de place dans cette partie.")
    if (this.phase !== PHASES.VOTE) return
    const target = this.players.get(targetId)
    if (!this.canVote(voter)) throw new GameError('Les éliminés ne votent pas.')
    if (!target?.alive) throw new GameError('Cible invalide.')
    if (voterId === targetId) throw new GameError('Tu ne peux pas voter pour toi.')

    this.votes.set(voterId, targetId)
    this.onEvent({ type: 'voteCast' })

    const voters = this.activeVoters()
    if (voters.length > 0 && voters.every((p) => this.votes.has(p.id))) this.tallyVotes()
    else this.touch()
  }

  tallyVotes() {
    const tally = new Map()
    for (const [voterId, targetId] of this.votes) {
      const voter = this.players.get(voterId)
      if (!this.canVote(voter)) continue
      // Roles may weight a ballot — the Maire's counts double.
      let weight = 1
      for (const trait of this.traitsOf(voter)) {
        const res = trait.onVote?.(voter, this.players.get(targetId), this.context())
        if (res?.weight) weight = res.weight
      }
      tally.set(targetId, (tally.get(targetId) ?? 0) + weight)
    }

    const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1])
    const top = ranked[0]
    const tied = ranked.filter(([, n]) => n === top?.[1])

    this.lastResult = this.blankResult()
    this.lastResult.tally = Object.fromEntries(tally)
    this.lastResult.votes = Object.fromEntries(this.votes)

    if (!top) {
      this.lastResult.tie = true
      this.phase = PHASES.VOTE_RESULT
      this.onEvent({ type: 'voteTie' })
      this.touch()
      return
    }

    if (tied.length > 1) {
      const tiedIds = tied.map(([id]) => id)
      // Someone at the table may hold the power to break deadlocks.
      const arbiter = this.findTiebreaker()
      if (arbiter) {
        this.lastResult.tiedIds = tiedIds
        this.pendingTiebreak = {
          playerId: arbiter.player.id,
          tiedIds,
          ...arbiter.spec,
        }
        this.phase = PHASES.TIEBREAK
        this.onEvent({ type: 'tiebreakStarted' })
        this.touch()
        return
      }

      this.lastResult.tie = true
      this.lastResult.tiedIds = tiedIds
      this.phase = PHASES.VOTE_RESULT
      this.onEvent({ type: 'voteTie' })
      this.touch()
      return
    }

    const outcome = this.applyElimination(this.players.get(top[0]), 'vote', true)
    if (outcome) return
    this.resolveAfterElimination()
  }

  /** First living player whose role claims the tie-breaking power. */
  findTiebreaker() {
    for (const player of this.alivePlayers) {
      if (player.left) continue
      for (const trait of this.traitsOf(player)) {
        if (trait.tiebreak) return { player, spec: trait.tiebreak, trait }
      }
    }
    return null
  }

  resolveTiebreak(playerId, targetId) {
    if (this.phase !== PHASES.TIEBREAK) return
    if (this.pendingTiebreak?.playerId !== playerId) throw new GameError("Ce n'est pas à toi de trancher.")

    const { tiedIds, allowAbstain } = this.pendingTiebreak

    if (!targetId) {
      if (!allowAbstain) throw new GameError('Tu dois choisir quelqu\'un.')
      this.pendingTiebreak = null
      this.lastResult.tie = true
      this.lastResult.tiebreak = { by: playerId, abstained: true }
      this.onEvent({ type: 'voteTie' })
      this.phase = PHASES.VOTE_RESULT
      this.touch()
      return
    }

    if (!tiedIds.includes(targetId)) throw new GameError('Cette personne n\'est pas à égalité.')
    const target = this.players.get(targetId)
    if (!target?.alive) throw new GameError('Cible invalide.')

    this.pendingTiebreak = null
    this.lastResult.tiebreak = { by: playerId, abstained: false }
    this.lastResult.announce = `${this.players.get(playerId).name} a tranché l'égalité.`
    this.onEvent({ type: 'tiebreakResolved' })

    const stop = this.applyElimination(target, 'tiebreak', true)
    if (stop) return
    this.resolveAfterElimination()
  }

  blankResult() {
    return {
      round: this.round,
      tally: {},
      votes: {},
      clues: this.cluesPlain(),
      eliminated: null,
      alsoEliminated: [],
      notes: [],
      announce: null,
      guess: null,
      tie: false,
      tiedIds: [],
      tiebreak: null,
    }
  }

  cluesPlain() {
    return Object.fromEntries([...this.clues].map(([id, c]) => [id, c.text]))
  }

  // -------------------------------------------------------------- elimination

  applyElimination(player, cause, primary = true) {
    if (!player?.alive) return null
    player.alive = false

    // Stamped on every death so traits can score on *when* and *how* someone
    // died — the Bouffon's first-round window, the Duelliste's survival race,
    // the Mercenaire's contract all read these.
    player.data.eliminatedRound = this.round
    player.data.eliminatedCause = cause
    player.data.eliminatedOrder = ++this.eliminationCounter

    const role = getRole(player.roleId)
    const record = {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      color: player.color,
      roleId: player.roleId,
      roleLabel: role.label,
      roleEmoji: role.emoji,
      roleColor: role.color,
      // The elimination banner is public, so secret modifiers stay off it.
      modifiers: publicModifiers(player),
      word: player.word,
      // Lets the banner say "aucun mot" for Mister White without ever shipping
      // the word itself while the game is still running.
      hadWord: Boolean(player.word),
      cause,
    }
    if (primary) this.lastResult.eliminated = record
    else this.lastResult.alsoEliminated.push(record)

    this.onEvent({ type: 'eliminated', roleId: player.roleId, name: player.name, cause })

    // Both the role and every modifier get a say in what dying means.
    const interrupts = []
    for (const trait of this.traitsOf(player)) {
      const hook = trait.onEliminated?.(player, this.context(), cause)
      if (!hook) continue

      if (hook.note) this.lastResult.notes.push(hook.note)

      if (hook.win) {
        this.finish(hook.win)
        return 'win'
      }

      for (const id of hook.alsoEliminate ?? []) {
        const other = this.players.get(id)
        if (other?.alive) {
          const stop = this.applyElimination(other, 'grief', false)
          if (stop) return stop
        }
      }

      // A player can trigger several interrupts at once — Mister White *and*
      // the Vengeuse, if the same person holds both. They queue up and run one
      // after the other instead of one silently swallowing the other.
      if (hook.interrupt) interrupts.push({ ...hook.interrupt, playerId: player.id })
    }

    if (interrupts.length > 0) {
      this.interruptQueue.push(...interrupts)
      return this.runNextInterrupt()
    }

    return null
  }

  /**
   * Starts the next queued interrupt, or hands control back to the normal flow
   * when the queue is empty. Returns 'interrupt' while one is pending so
   * callers know not to keep going.
   */
  runNextInterrupt() {
    const next = this.interruptQueue.shift()
    if (!next) {
      this.resolveAfterElimination()
      return this.phase === PHASES.GAME_OVER ? 'win' : 'done'
    }

    if (next.kind === 'mrwhiteGuess') {
      this.phase = PHASES.MRWHITE_GUESS
      this.pendingGuesser = next.playerId
      this.touch()
      return 'interrupt'
    }

    if (next.kind === 'revenge') {
      // Anyone who died in the meantime is no longer a legal target.
      const targets = (next.targets ?? []).filter((id) => this.players.get(id)?.alive)
      if (targets.length === 0) return this.runNextInterrupt()

      this.phase = PHASES.REVENGE
      this.pendingRevenge = { ...next, targets }
      this.onEvent({ type: 'revengeStarted' })
      this.touch()
      return 'interrupt'
    }

    return this.runNextInterrupt()
  }

  submitRevenge(playerId, targetId) {
    if (this.phase !== PHASES.REVENGE) return
    if (this.pendingRevenge?.playerId !== playerId) {
      throw new GameError("Ce n'est pas à toi de te venger.")
    }

    const { targets, allowSkip } = this.pendingRevenge
    const avenger = this.players.get(playerId)

    if (!targetId) {
      if (!allowSkip) throw new GameError('Tu dois désigner quelqu\'un.')
      this.pendingRevenge = null
      this.lastResult.notes.push(`${avenger.name} part sans emmener personne.`)
      return this.runNextInterrupt()
    }

    if (!targets.includes(targetId)) throw new GameError('Cible invalide.')
    const target = this.players.get(targetId)
    if (!target?.alive) throw new GameError('Cible invalide.')

    this.pendingRevenge = null
    this.lastResult.notes.push(`${avenger.name} emmène ${target.name} dans sa chute.`)
    this.onEvent({ type: 'revengeResolved' })

    const stop = this.applyElimination(target, 'revenge', false)
    if (stop === 'win' || stop === 'interrupt') return
    return this.runNextInterrupt()
  }

  submitGuess(playerId, text) {
    if (this.phase !== PHASES.MRWHITE_GUESS || playerId !== this.pendingGuesser) return
    const guess = String(text ?? '').trim()
    const correct = sameWord(guess, this.words.civilianWord)

    this.lastResult.guess = { text: guess, correct }
    this.pendingGuesser = null

    if (correct) {
      this.onEvent({ type: 'whiteGuessRight' })
      this.finish({
        team: 'mrwhite',
        reason: `Mister White a deviné « ${this.words.civilianWord} ».`,
      })
      return
    }

    this.onEvent({ type: 'whiteGuessWrong' })
    // A Mister White who was also the Vengeuse still gets her revenge.
    this.runNextInterrupt()
  }

  /** Ask every role and modifier in play whether the game is decided. */
  evaluateWin() {
    const ctx = this.context()
    const present = new Map()
    for (const p of this.players.values()) {
      for (const trait of this.traitsOf(p)) present.set(trait.id, trait)
    }

    const ordered = [...present.values()].sort(
      (a, b) => (b.winPriority ?? 0) - (a.winPriority ?? 0),
    )

    for (const trait of ordered) {
      const win = trait.checkWin?.(ctx)
      if (win) return win
    }
    return null
  }

  resolveAfterElimination() {
    const win = this.evaluateWin()
    if (win) return this.finish(win)
    this.phase = PHASES.VOTE_RESULT
    this.touch()
  }

  finish(outcome) {
    this.clearTimer()
    this.clearPhaseTimer()
    this.outcome = outcome
    this.phase = PHASES.GAME_OVER
    this.pendingRevenge = null
    this.pendingGuesser = null
    this.interruptQueue = []

    // Side objectives are settled here rather than during play: the Duelliste's
    // survival race and the Mercenaire's contract can only be judged once the
    // dust has settled.
    const ctx = this.context()
    this.awards = this.presentTraits().flatMap((trait) => trait.onGameEnd?.(ctx) ?? [])

    const rows = scoreGame({
      players: [...this.players.values()],
      outcome,
      teamOf: (p) => getRole(p.roleId).team,
      lastResult: this.lastResult,
      awards: this.awards,
      points: this.points,
    })

    for (const row of rows) {
      const player = this.players.get(row.playerId)
      player.roundPoints = row.points
      player.score += row.points
      if (row.won) player.wins += 1
    }

    // Snapshot the standings so the end screen can animate from "before" to
    // "after" without recomputing anything client-side.
    this.scoreboard = rows
      .map((row) => {
        const p = this.players.get(row.playerId)
        return {
          ...row,
          name: p.name,
          avatar: p.avatar,
          color: p.color,
          before: p.score - row.points,
          after: p.score,
          wins: p.wins,
        }
      })
      .sort((a, b) => b.after - a.after || b.points - a.points || a.name.localeCompare(b.name, 'fr'))

    this.onEvent({ type: 'gameOver', team: outcome.team })
    this.touch()
  }

  continueRound() {
    if (this.phase !== PHASES.VOTE_RESULT) return
    this.history.push(this.lastResult)
    this.round += 1
    this.beginDescribe()
  }

  /** Back to the lobby, same players, fresh words. Scores carry over. */
  restart() {
    this.clearTimer()
    this.clearPhaseTimer()
    this.phase = PHASES.LOBBY
    this.round = 0
    this.words = null
    this.theme = null
    this.themeInfo = null
    this.outcome = null
    this.scoreboard = null
    this.lastResult = null
    this.history = []
    this.usedClues = []
    this.chat = []
    this.clues.clear()
    this.votes.clear()
    this.pendingGuesser = null
    this.pendingTiebreak = null
    this.pendingRevenge = null
    this.interruptQueue = []
    this.skipRequests.clear()
    this.awards = []
    this.eliminationCounter = 0
    // New game, new draw order — so a role that lost the coin toss last time
    // gets a fresh shot at this one.
    this.traitOrder = shuffle(OPTIONAL_TRAITS)

    for (const id of [...this.players.keys()]) {
      const p = this.players.get(id)
      if (p.left || p.kicked) {
        this.players.delete(id)
        continue
      }
      p.alive = true
      p.ready = false
      p.roleId = null
      p.modifiers = []
      p.word = null
      p.wordDef = null
      p.data = {}
      p.roundPoints = 0
    }
    if (![...this.players.values()].some((p) => p.isHost)) {
      const next = this.players.values().next().value
      if (next) next.isHost = true
    }
    this.touch()
  }

  /** Wipe the standings without touching who is in the room. */
  resetScores() {
    for (const p of this.players.values()) {
      p.score = 0
      p.wins = 0
      p.roundPoints = 0
    }
    this.gameNumber = 0
    this.touch()
  }

  // ------------------------------------------------------------------ views

  context() {
    const players = [...this.players.values()]
    const alive = players.filter((p) => p.alive)
    const teamOf = (p) => (p.roleId ? getRole(p.roleId).team : null)
    const hasModifier = (p, id) => Boolean(p.modifiers?.includes(id))
    return {
      players,
      alive,
      words: this.words,
      settings: this.settings,
      // Traits read their award from here rather than hardcoding a number, so
      // the host's tuning reaches every corner of the game.
      points: this.points,
      round: this.round,
      game: this,
      roleOf: (p) => getRole(p.roleId),
      teamOf,
      hasModifier,
      aliveOnTeam: (team) => alive.filter((p) => teamOf(p) === team).length,
    }
  }

  /**
   * How many of each camp are still standing.
   *
   * This leaks nothing: the table already knows the starting composition (the
   * lobby shows it) and every elimination reveals the victim's role, so anyone
   * with a pen could work these numbers out. Showing them just spares everyone
   * the bookkeeping — and keeps the tension honest, because "one Infiltré left"
   * is exactly the pressure the endgame needs.
   */
  liveTeams() {
    if (!this.words) return null
    const teams = {}
    for (const p of this.players.values()) {
      if (!p.roleId) continue
      const team = getRole(p.roleId).team
      teams[team] ??= { total: 0, alive: 0 }
      teams[team].total += 1
      if (p.alive) teams[team].alive += 1
    }
    return teams
  }

  /**
   * The round result, with the eliminated players' words stripped out.
   *
   * Announcing "his word was Autoroute" hands the Infiltré the civilians' word
   * for free — the single most valuable secret in the game. The role is still
   * revealed (that is the payoff of a vote); the word waits for the final
   * reveal, when it no longer costs anything.
   */
  publicResult() {
    if (!this.lastResult) return null
    if (this.phase === PHASES.GAME_OVER) return this.lastResult

    const redact = (rec) => (rec ? { ...rec, word: null } : rec)
    return {
      ...this.lastResult,
      eliminated: redact(this.lastResult.eliminated),
      alsoEliminated: (this.lastResult.alsoEliminated ?? []).map(redact),
      // Mister White's attempt is quoted verbatim, which is fine when he is
      // wrong — but a correct guess ends the game, so the full result is sent
      // anyway by then.
      guess: this.lastResult.guess,
    }
  }

  /**
   * What survives a server restart: who was in the room, their look, their
   * score, and how the host had set the game up.
   *
   * Not the round in progress — see `store.saveRoom`.
   */
  snapshot() {
    return {
      settings: this.settings,
      gameNumber: this.gameNumber,
      players: [...this.players.values()]
        .filter((p) => !p.left)
        .map((p) => ({
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          color: p.color,
          score: p.score,
          wins: p.wins,
          isHost: p.isHost,
        })),
    }
  }

  /**
   * Rebuilds a room from a snapshot, in the lobby, everyone disconnected.
   *
   * Seats are held open with no eviction timer: these players never had a
   * socket to lose, so they simply wait to be reclaimed by whoever still has
   * the session in their browser.
   */
  restoreFrom(snapshot) {
    if (!snapshot) return this
    this.settings = { ...structuredClone(DEFAULT_SETTINGS), ...(snapshot.settings ?? {}) }
    this.settings.points = sanitisePoints(this.settings.points)
    this.gameNumber = snapshot.gameNumber ?? 0

    for (const saved of snapshot.players ?? []) {
      if (!saved?.id || !saved?.name) continue
      this.players.set(saved.id, {
        id: saved.id,
        name: saved.name,
        avatar: saved.avatar ?? '🎭',
        color: isValidColor(saved.color) ? saved.color : randomColor(),
        socketId: null,
        connected: false,
        alive: true,
        left: false,
        kicked: false,
        roleId: null,
        modifiers: [],
        word: null,
        wordDef: null,
        data: {},
        ready: false,
        score: Number(saved.score) || 0,
        roundPoints: 0,
        wins: Number(saved.wins) || 0,
        isHost: Boolean(saved.isHost),
      })
    }
    this.ensureHost()
    return this
  }

  /**
   * The whole game, round by round, for the post-mortem.
   *
   * Only ever built once the game is over, so nothing here can leak: the words
   * and every role are public by then. `history` holds the finished rounds and
   * `lastResult` the one that ended it — that final round is never pushed into
   * history, since `continueRound` is what does the pushing.
   */
  recap() {
    if (this.phase !== PHASES.GAME_OVER) return null
    const rounds = [...this.history, this.lastResult].filter(Boolean)

    return rounds.map((r) => ({
      round: r.round,
      clues: r.clues ?? {},
      votes: r.votes ?? {},
      tally: r.tally ?? {},
      tie: Boolean(r.tie),
      eliminated: r.eliminated ?? null,
      alsoEliminated: r.alsoEliminated ?? [],
      guess: r.guess ?? null,
      announce: r.announce ?? null,
    }))
  }

  standings() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        score: p.score,
        wins: p.wins,
      }))
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'fr'))
  }

  publicState() {
    const revealAll = this.phase === PHASES.GAME_OVER
    return {
      code: this.code,
      phase: this.phase,
      round: this.round,
      gameNumber: this.gameNumber,
      settings: this.settings,
      theme: this.theme,
      composition: this.players.size ? this.compositionReport() : null,
      spectators: [...this.spectators.values()].map((s) => ({ id: s.id, name: s.name })),
      liveTeams: this.liveTeams(),
      currentSpeakerId: this.currentSpeakerId,
      turnDeadline: this.turnDeadline,
      phaseDeadline: this.phaseDeadline,
      outcome: this.outcome,
      scoreboard: this.scoreboard,
      standings: this.standings(),
      lastResult: this.publicResult(),
      pendingGuesser: this.pendingGuesser,
      // The arbiter's identity stays secret; only the fact that someone is
      // deciding, and who is on the chopping block, is public.
      tiebreak: this.pendingTiebreak
        ? { tiedIds: this.pendingTiebreak.tiedIds, label: this.pendingTiebreak.label }
        : null,
      // Same discretion as the tie-break: the table learns that a revenge is
      // happening, never who is choosing until the blow lands.
      revenge: this.pendingRevenge ? { label: this.pendingRevenge.label } : null,
      skipRequests: [...this.skipRequests],
      skipNeeded: this.phase === PHASES.DISCUSS ? this.activeVoters().length : 0,
      awards: this.phase === PHASES.GAME_OVER ? this.awards : [],
      recap: this.recap(),
      // Read-only once the vote opens: the argument is over, but everyone can
      // still re-read what was said before ticking a name.
      chat: this.settings.writtenClues ? this.chat : [],
      chatOpen: this.phase === PHASES.DISCUSS && this.settings.writtenClues,
      words: revealAll ? this.words : null,
      players: [...this.players.values()].map((p) => {
        const clue = this.clues.get(p.id)
        return {
          id: p.id,
          name: p.name,
          avatar: p.avatar,
          color: p.color,
          alive: p.alive,
          connected: p.connected,
          left: p.left,
          kicked: p.kicked,
          isHost: p.isHost,
          score: p.score,
          roundPoints: revealAll ? p.roundPoints : 0,
          wins: p.wins,
          ready: this.phase === PHASES.REVEAL ? p.ready : undefined,
          hasClue: this.clues.has(p.id),
          clue: clue ? clue.text : null,
          clueTimedOut: clue?.timedOut ?? false,
          hasVoted: this.votes.has(p.id),
          canVote: this.canVote(p),
          wantsSkip: this.skipRequests.has(p.id),
          role: revealAll || !p.alive ? publicRole(p) : null,
          modifiers:
            revealAll || !p.alive
              ? publicModifiers(p, { includeSecret: revealAll })
              : [],
          word: revealAll ? p.word : null,
        }
      }),
    }
  }

  privateState(playerId) {
    const player = this.players.get(playerId)
    if (!player) return null
    if (!player.roleId) {
      return {
        id: player.id,
        name: player.name,
        avatar: player.avatar,
        color: player.color,
        isHost: player.isHost,
        alive: player.alive,
        score: player.score,
      }
    }

    const role = getRole(player.roleId)
    const teammates = [...this.players.values()].filter(
      (p) => p.id !== player.id && p.roleId === player.roleId,
    )

    // The card quotes real numbers, so it has to see the scale in force.
    const points = this.points

    const brief = role.brief({
      player,
      settings: this.settings,
      points,
      teammates,
      words: this.words,
      game: this,
    })
    const { disguised, ...safeBrief } = brief

    // Modifiers append their own section to the card rather than replacing it.
    const extras = player.modifiers
      .map((id) =>
        getModifier(id).brief?.({ player, game: this, settings: this.settings, points }),
      )
      .filter(Boolean)

    const myTiebreak =
      this.phase === PHASES.TIEBREAK && this.pendingTiebreak?.playerId === player.id
        ? {
            label: this.pendingTiebreak.label,
            emoji: this.pendingTiebreak.emoji,
            prompt: this.pendingTiebreak.prompt,
            allowAbstain: this.pendingTiebreak.allowAbstain,
            abstainLabel: this.pendingTiebreak.abstainLabel,
            tiedIds: this.pendingTiebreak.tiedIds,
          }
        : null

    return {
      id: player.id,
      name: player.name,
      avatar: player.avatar,
      color: player.color,
      isHost: player.isHost,
      alive: player.alive,
      score: player.score,
      word: player.word,
      wordDef: player.wordDef,
      // `disguised` is an instruction to this method, never something the
      // client may see: only a hidden Infiltré carries it, so shipping the flag
      // would identify them in devtools just as surely as the role id would.
      brief: safeBrief,
      extras,
      // When the "knows their role" toggle is off we must not send the real
      // role id either — devtools would give it away instantly.
      role: disguised
        ? { id: 'civilian', label: 'Civil', emoji: '🧑', color: '#38bdf8' }
        : { id: role.id, label: role.label, emoji: role.emoji, color: role.color },
      tiebreak: myTiebreak,
      revenge:
        this.phase === PHASES.REVENGE && this.pendingRevenge?.playerId === player.id
          ? {
              label: this.pendingRevenge.label,
              emoji: this.pendingRevenge.emoji,
              prompt: this.pendingRevenge.prompt,
              allowSkip: this.pendingRevenge.allowSkip,
              skipLabel: this.pendingRevenge.skipLabel,
              targets: this.pendingRevenge.targets,
            }
          : null,
      canVote: this.canVote(player),
      wantsSkip: this.skipRequests.has(player.id),
      isSpeaking: this.currentSpeakerId === player.id,
      hasVoted: this.votes.has(player.id),
      vote: this.votes.get(player.id) ?? null,
    }
  }

  touch() {
    this.onUpdate(this)
  }

  dispose() {
    this.clearTimer()
    this.clearPhaseTimer()
    this.clearAllRemovals()
  }
}

function publicRole(p) {
  if (!p.roleId) return null
  const r = getRole(p.roleId)
  return { id: r.id, label: r.label, emoji: r.emoji, color: r.color }
}

/**
 * Modifiers safe to print next to a player's name.
 *
 * A modifier flagged `secret` grants an ongoing hidden advantage — the Maire's
 * doubled ballot, the Justicier's casting vote, the Fantôme's vote from beyond
 * the grave. Naming it, even on an elimination card, would hand the table the
 * one fact that neutralises it. Those only surface in the final post-mortem,
 * where `includeSecret` is turned on.
 */
function publicModifiers(p, { includeSecret = false } = {}) {
  return (p.modifiers ?? [])
    .map((id) => getModifier(id))
    .filter((m) => includeSecret || !m.secret)
    .map((m) => ({ id: m.id, label: m.label, emoji: m.emoji, color: m.color, secret: Boolean(m.secret) }))
}

export class GameError extends Error {}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export { AVATARS, COLORS }

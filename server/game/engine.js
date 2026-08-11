import { randomUUID } from 'node:crypto'
import { drawPair, listThemes } from '../words.js'
import { getRole, ROLES, OPTIONAL_ROLES } from './roles/index.js'
import { getModifier, MODIFIERS, OPTIONAL_MODIFIERS } from './modifiers/index.js'
import { normalise, sameWord, tooClose } from './text.js'
import { COLORS, AVATARS, freeAvatar, isValidAvatar, isValidColor, randomColor } from './appearance.js'
import { scoreGame, resolvePoints, sanitisePoints, DEFAULT_POINTS } from './scoring.js'
import { awardTitles } from './titles.js'
import { awardHonours } from './honours.js'
import { blankCareer, recordGame, QUEST_TRAITS, QUEST_AWARDS } from './career.js'

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

/**
 * The whole reaction vocabulary, deliberately tiny.
 *
 * Six covers the axes that matter at this table — is that clue suspicious,
 * convincing, funny, worth noting, catastrophic, brilliant. A longer palette
 * would have people picking an emoji instead of playing.
 */
export const REACTIONS = ['🤨', '👍', '😂', '👀', '💀', '⭐']

/** Sentinel target for "I refuse to accuse anyone". */
export const BLANK_VOTE = 'blank'
const CHAT_COOLDOWN_MS = 500

export const DEFAULT_SETTINGS = {
  themeIds: [], // empty = draw from every theme
  undercoverCount: 'auto',
  undercoverKnowsRole: true,
  writtenClues: true,
  turnTimer: 0,
  discussTime: 60,
  // Emoji stuck under a player's clue. Fills the one dead moment of the game —
  // the description round, where everyone waits their turn in silence.
  reactions: true,
  // Comic awards handed out on the final screen, from what actually happened.
  endTitles: true,
  // A civilian who has just been eliminated gets a private, timed shot at
  // naming every impostor still standing.
  dyingGuess: true,
  dyingGuessTime: 20,
  // Reward-and-punishment: a civilian's ballot is worth points, right or wrong.
  // Off by default — it changes how the game is played, not just how it scores.
  detectiveMode: false,
  // How far a bad night may drag you down. See `applyScore`.
  // Moot unless the mode above is on: nothing else in the game scores negative.
  scoreFloor: 'total',
  // Its own switch, because refusing to accuse is worth having on its own.
  blankVote: false,
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
    /**
     * Proof of ownership for the shared screen that opened this room.
     *
     * Held rather than derived, and never public: a four-letter code is easy to
     * guess, so "knows the code" cannot be what grants the right to kick people
     * or rewrite the settings.
     */
    this.screenToken = randomUUID()
    this.chat = [] // written debate for the current round
    // targetId -> Map(reactorId -> emoji). One reaction per player per clue,
    // wiped between rounds so last round's mood never colours this one.
    this.reactions = new Map()
    // Kept for the whole game, because the end-of-game titles read it.
    this.reactionTotals = new Map() // targetId -> { emoji: count }
    this.reactionsGiven = new Map() // reactorId -> how many they placed
    // Order in which cards were turned over this round; see `markReady`.
    this.readyCounter = 0
    // Chat is wiped every round; the titles need the whole evening's talk.
    this.chatTotals = new Map() // playerId -> lines posted this game
    this.titles = []
    // The evening as a whole, not the game: see `endSession`.
    this.sessionOver = false
    this.honours = []
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
    // The client turns this into "watch now, play next round" rather than a
    // dead end, so the tag has to survive rewording of the sentence.
    if (this.phase !== PHASES.LOBBY) throw new GameError('La partie a déjà commencé.', 'started')
    if (this.players.size >= MAX_PLAYERS) throw new GameError(`Table pleine (${MAX_PLAYERS} joueurs).`)

    if (this.nameTaken(clean)) throw new GameError('Ce pseudo est déjà pris.')

    const usedAvatars = this.usedAvatars()
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
   * Names and avatars are unique across seated players *and* spectators alike.
   *
   * A spectator is a player-in-waiting: whatever look they pick now is the one
   * they will sit down with next round, so it has to be held for them from the
   * moment they pick it.
   */
  everyone() {
    return [...this.players.values(), ...this.spectators.values()]
  }

  nameTaken(name, exceptId = null) {
    const wanted = name.toLowerCase()
    return this.everyone().some((p) => p.id !== exceptId && p.name.toLowerCase() === wanted)
  }

  usedAvatars(exceptId = null) {
    return new Set(this.everyone().filter((p) => p.id !== exceptId).map((p) => p.avatar))
  }

  /**
   * Someone watching without a seat.
   *
   * A latecomer, a friend passing by, a player who had to drop. They receive
   * exactly the public state — the same view as the shared screen — so there is
   * nothing to leak: no word, no role, no private payload. They cannot vote,
   * write, or act in any way.
   *
   * They do pick a pseudo and a look on the way in, because the next round
   * seats them automatically: waiting out a game should not mean filling in the
   * same form again the moment it ends.
   */
  addSpectator(name, { avatar = null, color = null } = {}) {
    const clean = String(name ?? '').trim().slice(0, 16) || 'Spectateur'
    if (this.spectators.size >= MAX_SPECTATORS) {
      throw new GameError('Trop de spectateurs.')
    }
    if (this.nameTaken(clean)) throw new GameError('Ce pseudo est déjà pris.')

    const spectator = {
      id: randomUUID(),
      name: clean,
      avatar: freeAvatar(this.usedAvatars(), avatar),
      color: isValidColor(color) ? color : randomColor(),
      socketId: null,
      connected: true,
    }
    this.spectators.set(spectator.id, spectator)
    this.touch()
    return spectator
  }

  removeSpectator(id) {
    if (this.spectators.delete(id)) this.touch()
  }

  /**
   * Turns everyone who watched this game into a player for the next one.
   *
   * Called from `restart`, so a latecomer's whole experience is: pick a look,
   * watch a round, and find themselves already seated when the table plays
   * again — no second form, no scramble to rejoin before the host hits start.
   * They come in on zero points, having sat the last one out.
   */
  seatSpectators() {
    const seated = []
    for (const s of [...this.spectators.values()]) {
      if (this.players.size >= MAX_PLAYERS) break
      this.spectators.delete(s.id)
      const player = this.addPlayer(s.name, { avatar: s.avatar, color: s.color })
      // Their socket is still connected and still in the room. Keeping it lets
      // the caller tell that phone to switch from the spectator view to its own
      // seat, instead of leaving them staring at a lobby they are already in.
      player.socketId = s.socketId
      seated.push(player)
    }
    return seated
  }

  setAppearance(playerId, { avatar, color }) {
    if (this.phase !== PHASES.LOBBY) throw new GameError('Impossible en cours de partie.')
    const player = this.players.get(playerId)
    if (!player) throw new GameError('Joueur inconnu.')

    if (avatar !== undefined && avatar !== player.avatar) {
      if (!isValidAvatar(avatar)) throw new GameError('Avatar invalide.')
      // Spectators count too — theirs is reserved for the seat they take next.
      const owner = this.everyone().find((p) => p.avatar === avatar && p.id !== playerId)
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

    // An unknown floor would silently fall back to clamping, which is the one
    // mode a table might have deliberately turned off.
    const scoreFloor = SCORE_FLOORS.some((f) => f.id === patch.scoreFloor)
      ? patch.scoreFloor
      : this.settings.scoreFloor

    this.settings = { ...this.settings, ...patch, roles, themeIds, points, scoreFloor }
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
      // Counted round by round, folded into the career at `finish`. Lives on
      // `data` so it clears with the game, like everything else per-game.
      p.data.tally = blankTally()
      p.modifiers = []
      p.roundPoints = 0
      p.career ??= blankCareer(this.gameNumber)
    }
    this.readyCounter = 0
    this.readySettled = false

    this.assignRoles()

    this.round = 1
    this.gameNumber += 1
    this.outcome = null
    this.scoreboard = null
    this.lastResult = null
    this.history = []
    this.usedClues = []
    this.chat = []
    this.reactions.clear()
    this.reactionTotals.clear()
    this.chatTotals.clear()
    this.titles = []
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
    if (player.ready) return

    player.ready = true
    // Every table has the friend everyone ends up waiting for. Recording the
    // order is the only way to name them at the end of the evening — and it
    // costs one integer.
    player.data.readyRank = ++this.readyCounter

    if (this.everyoneRevealed()) this.beginDescribe()
    else this.touch()
  }

  // --------------------------------------------------------------- describe

  beginDescribe() {
    this.clues.clear()
    this.votes.clear()
    // The debate — and the mood around it — belong to the round that produced
    // them. Carrying reactions over would let last round's suspicion sit under
    // a clue nobody has given yet.
    this.chat = []
    this.reactions.clear()
    this.turnIndex = 0

    let order = shuffle(this.alivePlayers.filter((p) => !p.left).map((p) => p.id))
    // Mister White speaking first is a death sentence — he'd have nothing to go
    // on. The physical game has the same unwritten rule.
    if (order.length > 1 && this.players.get(order[0]).roleId === 'mrwhite') {
      order.push(order.shift())
    }
    this.turnOrder = order

    // Opening the round is its own kind of exposure: nothing to lean on, and
    // everyone calibrates against you afterwards.
    const opener = this.players.get(order[0])
    if (opener?.data?.tally) opener.data.tally.spokeFirst += 1

    this.settleReadyOrder()

    this.phase = PHASES.DESCRIBE
    this.onEvent({ type: 'roundStarted', round: this.round })

    if (!this.settleTurn()) return
    this.startTurnTimer()
    this.touch()
  }

  /**
   * Records who turned their card over first and last.
   *
   * Only counted when the whole table actually tapped: if the round started
   * because someone had dropped out, being "last" says nothing about them.
   */
  settleReadyOrder() {
    // Once per game, not once per round: `beginDescribe` runs again every round
    // and the ranks stay on `data`, so without this the same player collected
    // the title as many times as the game had rounds.
    if (this.readySettled) return
    this.readySettled = true

    const ranked = [...this.players.values()]
      .filter((p) => !p.left && Number.isFinite(p.data?.readyRank))
      .sort((a, b) => a.data.readyRank - b.data.readyRank)

    const seated = [...this.players.values()].filter((p) => !p.left)
    if (ranked.length < 2 || ranked.length !== seated.length) return

    ranked[0].data.tally.readyFirst += 1
    ranked[ranked.length - 1].data.tally.readyLast += 1
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
    if (player.data?.tally) player.data.tally.cluesGiven += 1

    // Mister White naming the majority word out loud wins on the spot.
    //
    // He has no word of his own, so he is bluffing from whatever the table has
    // already said; landing on it exactly is the whole trick, and making him
    // wait to be voted out first would rob it of its moment. A wrong attempt
    // costs him nothing and reveals nothing — it goes through as an ordinary
    // clue, which is precisely why he can afford to try.
    if (this.whiteNailedIt(player, clue)) return

    this.onEvent({ type: 'clueGiven', playerId })
    this.advanceTurn()
  }

  /**
   * Ends the game if this clue was Mister White naming the civilians' word.
   *
   * Deliberately `sameWord` and not `tooClose`: the fuzzy match is right for
   * *forbidding* a clue, where a false positive costs one retry, but an instant
   * victory has to be earned by actually saying the word.
   */
  whiteNailedIt(player, clue) {
    if (player.roleId !== 'mrwhite') return false
    if (!sameWord(clue, this.words?.civilianWord)) return false

    this.lastResult = this.blankResult()
    this.lastResult.guess = { text: clue, correct: true, by: player.id, fromClue: true }
    this.lastResult.notes.push(`${player.name} a lâché le mot en pleine description.`)

    this.onEvent({ type: 'whiteGuessRight' })
    this.finish({
      team: 'mrwhite',
      reason: `Mister White a nommé « ${this.words.civilianWord} » dans sa description.`,
    })
    return true
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
      if (id && !this.clues.has(id)) {
        this.clues.set(id, { text: NO_CLUE, timedOut: true })
        const tally = this.players.get(id)?.data?.tally
        if (tally) tally.cluesTimedOut += 1
      }
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
    // The debate does not stop when the ballot opens. Votes can be changed
    // until the last one is in, so the seconds before the count are exactly
    // when a last-minute argument is worth the most.
    if (![PHASES.DISCUSS, PHASES.VOTE].includes(this.phase)) {
      throw new GameError("Le chat n'est ouvert que pendant la discussion et le vote.")
    }
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
    this.chatTotals.set(playerId, (this.chatTotals.get(playerId) ?? 0) + 1)
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

  /**
   * Stick an emoji under someone's clue.
   *
   * Attributed on purpose, never anonymous: a reaction nobody can be held to
   * costs nothing and means nothing. Signed, it is a social move the table can
   * ask you about — which is exactly the material accusations are made of.
   *
   * Only the living may react, for the same reason they may not chat: an
   * eliminated player knows things, and a well-placed 🤨 would let them keep
   * steering a game they are out of.
   */
  react(playerId, targetId, emoji) {
    if (!this.settings.reactions) throw new GameError('Réactions désactivées pour cette partie.')
    if (![PHASES.DESCRIBE, PHASES.DISCUSS, PHASES.VOTE].includes(this.phase)) {
      throw new GameError('Trop tard pour réagir.')
    }
    if (!REACTIONS.includes(emoji)) throw new GameError('Réaction inconnue.')

    const player = this.players.get(playerId)
    if (!player || player.left) throw new GameError('Joueur inconnu.')
    if (!player.alive) throw new GameError('Les éliminés ne réagissent plus.')
    if (playerId === targetId) throw new GameError('On ne réagit pas à son propre indice.')

    const target = this.players.get(targetId)
    if (!target) throw new GameError('Joueur inconnu.')
    if (!this.clues.has(targetId)) throw new GameError("Ce joueur n'a pas encore parlé.")

    const onTarget = this.reactions.get(targetId) ?? new Map()
    // Tapping the same emoji twice takes it back; a different one replaces it.
    // One voice per player per clue keeps the count meaningful.
    const previous = onTarget.get(playerId)
    if (previous === emoji) onTarget.delete(playerId)
    else {
      onTarget.set(playerId, emoji)
      this.countReaction(targetId, emoji)
      // Counted separately from what a player *receives*: one measures how the
      // table reads you, the other whether you take part at all.
      this.reactionsGiven.set(playerId, (this.reactionsGiven.get(playerId) ?? 0) + 1)
    }
    this.reactions.set(targetId, onTarget)

    this.onEvent({ type: 'reaction', emoji, playerId, targetId })
    this.touch()
  }

  /** Running total for the whole game — only the titles ever read this. */
  countReaction(targetId, emoji) {
    const tally = this.reactionTotals.get(targetId) ?? {}
    tally[emoji] = (tally[emoji] ?? 0) + 1
    this.reactionTotals.set(targetId, tally)
  }

  /**
   * Every clue given so far, round by round.
   *
   * Safe to hand to everyone: a clue was said out loud in front of the table
   * the moment it was given, so nothing here is secret. What it replaces is
   * players' memory — by round three nobody recalls what the quiet one said in
   * round one, which is exactly the evidence the game runs on.
   *
   * Deliberately clues only. The secret words never enter this log, and the
   * eliminated keep theirs hidden until the final reveal.
   */
  clueLog() {
    const byRound = new Map()
    for (const past of this.history) {
      if (past?.clues) byRound.set(past.round, { clues: past.clues, out: outOf(past) })
    }
    if (this.lastResult?.clues) {
      byRound.set(this.lastResult.round, {
        clues: this.lastResult.clues,
        out: outOf(this.lastResult),
      })
    }
    // The round in progress lives in neither, and is the one being argued over.
    if (this.clues.size > 0) {
      byRound.set(this.round, { clues: this.cluesPlain(), out: byRound.get(this.round)?.out ?? [] })
    }

    return [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, entry]) => ({ round, ...entry }))
  }

  /** Flattened for the wire: `{ targetId: [{ by, emoji }] }`. */
  reactionsPlain() {
    const out = {}
    for (const [targetId, byPlayer] of this.reactions) {
      if (byPlayer.size === 0) continue
      out[targetId] = [...byPlayer].map(([by, emoji]) => ({ by, emoji }))
    }
    return out
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
    if (!this.canVote(voter)) throw new GameError('Les éliminés ne votent pas.')

    // Refusing to accuse is a real answer, and worth having: without it, a table
    // that scores its ballots pushes people to name someone at random rather
    // than admit they have nothing.
    if (targetId === BLANK_VOTE) {
      if (!this.settings.blankVote) throw new GameError('Le vote blanc est désactivé.')
      this.votes.set(voterId, BLANK_VOTE)
    } else {
      const target = this.players.get(targetId)
      if (!target?.alive) throw new GameError('Cible invalide.')
      if (voterId === targetId) throw new GameError('Tu ne peux pas voter pour toi.')
      this.votes.set(voterId, targetId)
    }
    this.onEvent({ type: 'voteCast' })

    const voters = this.activeVoters()
    if (voters.length > 0 && voters.every((p) => this.votes.has(p.id))) this.tallyVotes()
    else this.touch()
  }

  tallyVotes() {
    this.scoreBallots()
    this.recordBallots()

    const tally = new Map()
    for (const [voterId, targetId] of this.votes) {
      const voter = this.players.get(voterId)
      if (!this.canVote(voter)) continue
      // A blank ballot is counted as cast, but names nobody.
      if (targetId === BLANK_VOTE) continue
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
    this.openDyingGuess(player)

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

    this.lastResult.guess = { text: guess, correct, by: playerId }
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

  // --------------------------------------------------- reward & punishment

  /**
   * Scores this round's ballots, one per civilian.
   *
   * The complaint this answers: being voted for nothing, round after round, by
   * people following whoever spoke loudest. Putting a price on a ballot makes
   * accusing someone cost something, so the followers slow down and the ones
   * who actually read the table get paid for it.
   *
   * Only civilians are scored. An impostor's ballot is a bluff — voting "wrong"
   * is his whole job, and paying him for it would be rewarding him twice.
   * A blank counts for nothing either way, which is the point of having it.
   */
  scoreBallots() {
    if (!this.settings.detectiveMode) return
    const value = this.points.detective
    if (value <= 0) return

    for (const [voterId, targetId] of this.votes) {
      const voter = this.players.get(voterId)
      if (!voter || !this.canVote(voter)) continue
      if (this.teamOfPlayer(voter) !== 'civilian') continue
      if (targetId === BLANK_VOTE) continue

      const target = this.players.get(targetId)
      if (!target) continue

      const right = this.teamOfPlayer(target) !== 'civilian'
      const tally = (voter.data.detective ??= { right: 0, wrong: 0 })
      if (right) tally.right += 1
      else tally.wrong += 1
    }
  }

  /**
   * Notes down who voted for whom, for the end-of-evening awards.
   *
   * Separate from `scoreBallots`, which only exists under reward-and-punishment
   * and only looks at civilians. This runs every round whatever the settings —
   * the awards describe the evening, not one scoring mode.
   *
   * Called before the count, while `this.votes` still holds every ballot.
   */
  recordBallots() {
    const counts = new Map()
    for (const [voterId, targetId] of this.votes) {
      if (targetId !== BLANK_VOTE) counts.set(targetId, (counts.get(targetId) ?? 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

    for (const [voterId, targetId] of this.votes) {
      const voter = this.players.get(voterId)
      const tally = voter?.data?.tally
      if (!tally) continue

      tally.votesCast += 1
      if (targetId === BLANK_VOTE) { tally.votesBlank += 1; continue }
      if (targetId === top) tally.votedWithPack += 1
      if (this.teamOfPlayer(this.players.get(targetId)) !== 'civilian') tally.votesRight += 1
    }

    for (const [targetId, n] of counts) {
      const target = this.players.get(targetId)
      const tally = target?.data?.tally
      if (!tally) continue
      tally.votesReceived += n
      // Being suspected while innocent is the table's mistake, not the
      // player's — worth counting apart from plain unpopularity.
      if (this.teamOfPlayer(target) === 'civilian') tally.votesReceivedInnocent += n
      if (this.round === 1) tally.accusedFirstRound += n
    }
  }

  /** Settled at the end, so the running total never distracts mid-game. */
  detectiveAwards() {
    if (!this.settings.detectiveMode) return []
    const value = this.points.detective
    if (value <= 0) return []

    const out = []
    for (const player of this.players.values()) {
      const tally = player.data?.detective
      if (!tally) continue

      if (tally.right > 0) {
        out.push({
          playerId: player.id,
          key: 'detectiveRight',
          label: `Votes justes (${tally.right})`,
          points: tally.right * value,
        })
      }
      if (tally.wrong > 0) {
        out.push({
          playerId: player.id,
          key: 'detectiveWrong',
          label: `Votes à côté (${tally.wrong})`,
          points: -tally.wrong * value,
        })
      }
    }
    return out
  }

  // ----------------------------------------------------------- dying guess

  /**
   * A civilian who has just been eliminated gets one private shot at naming
   * every impostor still standing.
   *
   * Two rules make it work, and both are load-bearing.
   *
   * It is **secret** until the final debrief. Shown live, a dead player becomes
   * an oracle: he has nothing left to lose and would simply tell the living who
   * to vote for, turning every elimination into a swing.
   *
   * It **does not block the table**. Only his own phone runs the countdown; the
   * round carries on without him. A blocking prompt would add twenty seconds of
   * everyone staring at a screen after every single death.
   */
  openDyingGuess(player) {
    if (!this.settings.dyingGuess) return
    if (getRole(player.roleId).team !== 'civilian') return

    const targets = this.alivePlayers.filter((p) => this.teamOfPlayer(p) !== 'civilian')
    // Nothing left to name — the game is already decided.
    if (targets.length === 0) return

    player.data.dyingGuess = {
      round: this.round,
      deadline: Date.now() + this.settings.dyingGuessTime * 1000,
      // Frozen now: who was an impostor *at the moment he died* is the question,
      // and later eliminations must not change the answer under him. The list
      // he picks from is frozen for the same reason — the round carries on
      // while he thinks, and the board must not shift under his thumb.
      expected: targets.map((p) => p.id).sort(),
      candidates: this.alivePlayers.map((p) => p.id),
      answer: null,
      correct: false,
    }
  }

  submitDyingGuess(playerId, targetIds) {
    const player = this.players.get(playerId)
    if (!player) throw new GameError("Tu n'as pas de place dans cette partie.")

    const pending = player.data?.dyingGuess
    if (!pending || pending.answer) throw new GameError("Ce n'est pas le moment.")
    if (Date.now() > pending.deadline) throw new GameError('Trop tard.')

    const answer = [...new Set(targetIds ?? [])].filter((id) => this.players.has(id)).sort()
    pending.answer = answer
    pending.correct =
      answer.length === pending.expected.length &&
      answer.every((id, i) => id === pending.expected[i])

    // No `touch()`: broadcasting here would redraw every screen the instant he
    // answers, and an attentive table would read the timing. Only his own phone
    // needs to know, and it already does — it just sent the answer.
    return pending.correct
  }

  teamOfPlayer(p) {
    return p.roleId ? getRole(p.roleId).team : null
  }

  /**
   * Consolation points, settled once the game is over.
   *
   * It only ever pays out when the civilians *lost*: this rewards having read
   * the table right in a game you could no longer win, not piling a bonus onto
   * a victory you were already going to share.
   */
  dyingGuessAwards(outcome) {
    if (!this.settings.dyingGuess) return []
    const points = this.points.dyingGuess
    if (points <= 0) return []

    const winTeams = outcome?.teams ?? (outcome?.team ? [outcome.team] : [])
    if (winTeams.includes('civilian')) return []

    const out = []
    for (const player of this.players.values()) {
      if (player.data?.dyingGuess?.correct) {
        out.push({ playerId: player.id, key: 'dyingGuess', label: 'Dernier soupçon', points })
      }
    }
    return out
  }

  /** Everyone's guess, laid bare — only ever called once the game is over. */
  dyingGuessesPlain() {
    const out = []
    for (const player of this.players.values()) {
      const g = player.data?.dyingGuess
      if (!g?.answer) continue
      out.push({
        playerId: player.id,
        name: player.name,
        avatar: player.avatar,
        round: g.round,
        answer: g.answer,
        expected: g.expected,
        correct: g.correct,
      })
    }
    return out
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
    this.awards = [
      ...this.presentTraits().flatMap((trait) => trait.onGameEnd?.(ctx) ?? []),
      ...this.dyingGuessAwards(outcome),
      ...this.detectiveAwards(),
    ]

    // Pure commentary — they carry no points and change nothing. Computed here
    // only because this is the one moment where every round is in and the roles
    // can finally be read out loud.
    this.titles = this.settings.endTitles
      ? awardTitles({
          players: [...this.players.values()],
          rounds: [...this.history, this.lastResult].filter(Boolean),
          teamOfId: (id) => {
            const p = this.players.get(id)
            return p?.roleId ? getRole(p.roleId).team : null
          },
          reactionTotals: this.reactionTotals,
          chatTotals: this.chatTotals,
          blankClue: NO_CLUE,
        })
      : []

    const rows = scoreGame({
      players: [...this.players.values()],
      outcome,
      teamOf: (p) => getRole(p.roleId).team,
      lastResult: this.lastResult,
      awards: this.awards,
      points: this.points,
    })

    // Folded in before anything is cleared: `restart` wipes every scratch field
    // a few moments later, and the end-of-evening awards live off exactly this.
    this.recordCareers(rows)

    for (const row of rows) {
      const player = this.players.get(row.playerId)
      const before = player.score
      const after = applyScore(before, row.points, this.settings.scoreFloor)

      player.score = after
      // What was actually applied, so the scoreboard's arithmetic adds up even
      // when the floor swallowed part of a penalty.
      row.points = after - before
      player.roundPoints = row.points
      if (row.won) player.wins += 1
    }

    // Standing after this game, kept so a comeback can be recognised as one —
    // the final table alone never says where somebody came from.
    const order = [...this.players.values()].sort((a, b) => b.score - a.score)
    order.forEach((p, i) => p.career?.ranks.push(i))

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

  /**
   * Folds this game's facts into every player's evening record.
   *
   * The one place that knows all of it at once: the round counters on `data`,
   * the reactions still in memory, the awards just computed, and who was on
   * which side — which stops being knowable the moment roles are cleared.
   */
  recordCareers(rows) {
    const lastRound = this.round
    const questTraits = new Set(QUEST_TRAITS)
    const questAwards = new Set(QUEST_AWARDS)

    for (const player of this.players.values()) {
      const tally = player.data?.tally
      if (!tally) continue

      player.career ??= blankCareer(this.gameNumber)
      const row = rows.find((r) => r.playerId === player.id)
      const guess = player.data?.dyingGuess
      const mine = this.awards.filter((a) => a.playerId === player.id)

      // Side objectives: how many were dealt, and how many actually landed.
      const quests = [player.roleId, ...(player.modifiers ?? [])].filter((id) => questTraits.has(id))
      const done = mine.filter((a) => questAwards.has(a.key)).length

      recordGame(player.career, {
        points: row?.points ?? 0,
        roleId: player.roleId,
        modifiers: player.modifiers,
        alive: player.alive,
        firstOut: player.data?.eliminatedOrder === 1,
        // Someone still standing lived the whole game.
        lifespan: player.alive ? lastRound : (player.data?.eliminatedRound ?? lastRound),
        ...tally,
        whiteGuesses: this.lastResult?.guess?.by === player.id ? 1 : 0,
        whiteGuessRight: this.lastResult?.guess?.by === player.id && this.lastResult.guess.correct ? 1 : 0,
        dyingAsked: guess ? 1 : 0,
        dyingRight: guess?.correct ? 1 : 0,
        quests: quests.length,
        questsDone: Math.min(done, quests.length),
        cluesGiven: tally.cluesGiven,
        chatLines: this.chatTotals.get(player.id) ?? 0,
        reactionsGot: this.reactionTotals.get(player.id) ?? {},
        reactionsGiven: this.reactionsGiven.get(player.id) ?? 0,
      })
    }
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
    this.reactions.clear()
    this.reactionTotals.clear()
    this.chatTotals.clear()
    this.titles = []
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

    // Anyone who watched this game sits down for the next one. Done after the
    // clean-up loop so the seats freed by players who left are available to
    // them, and before the crown check so a table of nothing but spectators
    // still ends up with a host.
    const seated = this.seatSpectators()
    if (seated.length) {
      this.onEvent({ type: 'spectatorsSeated', names: seated.map((p) => p.name) })
    }

    if (![...this.players.values()].some((p) => p.isHost)) {
      const next = this.players.values().next().value
      if (next) next.isHost = true
    }
    this.touch()
    return seated
  }

  /** Wipe the standings without touching who is in the room. */
  resetScores() {
    for (const p of this.players.values()) {
      p.score = 0
      p.wins = 0
      p.roundPoints = 0
      // The record has to go with the scores: awards drawn from one evening's
      // play would otherwise describe games nobody remembers scoring.
      p.career = blankCareer(0)
    }
    this.gameNumber = 0
    this.sessionOver = false
    this.honours = []
    this.touch()
  }

  // --------------------------------------------------------- fin de soirée

  /**
   * Closes the evening and hands out its awards.
   *
   * Deliberately a flag rather than a phase: phases describe a game, and this
   * is about the room. The players, their seats and the code all survive — only
   * the screen changes, and `newEvening` puts everything back.
   *
   * Allowed from the lobby or once a game is over, never mid-round: ending an
   * evening in the middle of an accusation would compute awards from a game
   * that never finished scoring.
   */
  endSession() {
    if (![PHASES.LOBBY, PHASES.GAME_OVER].includes(this.phase)) {
      throw new GameError("Termine ou abandonne la partie en cours avant de clore la soirée.")
    }
    if (this.gameNumber === 0) throw new GameError("Aucune partie jouée pour l'instant.")

    this.sessionOver = true
    this.honours = awardHonours({
      players: [...this.players.values()],
      totalGames: this.gameNumber,
      reactionsOn: Boolean(this.settings.reactions),
    })
    this.onEvent({ type: 'sessionOver' })
    this.touch()
  }

  /** Same room, same people, everything back to zero. */
  newEvening() {
    this.sessionOver = false
    this.honours = []
    this.resetScores()
    this.restart()
  }

  /** The evening's final table, kept in one place for the closing screen. */
  finalStandings() {
    return [...this.players.values()]
      .map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        score: p.score,
        wins: p.wins,
        games: p.career?.games ?? 0,
        // Someone who walked off still played, and may well have earned a
        // title — dropping them would also reward quitting while last.
        left: Boolean(p.left),
      }))
      .sort((a, b) => b.score - a.score || b.wins - a.wins || a.name.localeCompare(b.name, 'fr'))
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
      // Kept so a server restart does not lock the shared screen out of a room
      // it legitimately owns.
      screenToken: this.screenToken,
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
          // The evening's record travels with the scores: losing it to a server
          // restart would empty the final awards of everything but the ranking.
          career: p.career ?? null,
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
    if (snapshot.screenToken) this.screenToken = snapshot.screenToken
    // Rooms saved before the floor became a three-way choice carry the old
    // boolean. Honour what it meant rather than silently resetting it.
    if (snapshot.settings && 'allowNegative' in snapshot.settings) {
      this.settings.scoreFloor = snapshot.settings.allowNegative ? 'none' : 'total'
      delete this.settings.allowNegative
    }
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
        // Merged onto a blank rather than trusted wholesale: a room saved
        // before a counter existed would otherwise carry a hole into the
        // awards, which read every field without checking.
        career: { ...blankCareer(saved.career?.joinedAtGame ?? 0), ...(saved.career ?? {}) },
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
      // Their look travels with them so the host screen can show who is waiting
      // to sit down, exactly as they will appear once seated.
      spectators: [...this.spectators.values()].map((s) => ({
        id: s.id,
        name: s.name,
        avatar: s.avatar,
        color: s.color,
      })),
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
      // Both are debrief material: revealing either mid-game would tell the
      // living what a dead player worked out.
      dyingGuesses: this.phase === PHASES.GAME_OVER ? this.dyingGuessesPlain() : [],
      titles: this.phase === PHASES.GAME_OVER ? this.titles : [],
      // The closing screen: a flag rather than a phase, since the room and
      // everyone in it carry on existing behind it.
      sessionOver: this.sessionOver,
      honours: this.sessionOver ? this.honours : [],
      finalStandings: this.sessionOver ? this.finalStandings() : [],
      recap: this.recap(),
      // Public all game long: every clue in it was given in the open.
      clueLog: this.settings.writtenClues ? this.clueLog() : [],
      chat: this.settings.writtenClues ? this.chat : [],
      chatOpen:
        [PHASES.DISCUSS, PHASES.VOTE].includes(this.phase) && this.settings.writtenClues,
      // Public by design: a reaction is a signed, visible act, and the count
      // under a clue is the table's temperature at a glance.
      reactions: this.settings.reactions ? this.reactionsPlain() : {},
      reactionPalette: this.settings.reactions ? REACTIONS : [],
      reactionsOpen:
        this.settings.reactions &&
        [PHASES.DESCRIBE, PHASES.DISCUSS, PHASES.VOTE].includes(this.phase),
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

    // His own countdown, on his own phone. Nothing about it appears in the
    // public state, so the table never learns that anyone is answering.
    const pendingGuess = player.data?.dyingGuess
    const myDyingGuess =
      pendingGuess && !pendingGuess.answer && Date.now() < pendingGuess.deadline
        ? {
            deadline: pendingGuess.deadline,
            total: this.settings.dyingGuessTime,
            count: pendingGuess.expected.length,
            points: this.points.dyingGuess,
            candidates: pendingGuess.candidates,
          }
        : null

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
      dyingGuess: myDyingGuess,
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
/** The three ways a table can decide how far a bad night drags you down. */
export const SCORE_FLOORS = [
  {
    id: 'round',
    label: 'Par manche',
    hint: "Une manche ne peut jamais coûter de points : au pire elle en rapporte zéro. Le mode punit les tièdes sans jamais reprendre ce qui est acquis.",
  },
  {
    id: 'total',
    label: 'Cumulé',
    hint: "Une mauvaise manche reprend des points déjà gagnés, mais le total ne descend jamais sous zéro.",
  },
  {
    id: 'none',
    label: 'Aucune',
    hint: 'Aucune limite : on peut finir la soirée dans le négatif.',
  },
]

/**
 * Applies a round's points to a running score under the chosen floor.
 *
 * The three modes differ only in *where* the clamp sits, and that changes who
 * the punishment actually bites. `round` protects everything already banked, so
 * it never takes from the leaders. `total` lets a bad night cost real ground
 * while stopping at nothing. `none` lets the arithmetic run.
 */
export function applyScore(before, points, floor) {
  if (floor === 'none') return before + points
  if (floor === 'round') return before + Math.max(0, points)
  return Math.max(0, before + points) // 'total', the default
}

/** Per-game counters, folded into the career once the game ends. */
function blankTally() {
  return {
    votesCast: 0, votesRight: 0, votesBlank: 0, votedWithPack: 0, executions: 0,
    votesReceived: 0, votesReceivedInnocent: 0, accusedFirstRound: 0,
    cluesGiven: 0, cluesTimedOut: 0, spokeFirst: 0,
    readyLast: 0, readyFirst: 0,
  }
}

/** Who left the table in a given round — name only, never their word. */
function outOf(result) {
  return [result?.eliminated, ...(result?.alsoEliminated ?? [])]
    .filter(Boolean)
    .map((rec) => ({ id: rec.id, name: rec.name, avatar: rec.avatar }))
}

function publicModifiers(p, { includeSecret = false } = {}) {
  return (p.modifiers ?? [])
    .map((id) => getModifier(id))
    .filter((m) => includeSecret || !m.secret)
    .map((m) => ({ id: m.id, label: m.label, emoji: m.emoji, color: m.color, secret: Boolean(m.secret) }))
}

/**
 * A refusal the player is meant to read.
 *
 * `reason` is an optional machine-readable tag for the handful of cases the
 * client has to *act* on rather than merely display — matching on the French
 * sentence would break the moment someone reworded it.
 */
export class GameError extends Error {
  constructor(message, reason = null) {
    super(message)
    this.reason = reason
  }
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export { AVATARS, COLORS }

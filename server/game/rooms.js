import { Game, GameError } from './engine.js'
import { store } from '../store.js'

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ' // no I/O — unreadable on a TV

/** How long a room survives after the last player leaves it. */
const EMPTY_TTL_MS = 10 * 60 * 1000
/** Even a populated room does not outlive a very long evening. */
const IDLE_MS = 12 * 60 * 60 * 1000

/**
 * Two bounds on room creation.
 *
 * `host:create` needs no credentials by design — you open /host and you get a
 * code. Exposed to the internet that is also a free memory allocator, so a
 * single connection cannot hoard rooms, and the total is capped. The global
 * ceiling is deliberately roomy: it is a backstop against memory exhaustion,
 * not a quota real players should ever meet.
 */
const MAX_ROOMS = 200
const MAX_ROOMS_PER_SOCKET = 10

/**
 * How much of that ceiling last session may claim back.
 *
 * A restarted server used to restore every saved room it had, which after
 * enough evenings filled the cap before a single player had connected — and
 * then refused to open a new one. Yesterday's lobbies never get to crowd out
 * tonight's game.
 */
const MAX_RESTORED_ROOMS = 20

/**
 * Owns the live rooms and all socket wiring.
 *
 * The server is the single source of truth for who has which word. Clients get
 * two streams: `state` (public, broadcast to the room) and `you` (private, sent
 * only to that player's sockets). No client ever receives another player's word
 * before the game is over, so opening devtools tells you nothing.
 */
export function createRoomManager(io) {
  const rooms = new Map()

  /**
   * Is anyone actually there?
   *
   * A seat left by a player who closed the tab still holds their score and word
   * for the reconnection window, so `players.size` says "occupied" long after
   * the room went dark — and a room restored from disk starts out entirely
   * disconnected. Counting live sockets is what makes those reclaimable.
   */
  function occupied(game) {
    for (const p of game.players.values()) if (p.connected) return true
    for (const s of game.spectators.values()) if (s.connected) return true
    return false
  }

  /**
   * Drops rooms nobody is using. Returns how many were freed.
   *
   * The clock runs from the moment a room went empty, not from when it was
   * created — otherwise a room abandoned seconds after opening would sit around
   * for the full time-to-live, which is exactly the case worth reclaiming fast.
   */
  function sweep() {
    const now = Date.now()
    let freed = 0
    for (const [code, game] of rooms) {
      if (occupied(game)) {
        game.emptyAt = null
        if (now - game.createdAt <= IDLE_MS) continue
      } else {
        game.emptyAt ??= now
        if (now - game.emptyAt <= EMPTY_TTL_MS && now - game.createdAt <= IDLE_MS) continue
      }
      game.dispose()
      rooms.delete(code)
      store.forgetRoom(code)
      freed += 1
    }
    return freed
  }

  setInterval(sweep, 60 * 1000).unref()

  function newCode() {
    let code
    do {
      code = Array.from({ length: 4 }, () =>
        CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
      ).join('')
    } while (rooms.has(code))
    return code
  }

  function broadcast(game) {
    const pub = game.publicState()
    io.to(`room:${game.code}`).emit('state', pub)
    // Each phone gets its own tailored payload.
    for (const player of game.players.values()) {
      io.to(`player:${player.id}`).emit('you', game.privateState(player.id))
    }
    // Piggy-backs on every state change; the store debounces its own writes, so
    // this costs nothing beyond building the snapshot.
    if (game.players.size > 0) store.saveRoom(game.code, game.snapshot())
    else store.forgetRoom(game.code)
  }

  /** Builds an empty room object under a known code, wired for broadcast. */
  function newGame(code) {
    return new Game(code, {
      onUpdate: (g) => broadcast(g),
      onEvent: (e) => io.to(`room:${code}`).emit('event', e),
    })
  }

  /**
   * Brings back last session's rooms.
   *
   * Players land in the lobby with their score and their seat waiting; whoever
   * still has the page open reconnects into it without noticing the restart.
   */
  function restoreSavedRooms() {
    let restored = 0
    for (const [code, snapshot] of store.freshRooms()) {
      // Restored rooms are nobody's yet — every seat is disconnected, and the
      // sweeper needs a full cycle to notice. Filling the ceiling with them
      // would make the server refuse the very first `host:create` after a
      // restart, so live play always keeps the larger share.
      if (restored >= MAX_RESTORED_ROOMS) {
        store.forgetRoom(code)
        continue
      }
      if (rooms.has(code)) continue
      rooms.set(code, newGame(code).restoreFrom(snapshot))
      restored += 1
    }
    return restored
  }

  /**
   * Makes room at the ceiling by dropping the coldest empty lobby.
   *
   * Turning a group away because two hundred abandoned rooms are still inside
   * their reconnection window is the wrong trade: nobody is in those rooms, and
   * the one that has been dark longest is the one least likely to be missed.
   * Rooms with someone actually connected are never touched.
   */
  function evictColdest() {
    let coldest = null
    for (const [code, game] of rooms) {
      if (occupied(game)) continue
      const since = game.emptyAt ?? game.createdAt
      if (!coldest || since < coldest.since) coldest = { code, game, since }
    }
    if (!coldest) return false
    coldest.game.dispose()
    rooms.delete(coldest.code)
    store.forgetRoom(coldest.code)
    return true
  }

  function createRoom() {
    if (rooms.size >= MAX_ROOMS) {
      sweep()
      if (rooms.size >= MAX_ROOMS && !evictColdest()) {
        throw new GameError('Trop de parties ouvertes. Réessaie dans quelques minutes.')
      }
    }
    const code = newCode()
    const game = newGame(code)
    rooms.set(code, game)
    return game
  }

  io.on('connection', (socket) => {
    let joined = null // { code, playerId? }
    // True for the shared `/host` display, false for a player's phone. A socket
    // is one or the other, never both.
    let isScreen = false
    // Whether this screen may *drive* the game, as opposed to merely showing it.
    // Only the screen that opened the room gets it; see `host:watch`.
    let hasControl = false
    // One connection opening room after room is the abuse shape worth stopping;
    // a real host opens one and reuses it all evening.
    let roomsCreated = 0

    const ok = (cb, payload = {}) => typeof cb === 'function' && cb({ ok: true, ...payload })
    const fail = (cb, message, extra = {}) =>
      typeof cb === 'function' && cb({ ok: false, error: message, ...extra })

    /** Wraps a handler so GameError becomes a clean message instead of a crash. */
    const guard = (fn) => (payload, cb) => {
      try {
        fn(payload ?? {}, cb)
      } catch (err) {
        if (err instanceof GameError) {
          return fail(cb, err.message, err.reason ? { reason: err.reason } : {})
        }
        console.error('[socket]', err)
        fail(cb, 'Erreur serveur.')
      }
    }

    function requireGame(code) {
      const game = rooms.get(String(code ?? '').toUpperCase())
      if (!game) throw new GameError('Partie introuvable. Vérifie le code.')
      return game
    }

    /**
     * Gate for everything that drives the game forward.
     *
     * Two kinds of remote control are legitimate: the shared screen that opened
     * the room, and the phone of the player wearing the crown. Everyone else is
     * refused — before this existed, any connected client could start the game,
     * kick a player or wipe the scores just by emitting the event by hand.
     *
     * A screen proves it is *that* screen with the token handed out at creation.
     * Being on the right room is not proof: a four-letter code is guessable, and
     * once the game is open to strangers, "knows the code" and "owns the room"
     * stop being the same thing.
     */
    function requireController(code) {
      const game = requireGame(code)
      if (hasControl && joined?.code === game.code) return game

      const player = joined?.playerId ? game.players.get(joined.playerId) : null
      if (player?.isHost && !player.left) return game

      throw new GameError("Seul l'hôte peut faire ça.")
    }

    // ---- host --------------------------------------------------------------

    socket.on('host:create', guard((_, cb) => {
      if (roomsCreated >= MAX_ROOMS_PER_SOCKET) {
        throw new GameError('Trop de parties créées depuis cet écran. Recharge la page.')
      }
      roomsCreated += 1
      const game = createRoom()
      joined = { code: game.code }
      isScreen = true
      hasControl = true
      socket.join(`room:${game.code}`)
      // The token is what lets this screen come back after a refresh without
      // handing the same power to anyone who reads the code off the wall.
      ok(cb, { code: game.code, screenToken: game.screenToken, state: game.publicState() })
    }))

    /**
     * A screen attaching to a room.
     *
     * With the room's token it is the original screen returning from a refresh,
     * and keeps its controls. Without it — a TV joining a game that was started
     * from someone's phone — it displays everything and commands nothing. That
     * is deliberately the same amount of information a spectator already gets.
     */
    socket.on('host:watch', guard(({ code, screenToken }, cb) => {
      const game = requireGame(code)
      joined = { code: game.code, screenToken }
      isScreen = true
      hasControl = Boolean(screenToken) && screenToken === game.screenToken
      socket.join(`room:${game.code}`)
      ok(cb, { code: game.code, control: hasControl, state: game.publicState() })
    }))

    socket.on('host:settings', guard(({ code, settings }, cb) => {
      requireController(code).updateSettings(settings ?? {})
      ok(cb)
    }))

    socket.on('host:start', guard(({ code }, cb) => {
      requireController(code).start()
      ok(cb)
    }))

    socket.on('host:continue', guard(({ code }, cb) => {
      requireController(code).continueRound()
      ok(cb)
    }))

    socket.on('host:restart', guard(({ code }, cb) => {
      const game = requireController(code)
      const seated = game.restart()
      // Whoever watched this game now has a seat. Their phone is still showing
      // the spectator view and still bound to a spectator id, so tell it to
      // claim the seat — `player:rejoin` rewires that socket properly, which
      // nothing here could do on its behalf.
      for (const player of seated) {
        if (player.socketId) {
          io.to(player.socketId).emit('seated', { code: game.code, playerId: player.id })
        }
      }
      ok(cb)
    }))

    socket.on('host:skipDiscussion', guard(({ code }, cb) => {
      requireController(code).skipDiscussion()
      ok(cb)
    }))

    /** Closes the evening: podium, awards, and the two ways out. */
    socket.on('host:endSession', guard(({ code }, cb) => {
      requireController(code).endSession()
      ok(cb)
    }))

    socket.on('host:newEvening', guard(({ code }, cb) => {
      requireController(code).newEvening()
      ok(cb)
    }))

    socket.on('host:resetScores', guard(({ code }, cb) => {
      requireController(code).resetScores()
      ok(cb)
    }))

    /** Hands the remote control to another player. */
    socket.on('host:setHost', guard(({ code, playerId }, cb) => {
      requireController(code).setHost(playerId)
      ok(cb)
    }))

    /** Host removing someone from the room. */
    socket.on('host:kick', guard(({ code, playerId }, cb) => {
      const game = requireController(code)
      game.kick(playerId)
      io.to(`player:${playerId}`).emit('kicked')
      ok(cb)
    }))

    // ---- spectators --------------------------------------------------------

    /**
     * Watch without a seat. Works at any point, including mid-game.
     *
     * A spectator only ever receives the public state — the same feed as the
     * shared screen — so there is no cheating angle: nothing secret travels
     * down this channel, and no action is accepted back up it.
     */
    socket.on('spectate:join', guard(({ code, name, avatar, color, was }, cb) => {
      const game = requireGame(code)
      // Reconnecting after a dropped socket. The old entry usually died with
      // that socket, but if the disconnect has not landed yet it would sit
      // there holding this watcher's own name and avatar against them.
      if (was) game.removeSpectator(was)
      const spectator = game.addSpectator(name, { avatar, color })
      spectator.socketId = socket.id
      joined = { code: game.code, spectatorId: spectator.id }
      isScreen = false
      socket.join(`room:${game.code}`)
      ok(cb, {
        code: game.code,
        spectatorId: spectator.id,
        spectator: { name: spectator.name, avatar: spectator.avatar, color: spectator.color },
        state: game.publicState(),
      })
    }))

    socket.on('spectate:leave', guard(({ code, spectatorId }, cb) => {
      requireGame(code).removeSpectator(spectatorId)
      joined = null
      ok(cb)
    }))

    // ---- players -----------------------------------------------------------

    /**
     * Open a room straight from a phone, and sit down in it.
     *
     * The shared screen used to be the only way to start anything, which made a
     * computer a prerequisite for playing at all — fine around a television,
     * a dead end for anyone arriving alone with a link.
     *
     * Deliberately one event and not two: `host:create` followed by
     * `player:join` would leave an orphan room behind whenever the pseudo was
     * refused, and the caller would have to clean up after a failure.
     */
    socket.on('player:createGame', guard(({ name, avatar, color }, cb) => {
      if (roomsCreated >= MAX_ROOMS_PER_SOCKET) {
        throw new GameError('Trop de parties créées depuis cet appareil.')
      }
      const game = createRoom()
      let player
      try {
        // First to sit down gets the crown, from `addPlayer` — no special case.
        player = game.addPlayer(name, { avatar, color })
      } catch (err) {
        // Nobody ever saw this room; leaving it to the sweeper would hold a slot
        // against the ceiling for ten minutes for nothing.
        game.dispose()
        rooms.delete(game.code)
        throw err
      }

      roomsCreated += 1
      joined = { code: game.code, playerId: player.id }
      isScreen = false
      socket.join(`room:${game.code}`)
      socket.join(`player:${player.id}`)
      game.claimSocket(player.id, socket.id)

      ok(cb, {
        code: game.code,
        playerId: player.id,
        state: game.publicState(),
        you: game.privateState(player.id),
      })
    }))

    socket.on('player:join', guard(({ code, name, avatar, color }, cb) => {
      const game = requireGame(code)
      const player = game.addPlayer(name, { avatar, color })
      joined = { code: game.code, playerId: player.id }
      isScreen = false
      socket.join(`room:${game.code}`)
      socket.join(`player:${player.id}`)
      game.claimSocket(player.id, socket.id)
      ok(cb, {
        code: game.code,
        playerId: player.id,
        state: game.publicState(),
        you: game.privateState(player.id),
      })
    }))

    /** Reconnect after a phone locks its screen or the browser is refreshed. */
    socket.on('player:rejoin', guard(({ code, playerId }, cb) => {
      const game = requireGame(code)
      if (!game.players.has(playerId)) throw new GameError('Session expirée.')
      joined = { code: game.code, playerId }
      isScreen = false
      socket.join(`room:${game.code}`)
      socket.join(`player:${playerId}`)
      game.claimSocket(playerId, socket.id)
      ok(cb, {
        code: game.code,
        playerId,
        state: game.publicState(),
        you: game.privateState(playerId),
      })
    }))

    socket.on('player:react', guard(({ code, playerId, targetId, emoji }, cb) => {
      requireGame(code).react(playerId, targetId, emoji)
      ok(cb)
    }))

    /**
     * A dead civilian naming the impostors. The answer is deliberately not
     * broadcast — only the sender hears whether it landed, and even that waits
     * for the final screen.
     */
    socket.on('player:dyingGuess', guard(({ code, playerId, targetIds }, cb) => {
      requireGame(code).submitDyingGuess(playerId, targetIds)
      ok(cb)
    }))

    socket.on('player:appearance', guard(({ code, playerId, avatar, color }, cb) => {
      requireGame(code).setAppearance(playerId, { avatar, color })
      ok(cb)
    }))

    /** Deliberate exit, at any point in the game. */
    socket.on('player:quit', guard(({ code, playerId }, cb) => {
      requireGame(code).quit(playerId)
      socket.leave(`player:${playerId}`)
      joined = null
      ok(cb)
    }))

    socket.on('player:leave', guard(({ code, playerId }, cb) => {
      requireGame(code).removePlayer(playerId)
      joined = null
      ok(cb)
    }))

    socket.on('player:tiebreak', guard(({ code, playerId, targetId }, cb) => {
      requireGame(code).resolveTiebreak(playerId, targetId ?? null)
      ok(cb)
    }))

    socket.on('player:chat', guard(({ code, playerId, text }, cb) => {
      requireGame(code).postChat(playerId, text)
      ok(cb)
    }))

    /** A player asking to move on; the vote opens once everyone has asked. */
    socket.on('player:skipDiscussion', guard(({ code, playerId }, cb) => {
      requireGame(code).requestSkipDiscussion(playerId)
      ok(cb)
    }))

    socket.on('player:revenge', guard(({ code, playerId, targetId }, cb) => {
      requireGame(code).submitRevenge(playerId, targetId ?? null)
      ok(cb)
    }))

    socket.on('player:ready', guard(({ code, playerId }, cb) => {
      requireGame(code).markReady(playerId)
      ok(cb)
    }))

    socket.on('player:clue', guard(({ code, playerId, text }, cb) => {
      requireGame(code).submitClue(playerId, text)
      ok(cb)
    }))

    socket.on('player:vote', guard(({ code, playerId, targetId }, cb) => {
      requireGame(code).submitVote(playerId, targetId)
      ok(cb)
    }))

    socket.on('player:guess', guard(({ code, playerId, text }, cb) => {
      requireGame(code).submitGuess(playerId, text)
      ok(cb)
    }))

    /**
     * A page refresh closes this socket and opens another. The engine decides
     * what that means — it keeps the seat, waits out a grace period in the
     * lobby, and ignores the event entirely if a newer socket has already
     * claimed the player.
     */
    socket.on('disconnect', () => {
      const game = joined ? rooms.get(joined.code) : null
      if (!game) return
      if (joined.spectatorId) return game.removeSpectator(joined.spectatorId)
      if (joined.playerId) game.releaseSocket(joined.playerId, socket.id)
    })
  })

  const restored = restoreSavedRooms()

  return {
    rooms,
    restored,
    stats: () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((n, g) => n + g.players.size, 0) }),
  }
}

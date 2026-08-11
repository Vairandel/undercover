import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { socket, send } from '../socket.js'
import { playForEvent, play, cycleVolume, getVolume, ambienceForPhase } from '../audio.js'
import { ConfirmButton, Toast } from '../components.jsx'
import RulesSheet from '../RulesSheet.jsx'
import HostLobby from './HostLobby.jsx'
import HostRound from './HostRound.jsx'

const CODE_KEY = 'undercover.hostCode'
const TOKEN_KEY = 'undercover.hostToken'

/**
 * What a shared screen is for, asked rather than assumed.
 *
 * This screen used to open a room the instant it loaded, which is why starting
 * a game required a computer at all. Now that a phone can start one, the screen
 * has two honest jobs: open a game itself, or display one already running.
 */
function Welcome({ connected, onCreate, onWatch, error, setError }) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn) => {
    if (busy) return
    setBusy(true)
    play('tap')
    try { await fn() } finally { setBusy(false) }
  }

  return (
    <div className="screen screen--center">
      <div className="stack" style={{ width: '100%', maxWidth: 460, gap: 22 }}>
        <div className="stack" style={{ gap: 6 }}>
          <div style={{ fontSize: '3rem', lineHeight: 1 }}>🕵️</div>
          <h1 className="display">Undercover</h1>
          <p className="subtitle">Cet écran est celui que tout le monde regarde.</p>
        </div>

        <button
          className="btn btn--primary btn--block"
          disabled={busy || !connected}
          onClick={() => run(onCreate)}
        >
          {connected ? '✨  Ouvrir une partie' : 'Connexion…'}
        </button>

        <div className="stack" style={{ gap: 10 }}>
          <p className="eyebrow center">ou afficher une partie en cours</p>
          <input
            className="input input--code mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
            placeholder="····"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck="false"
            maxLength={4}
          />
          <button
            className="btn btn--block"
            disabled={busy || !connected || code.length !== 4}
            onClick={() => run(() => onWatch(code))}
          >
            📺  Afficher cette partie
          </button>
          <p className="setting__hint center">
            Une partie lancée depuis un téléphone se pilote depuis ce téléphone —
            cet écran l'affichera sans la commander.
          </p>
        </div>
      </div>

      <Toast message={error} onDone={() => setError(null)} />
    </div>
  )
}

export default function HostApp() {
  const [info, setInfo] = useState(null)
  const [state, setState] = useState(null)
  const [code, setCode] = useState(null)
  const [error, setError] = useState(null)
  const [connected, setConnected] = useState(socket.connected)
  const [sound, setSound] = useState(getVolume())
  const [rulesOpen, setRulesOpen] = useState(false)
  // False when this screen merely displays a game it did not open — see the
  // note on `host:watch` server-side.
  const [control, setControl] = useState(true)
  const bootstrapped = useRef(false)

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setError('Impossible de joindre le serveur.'))
  }, [])

  /**
   * Re-attach to the room this screen was already showing.
   *
   * Reusing the code across a refresh means an accidental F5 does not kick
   * everyone out. The token proves it is the same screen coming back rather
   * than someone who read the code off the wall.
   *
   * Nothing is created automatically any more: a game can now be started from a
   * phone, so a screen opening on an empty slate should ask what it is for
   * instead of manufacturing a room nobody asked for.
   */
  const bootstrap = useCallback(async () => {
    const saved = sessionStorage.getItem(CODE_KEY)
    if (!saved) return
    try {
      const res = await send('host:watch', {
        code: saved,
        screenToken: sessionStorage.getItem(TOKEN_KEY) ?? undefined,
      })
      setCode(res.code)
      setControl(res.control !== false)
      setState(res.state)
    } catch {
      sessionStorage.removeItem(CODE_KEY)
      sessionStorage.removeItem(TOKEN_KEY)
    }
  }, [])

  const createRoom = useCallback(async () => {
    const res = await send('host:create')
    sessionStorage.setItem(CODE_KEY, res.code)
    sessionStorage.setItem(TOKEN_KEY, res.screenToken)
    setCode(res.code)
    setControl(true)
    setState(res.state)
  }, [])

  /** Attach to a game someone started elsewhere — display only. */
  const watchRoom = useCallback(async (wanted) => {
    const res = await send('host:watch', { code: wanted.toUpperCase() })
    sessionStorage.setItem(CODE_KEY, res.code)
    sessionStorage.removeItem(TOKEN_KEY)
    setCode(res.code)
    setControl(res.control !== false)
    setState(res.state)
  }, [])

  useEffect(() => {
    const onConnect = () => {
      setConnected(true)
      bootstrap().catch((e) => setError(e.message))
    }
    const onDisconnect = () => setConnected(false)
    const onState = (s) => setState(s)
    const onEvent = (e) => playForEvent(e)

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('state', onState)
    socket.on('event', onEvent)

    if (socket.connected && !bootstrapped.current) {
      bootstrapped.current = true
      onConnect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('state', onState)
      socket.off('event', onEvent)
    }
  }, [bootstrap])

  // The host screen carries the room's sound, so the phase beds live here.
  useEffect(() => {
    ambienceForPhase(state?.phase)
  }, [state?.phase])

  const act = useCallback(
    async (event, payload = {}) => {
      try {
        await send(event, { code, ...payload })
      } catch (e) {
        play('error')
        setError(e.message)
      }
    },
    [code],
  )

  const nextVolume = () => {
    const step = cycleVolume()
    setSound(step)
    if (step.gain > 0) play('tap')
  }

  if (!info) {
    return (
      <div className="screen screen--center">
        <motion.div
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 1.6, repeat: Infinity }}
          className="title"
        >
          🕵️ Undercover
        </motion.div>
        <p className="subtitle">{error ?? 'Démarrage du serveur…'}</p>
      </div>
    )
  }

  // No room yet: ask what this screen is for rather than inventing one.
  if (!state) {
    return (
      <Welcome
        connected={connected}
        onCreate={() => createRoom().catch((e) => setError(e.message))}
        onWatch={(c) => watchRoom(c).catch((e) => setError(e.message))}
        error={error}
        setError={setError}
      />
    )
  }

  /**
   * The address to hand to players.
   *
   * Taken from the browser's own location, not from what the server was started
   * with: a tunnel hostname changes between sessions, and this way the code and
   * the printed address follow it without restarting anything. `origin` also
   * drops the `/host` path on its own.
   *
   * A host browsing on localhost is the exception — that address means nothing
   * to anyone else, so the server's configured public URL wins.
   */
  const origin = window.location.origin
  const onLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin)
  const joinUrl = onLoopback && info.url && !/(localhost|127\.0\.0\.1)/.test(info.url)
    ? info.url
    : origin

  // What is actually dealt tonight, so the rulebook can highlight it.
  const activeRoles = [
    ...Object.keys(state.composition?.comp ?? {}),
    ...(state.composition?.modifiers ?? []),
  ]

  return (
    <div className="host">
      <header className="host__header">
        <div className="host__brand">
          <span>🕵️</span>
          <span>UNDERCOVER</span>
          {state.theme && (
            <span className="badge">
              {state.theme.emoji} {state.theme.label}
            </span>
          )}
          {state.round > 0 && <span className="badge">Manche {state.round}</span>}
        </div>

        <div className="row">
          {!connected && <span className="badge" style={{ color: 'var(--danger)' }}>hors ligne</span>}
          {/* Says plainly that this screen is a display, so nobody stands in
              front of it wondering why nothing responds. */}
          {!control && <span className="badge">👁 affichage seul · la couronne commande</span>}
          <span className="badge">{joinUrl.replace(/^https?:\/\//, '')}</span>

          <button
            className="btn btn--ghost btn--sm"
            onClick={() => { play('tap'); setRulesOpen(true) }}
          >
            📖 Règles
          </button>

          {/* Escape hatch for a round that has stalled or a player who has to
              leave — the server accepts a restart from any phase. */}
          {control && state.phase !== 'lobby' && state.phase !== 'gameOver' && (
            <ConfirmButton
              className="btn btn--ghost btn--sm"
              label="Abandonner"
              confirmLabel="Tout arrêter ?"
              onConfirm={() => act('host:restart')}
            />
          )}

          <button className="btn btn--ghost btn--sm" onClick={nextVolume} title={sound.label}>
            {sound.icon}
          </button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        <motion.div
          key={state.phase}
          className="host__body"
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -22 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        >
          {state.phase === 'lobby' ? (
            <HostLobby state={state} info={info} joinUrl={joinUrl} act={act} control={control} />
          ) : (
            <HostRound state={state} act={act} control={control} />
          )}
        </motion.div>
      </AnimatePresence>

      {/* Latecomers waiting out the round. Worth showing on the big screen: the
          table can see the game is about to grow, and whoever just scanned the
          QR code gets visible confirmation they are in. */}
      {state.spectators?.length > 0 && (
        <div className="waitingroom">
          <span className="eyebrow">👁 En attente</span>
          {state.spectators.map((s) => (
            <span key={s.id} className="waitingroom__chip" style={{ borderColor: s.color }}>
              <span>{s.avatar}</span> {s.name}
            </span>
          ))}
          <span className="faint" style={{ fontSize: '0.72rem' }}>
            {state.phase === 'lobby' ? 'peuvent prendre place' : 'joueront à la prochaine manche'}
          </span>
        </div>
      )}

      <RulesSheet
        info={info}
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        activeRoles={activeRoles}
        points={state.settings?.points}
        settings={state.settings}
      />

      <Toast message={error} onDone={() => setError(null)} />
    </div>
  )
}

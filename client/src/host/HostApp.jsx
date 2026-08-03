import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { socket, send } from '../socket.js'
import { playForEvent, play, cycleVolume, getVolume, ambienceForPhase } from '../audio.js'
import { ConfirmButton, Toast } from '../components.jsx'
import RulesSheet from '../RulesSheet.jsx'
import HostLobby from './HostLobby.jsx'
import HostRound from './HostRound.jsx'

const CODE_KEY = 'undercover.hostCode'

export default function HostApp() {
  const [info, setInfo] = useState(null)
  const [state, setState] = useState(null)
  const [code, setCode] = useState(null)
  const [error, setError] = useState(null)
  const [connected, setConnected] = useState(socket.connected)
  const [sound, setSound] = useState(getVolume())
  const [rulesOpen, setRulesOpen] = useState(false)
  const bootstrapped = useRef(false)

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setError('Impossible de joindre le serveur.'))
  }, [])

  // Recreate or re-attach to a room. Reusing the code across a refresh means an
  // accidental F5 on the host screen does not kick everyone out of the game.
  const bootstrap = useCallback(async () => {
    const saved = sessionStorage.getItem(CODE_KEY)
    try {
      if (saved) {
        const res = await send('host:watch', { code: saved })
        setCode(res.code)
        setState(res.state)
        return
      }
    } catch {
      sessionStorage.removeItem(CODE_KEY)
    }
    const res = await send('host:create')
    sessionStorage.setItem(CODE_KEY, res.code)
    setCode(res.code)
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

  if (!state || !info) {
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
          <span className="badge">{joinUrl.replace(/^https?:\/\//, '')}</span>

          <button
            className="btn btn--ghost btn--sm"
            onClick={() => { play('tap'); setRulesOpen(true) }}
          >
            📖 Règles
          </button>

          {/* Escape hatch for a round that has stalled or a player who has to
              leave — the server accepts a restart from any phase. */}
          {state.phase !== 'lobby' && state.phase !== 'gameOver' && (
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
            <HostLobby state={state} info={info} joinUrl={joinUrl} act={act} />
          ) : (
            <HostRound state={state} act={act} />
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
      />

      <Toast message={error} onDone={() => setError(null)} />
    </div>
  )
}

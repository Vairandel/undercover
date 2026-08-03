import { useCallback, useEffect, useRef, useState } from 'react'
import { socket, send, saveSession, loadSession, clearSession } from '../socket.js'
import { playForEvent, play, ambienceForPhase } from '../audio.js'
import { Toast } from '../components.jsx'
import JoinScreen from './JoinScreen.jsx'
import PlayerRound from './PlayerRound.jsx'

export default function PlayerApp() {
  const [session, setSession] = useState(() => loadSession())
  const [state, setState] = useState(null)
  const [you, setYou] = useState(null)
  const [error, setError] = useState(null)
  const [connected, setConnected] = useState(socket.connected)
  const [info, setInfo] = useState(null)
  const rejoining = useRef(false)

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => {})
  }, [])

  const appearance = info?.appearance

  /**
   * Take the seat back after any interruption — a refresh, a locked phone, a
   * wifi handover.
   *
   * The session is only thrown away when the server *tells* us the seat is
   * gone. A timeout or a dropped packet is not that: retrying is right, and
   * clearing the session there would eject a player mid-game over one slow
   * second.
   */
  const rejoin = useCallback(async (s, attempt = 0) => {
    if (!s?.code || !s?.playerId || rejoining.current) return
    rejoining.current = true
    try {
      const res = await send('player:rejoin', s)
      setState(res.state)
      setYou(res.you)
    } catch (err) {
      if (err.transient) {
        // Network hiccup: keep the seat and try again shortly. A reconnect will
        // also retrigger this on its own.
        rejoining.current = false
        if (attempt < 4) setTimeout(() => rejoin(s, attempt + 1), 1200 * (attempt + 1))
        return
      }
      // The server refused: the room is gone, or the seat was released.
      clearSession()
      setSession(null)
      setState(null)
      setYou(null)
    } finally {
      rejoining.current = false
    }
  }, [])

  useEffect(() => {
    const onConnect = () => {
      setConnected(true)
      rejoin(loadSession())
    }
    const onDisconnect = () => setConnected(false)

    // Thrown out by the host: drop the session so the phone lands back on the
    // join screen instead of sitting on a stale board.
    const onKicked = () => {
      play('error')
      clearSession()
      setSession(null)
      setState(null)
      setYou(null)
      setError("L'hôte t'a retiré de la partie.")
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('state', setState)
    socket.on('you', setYou)
    socket.on('event', playForEvent)
    socket.on('kicked', onKicked)

    if (socket.connected) onConnect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('state', setState)
      socket.off('you', setYou)
      socket.off('event', playForEvent)
      socket.off('kicked', onKicked)
    }
  }, [rejoin])

  // Background beds follow the phase: tension under the vote, a heartbeat while
  // Mister White is guessing, silence otherwise.
  useEffect(() => {
    ambienceForPhase(state?.phase)
  }, [state?.phase])

  /**
   * Coming back from another app, a locked screen, or the back button.
   *
   * The old version only acted `if (socket.connected)` — which is precisely
   * never true at that moment, since backgrounding is what killed the socket.
   * It then waited on socket.io's own retry loop, itself suspended with the
   * page. So the fix is to nudge the connection open ourselves and ask for the
   * seat back regardless: the emit is buffered and flushes on reconnect.
   *
   * `pageshow` covers Safari's back-forward cache, which restores a page
   * without ever firing `visibilitychange`.
   */
  useEffect(() => {
    const wakeUp = () => {
      if (document.visibilityState !== 'visible') return
      if (!socket.connected) socket.connect()
      rejoin(loadSession())
    }
    document.addEventListener('visibilitychange', wakeUp)
    window.addEventListener('pageshow', wakeUp)
    window.addEventListener('focus', wakeUp)
    return () => {
      document.removeEventListener('visibilitychange', wakeUp)
      window.removeEventListener('pageshow', wakeUp)
      window.removeEventListener('focus', wakeUp)
    }
  }, [rejoin])

  const join = async (code, name, look = {}) => {
    const res = await send('player:join', {
      code: code.toUpperCase(),
      name,
      avatar: look.avatar,
      color: look.color,
    })
    const s = { code: res.code, playerId: res.playerId }
    saveSession(s)
    setSession(s)
    setState(res.state)
    setYou(res.you)
  }

  const act = useCallback(
    async (event, payload = {}) => {
      try {
        await send(event, { code: session?.code, playerId: session?.playerId, ...payload })
      } catch (e) {
        play('error')
        setError(e.message)
        throw e
      }
    },
    [session],
  )

  /** Leave for good, from any phase. The server empties the seat and, if that
   *  decides the game, ends it rather than leaving everyone stuck. */
  const leave = async () => {
    try {
      await act('player:quit')
    } catch { /* leaving is best-effort */ }
    clearSession()
    setSession(null)
    setState(null)
    setYou(null)
  }

  if (!session || !state || !you) {
    return <JoinScreen onJoin={join} connected={connected} error={error} setError={setError} />
  }

  return (
    <>
      <PlayerRound
        state={state}
        you={you}
        act={act}
        leave={leave}
        connected={connected}
        appearance={appearance}
        info={info}
      />
      <Toast message={error} onDone={() => setError(null)} />
    </>
  )
}

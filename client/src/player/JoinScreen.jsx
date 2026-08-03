import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { AvatarPicker, Toast } from '../components.jsx'
import RulesSheet from '../RulesSheet.jsx'
import { play } from '../audio.js'

export default function JoinScreen({ onJoin, onSpectate, connected, error, setError }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [look, setLook] = useState(null)
  const [info, setInfo] = useState(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const nameRef = useRef(null)

  const appearance = info?.appearance

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then((data) => {
        setInfo(data)
        // Start on a random look so a table of six doesn't end up all foxes.
        const { avatars, colors } = data.appearance
        setLook({
          avatar: avatars[Math.floor(Math.random() * avatars.length)],
          color: colors[Math.floor(Math.random() * colors.length)],
        })
      })
      .catch(() => setInfo({ appearance: { avatars: [], colors: [] }, roles: [] }))
  }, [])

  // Deep link support: the QR on the host screen can carry ?code=ABCD so the
  // player only ever types their name.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('code')
    if (fromUrl) setCode(fromUrl.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))
  }, [])

  const ready = code.length === 4 && name.trim().length > 0 && look

  const submit = async (e) => {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      play('tap')
      const res = await onJoin(code, name, look)
      // A game already under way puts us in the stands instead of turning us
      // away. Say so, otherwise landing on a board you cannot touch reads as a
      // bug rather than as "you're in, next round".
      if (res?.seated === false) {
        setError('Partie en cours — tu regardes, et tu joues à la prochaine manche.')
      }
    } catch (err) {
      play('error')
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="screen screen--center" onSubmit={submit}>
      <motion.div
        className="stack"
        style={{ width: '100%', maxWidth: 400, gap: 22 }}
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="stack" style={{ gap: 8 }}>
          <div style={{ fontSize: '3rem', lineHeight: 1 }}>{look?.avatar ?? '🕵️'}</div>
          <h1 className="display">Undercover</h1>
          <p className="subtitle">Entre le code affiché sur l'écran.</p>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <input
            className="input input--code mono"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
            placeholder="····"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck="false"
            maxLength={4}
            onKeyUp={(e) => {
              if (e.currentTarget.value.length === 4) nameRef.current?.focus()
            }}
          />

          <input
            ref={nameRef}
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 16))}
            placeholder="Ton pseudo"
            autoComplete="off"
            maxLength={16}
          />
        </div>

        {appearance?.avatars?.length > 0 && look && (
          <div className="stack" style={{ gap: 10 }}>
            <p className="eyebrow center">Ton avatar</p>
            <AvatarPicker
              avatars={appearance.avatars}
              colors={appearance.colors}
              avatar={look.avatar}
              color={look.color}
              onChange={setLook}
            />
          </div>
        )}

        <button className="btn btn--primary btn--block" disabled={!ready || busy || !connected}>
          {!connected ? 'Connexion…' : busy ? 'On y va…' : 'Rejoindre'}
        </button>

        {/* For someone who wants the stands even when a seat is free — during a
            game, the button above already lands them here on its own. Either
            way they are seated automatically at the next round. */}
        <button
          type="button"
          className="btn btn--ghost btn--block btn--sm"
          disabled={!ready || busy || !connected}
          onClick={async () => {
            setBusy(true)
            try {
              play('tap')
              await onSpectate(code, name, look)
            } catch (err) {
              play('error')
              setError(err.message)
            } finally {
              setBusy(false)
            }
          }}
        >
          👁  Regarder cette manche
        </button>

        {!connected && (
          <p className="subtitle faint" style={{ fontSize: '0.85rem' }}>
            Vérifie que tu es bien sur le même wifi que l'ordinateur.
          </p>
        )}

        {/* Reachable before joining, so a newcomer can read up while the others
            are still typing their pseudo. */}
        <button
          type="button"
          className="btn btn--ghost btn--block btn--sm"
          onClick={() => { play('tap'); setRulesOpen(true) }}
        >
          📖 Règles et rôles
        </button>
      </motion.div>

      <RulesSheet info={info} open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <Toast message={error} onDone={() => setError(null)} />
    </form>
  )
}

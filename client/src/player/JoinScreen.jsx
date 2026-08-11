import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AvatarPicker, Toast } from '../components.jsx'
import RulesSheet from '../RulesSheet.jsx'
import { play } from '../audio.js'

/**
 * Getting into a game, in two steps.
 *
 * It used to be one screen that asked for a four-letter code first — a question
 * that means nothing to half its visitors, since somebody arriving to *open* a
 * game has no code to give. They had to work out on their own that the field
 * did not concern them and scroll past it.
 *
 * So: what do you want to do, then who are you. One question per screen, and
 * the code field only appears once it means something.
 *
 * Scanning the QR code skips straight to the second step — the address carries
 * the code, so the most common path of an evening is now shorter than it was,
 * not longer.
 */
export default function JoinScreen({ onJoin, onCreate, connected, error, setError }) {
  const [step, setStep] = useState('choose') // 'choose' | 'identity'
  const [mode, setMode] = useState(null) // 'create' | 'join'
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [look, setLook] = useState(null)
  const [info, setInfo] = useState(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [busy, setBusy] = useState(false)

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

  // The QR code carries `?code=ABCD`, so a scan already answers the first
  // question. Asking it again would be the one place this flow got worse.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('code')
    if (!fromUrl) return
    const clean = fromUrl.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4)
    if (clean.length !== 4) return
    setCode(clean)
    setMode('join')
    setStep('identity')
  }, [])

  const go = async (fn) => {
    if (busy) return
    setBusy(true)
    try {
      play('tap')
      await fn()
    } catch (err) {
      play('error')
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !look || !connected) return
    await go(async () => {
      if (mode === 'create') return onCreate(name, look)
      const res = await onJoin(code, name, look)
      // Joining a game already under way puts you in the stands rather than
      // turning you away. Say so, or landing on a board you cannot touch reads
      // as a bug instead of "you're in, next round".
      if (res?.seated === false) {
        setError('Partie en cours — tu regardes, et tu joues à la prochaine manche.')
      }
    })
  }

  const rules = (
    <button
      type="button"
      className="btn btn--ghost btn--block btn--sm"
      onClick={() => { play('tap'); setRulesOpen(true) }}
    >
      📖 Règles et rôles
    </button>
  )

  return (
    <form className="screen screen--center" onSubmit={submit}>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="stack"
          style={{ width: '100%', maxWidth: 420, gap: 20 }}
          initial={{ opacity: 0, x: step === 'identity' ? 30 : -30 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: step === 'identity' ? -30 : 30 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        >
          {step === 'choose' ? (
            <>
              <div className="stack" style={{ gap: 8 }}>
                <div style={{ fontSize: '3rem', lineHeight: 1 }}>🕵️</div>
                <h1 className="display">Undercover</h1>
                <p className="subtitle">Tout le monde a le même mot. Sauf un ou deux.</p>
              </div>

              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={!connected}
                onClick={() => { play('tap'); setMode('create'); setStep('identity') }}
              >
                {connected ? '✨  Créer une partie' : 'Connexion…'}
              </button>

              {mode === 'join' ? (
                <div className="stack" style={{ gap: 10 }}>
                  <p className="eyebrow center">Le code affiché sur l'écran</p>
                  <input
                    className="input input--code mono"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4))}
                    placeholder="····"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck="false"
                    maxLength={4}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn btn--block"
                    disabled={code.length !== 4 || !connected}
                    onClick={() => { play('tap'); setStep('identity') }}
                  >
                    Continuer →
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn btn--block"
                  disabled={!connected}
                  onClick={() => { play('tap'); setMode('join') }}
                >
                  Rejoindre une partie
                </button>
              )}

              {!connected && (
                <p className="subtitle faint" style={{ fontSize: '0.85rem' }}>
                  Vérifie que tu es bien sur le même wifi que l'ordinateur.
                </p>
              )}

              {/* Readable before joining, so a newcomer can read up while the
                  others are still typing their pseudo. */}
              {rules}
            </>
          ) : (
            <>
              <div className="stack" style={{ gap: 6 }}>
                <div style={{ fontSize: '3rem', lineHeight: 1 }}>{look?.avatar ?? '🕵️'}</div>
                <h1 className="title">
                  {mode === 'create' ? 'Ta nouvelle partie' : `Partie ${code}`}
                </h1>
                <p className="subtitle">Choisis ton pseudo et ta tête.</p>
              </div>

              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value.slice(0, 16))}
                placeholder="Ton pseudo"
                autoComplete="off"
                maxLength={16}
                autoFocus
              />

              {appearance?.avatars?.length > 0 && look && (
                <AvatarPicker
                  avatars={appearance.avatars}
                  groups={appearance.groups}
                  colors={appearance.colors}
                  avatar={look.avatar}
                  color={look.color}
                  onChange={setLook}
                />
              )}

              <button
                className="btn btn--primary btn--block"
                disabled={!name.trim() || !look || busy || !connected}
              >
                {busy
                  ? 'On y va…'
                  : mode === 'create'
                    ? '✨  Créer la partie'
                    : '▶  Rejoindre'}
              </button>

              <button
                type="button"
                className="btn btn--ghost btn--block btn--sm"
                disabled={busy}
                onClick={() => { play('tap'); setStep('choose') }}
              >
                ← Retour
              </button>
            </>
          )}
        </motion.div>
      </AnimatePresence>

      <RulesSheet info={info} open={rulesOpen} onClose={() => setRulesOpen(false)} />

      <Toast message={error} onDone={() => setError(null)} />
    </form>
  )
}

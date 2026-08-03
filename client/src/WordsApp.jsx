import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConfirmButton, Toast } from './components.jsx'
import { play } from './audio.js'

/**
 * Word bank editor.
 *
 * Adding a theme used to mean hand-editing JSON on the machine running the
 * server. Everything written here goes to `custom-words.json`, never to the
 * shipped theme files — so the bundled bank stays pristine, host additions are
 * one file to back up, and nothing the editor does can break what ships.
 */
export default function WordsApp() {
  const [themes, setThemes] = useState(null)
  const [total, setTotal] = useState(0)
  const [needsToken, setNeedsToken] = useState(false)
  const [token, setToken] = useState(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('token')
    if (fromUrl) return fromUrl
    try { return localStorage.getItem('undercover.adminToken') ?? '' } catch { return '' }
  })
  const [openId, setOpenId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const [newA, setNewA] = useState('')
  const [newB, setNewB] = useState('')
  const [newDefA, setNewDefA] = useState('')
  const [newDefB, setNewDefB] = useState('')
  const [themeLabel, setThemeLabel] = useState('')
  const [themeEmoji, setThemeEmoji] = useState('🎲')

  useEffect(() => {
    try { localStorage.setItem('undercover.adminToken', token) } catch { /* private */ }
  }, [token])

  const refresh = useCallback(async () => {
    const r = await fetch('/api/words')
    const j = await r.json()
    setThemes(j.themes)
    setTotal(j.total)
    setNeedsToken(j.needsToken)
  }, [])

  useEffect(() => { refresh().catch(() => setError('Serveur injoignable.')) }, [refresh])

  const openTheme = async (id) => {
    if (openId === id) { setOpenId(null); setDetail(null); return }
    play('tap')
    const r = await fetch(`/api/words/${id}`)
    if (!r.ok) return setError('Thème introuvable.')
    setDetail(await r.json())
    setOpenId(id)
  }

  /** Every write goes through here, so the token and errors live in one place. */
  const write = async (url, method, body) => {
    if (busy) return null
    setBusy(true)
    try {
      const r = await fetch(url + (needsToken && token ? `?token=${encodeURIComponent(token)}` : ''), {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { play('error'); setError(j.error ?? 'Refusé.'); return null }
      play('select')
      setThemes(j.themes ?? themes)
      setTotal(j.total ?? total)
      if (j.theme) { setDetail(j.theme); setOpenId(j.theme.id) }
      return j
    } catch {
      setError('Serveur injoignable.')
      return null
    } finally {
      setBusy(false)
    }
  }

  const submitPair = async (e) => {
    e.preventDefault()
    if (!newA.trim() || !newB.trim()) return
    const res = await write(`/api/words/${openId}/pair`, 'POST', {
      a: newA, b: newB, defA: newDefA, defB: newDefB,
    })
    if (res) { setNewA(''); setNewB(''); setNewDefA(''); setNewDefB('') }
  }

  const submitTheme = async (e) => {
    e.preventDefault()
    if (!themeLabel.trim()) return
    const res = await write('/api/words/theme', 'POST', { label: themeLabel, emoji: themeEmoji })
    if (res) { setThemeLabel(''); setThemeEmoji('🎲') }
  }

  if (!themes) {
    return (
      <div className="screen screen--center">
        <p className="subtitle pulse">Chargement de la banque…</p>
        <Toast message={error} onDone={() => setError(null)} />
      </div>
    )
  }

  return (
    <div className="screen" style={{ maxWidth: 720, margin: '0 auto', width: '100%' }}>
      <header className="spread">
        <div>
          <h1 className="title">📚 Banque de mots</h1>
          <p className="faint" style={{ fontSize: '0.8rem' }}>
            {total} paires · {themes.length} thèmes
          </p>
        </div>
        <a className="btn btn--ghost btn--sm" href="/host">← Retour au jeu</a>
      </header>

      {needsToken && (
        <div className="card card--tight">
          <p className="setting__label">Jeton administrateur</p>
          <p className="setting__hint" style={{ marginBottom: 8 }}>
            Le serveur est exposé publiquement : toute modification demande le jeton
            (<code>ADMIN_TOKEN</code>) affiché au démarrage.
          </p>
          <input
            className="input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="jeton…"
            autoComplete="off"
          />
        </div>
      )}

      <div className="stack" style={{ gap: 8 }}>
        {themes.map((t) => (
          <div key={t.id}>
            <button
              type="button"
              className="rolecard"
              style={{ width: '100%', cursor: 'pointer', textAlign: 'left', color: 'inherit' }}
              onClick={() => openTheme(t.id)}
            >
              <span className="rolecard__emoji">{t.emoji}</span>
              <div className="grow">
                <div className="rolecard__label">
                  {t.label}
                  {!t.builtIn && (
                    <span className="badge" style={{ marginLeft: 8, fontSize: '0.62rem' }}>perso</span>
                  )}
                </div>
                <div className="rolecard__tag">
                  {t.total} paires · {t.remaining} jamais jouées · {t.described} définies
                </div>
              </div>
              <span className="faint">{openId === t.id ? '▾' : '▸'}</span>
            </button>

            <AnimatePresence>
              {openId === t.id && detail && (
                <motion.div
                  className="card"
                  style={{ marginTop: 8 }}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.24 }}
                >
                  <form className="stack" style={{ gap: 8, marginBottom: 14 }} onSubmit={submitPair}>
                    <p className="eyebrow">Ajouter une paire</p>
                    <div className="row" style={{ gap: 8 }}>
                      <input className="input grow" value={newA} placeholder="Premier mot"
                        onChange={(e) => setNewA(e.target.value)} maxLength={40} />
                      <input className="input grow" value={newB} placeholder="Mot voisin"
                        onChange={(e) => setNewB(e.target.value)} maxLength={40} />
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <input className="input grow" value={newDefA} placeholder="Définition (facultatif)"
                        onChange={(e) => setNewDefA(e.target.value)} maxLength={160} />
                      <input className="input grow" value={newDefB} placeholder="Définition (facultatif)"
                        onChange={(e) => setNewDefB(e.target.value)} maxLength={160} />
                    </div>
                    <button className="btn btn--primary btn--block btn--sm"
                      disabled={busy || !newA.trim() || !newB.trim()}>
                      Ajouter
                    </button>
                    <p className="setting__hint">
                      Deux mots proches mais distinguables — c'est ce qui fait une bonne manche.
                    </p>
                  </form>

                  <hr className="divider" />

                  <div className="wordlist scroll-y">
                    {detail.pairs.map((p) => (
                      <div className="wordpair" key={p.key}>
                        <div className="grow">
                          <div className="wordpair__words">
                            {p.a} <span className="faint">/</span> {p.b}
                            {p.custom && <span className="badge" style={{ marginLeft: 8, fontSize: '0.6rem' }}>ajoutée</span>}
                            {p.seen && <span className="faint" style={{ marginLeft: 6, fontSize: '0.7rem' }}>déjà jouée</span>}
                          </div>
                          {(p.defA || p.defB) && (
                            <div className="wordpair__def">{p.defA ?? ''}{p.defA && p.defB ? ' · ' : ''}{p.defB ?? ''}</div>
                          )}
                        </div>
                        {p.custom && (
                          <button
                            type="button"
                            className="btn btn--ghost btn--sm"
                            disabled={busy}
                            onClick={() => write(`/api/words/${t.id}/pair/${encodeURIComponent(p.key)}`, 'DELETE')}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {!t.builtIn && (
                    <>
                      <hr className="divider" />
                      <ConfirmButton
                        className="btn btn--ghost btn--block btn--sm"
                        label="Supprimer ce thème"
                        confirmLabel="Confirmer la suppression ?"
                        onConfirm={async () => {
                          await write(`/api/words/${t.id}`, 'DELETE')
                          setOpenId(null); setDetail(null)
                        }}
                      />
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <form className="card" onSubmit={submitTheme}>
        <p className="eyebrow" style={{ marginBottom: 8 }}>Nouveau thème</p>
        <div className="row" style={{ gap: 8 }}>
          <input className="input" style={{ width: 70, textAlign: 'center' }} value={themeEmoji}
            onChange={(e) => setThemeEmoji(e.target.value.slice(0, 4))} />
          <input className="input grow" value={themeLabel} placeholder="Nom du thème"
            onChange={(e) => setThemeLabel(e.target.value)} maxLength={32} />
          <button className="btn btn--primary" disabled={busy || !themeLabel.trim()}>Créer</button>
        </div>
      </form>

      <Toast message={error} onDone={() => setError(null)} />
    </div>
  )
}

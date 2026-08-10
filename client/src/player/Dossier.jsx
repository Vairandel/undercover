import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { play } from '../audio.js'

/**
 * The pull-down every player needs mid-game, in two tabs.
 *
 * By round three, two things have slipped: your own modifiers — read once
 * during the reveal and never seen again — and what the quiet one actually said
 * back in round one. Both were already knowable; the game was just asking
 * people to hold them in their head.
 *
 * The history is safe to show anyone because every clue in it was given in the
 * open. Secret words never enter it.
 */
export default function Dossier({ state, you }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('card')

  const rounds = state.clueLog ?? []
  const nameOf = (id) => state.players.find((p) => p.id === id)

  if (!you?.role) return null

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        onClick={() => { play('tap'); setOpen(true) }}
        aria-label="Ma carte et l'historique"
      >
        🗂️
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            className="sheet__backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          >
            <motion.div
              className="sheet"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="sheet__head">
                <div className="segmented grow">
                  <button
                    type="button"
                    data-active={tab === 'card'}
                    className="grow"
                    onClick={() => { play('tap'); setTab('card') }}
                  >
                    🎴 Ma carte
                  </button>
                  <button
                    type="button"
                    data-active={tab === 'log'}
                    className="grow"
                    onClick={() => { play('tap'); setTab('log') }}
                  >
                    📜 Historique
                  </button>
                </div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="sheet__body scroll-y">
                {tab === 'card' ? (
                  <div className="stack" style={{ gap: 12 }}>
                    <div className="stack center" style={{ gap: 6 }}>
                      <span
                        className="wordcard__role"
                        style={{ background: `${you.role.color}22`, color: you.role.color }}
                      >
                        {you.role.emoji} {you.brief.title}
                      </span>
                      <div className="dossier__word">{you.word ?? '? ? ?'}</div>
                      {you.wordDef && (
                        <p className="wordcard__hint" style={{ fontStyle: 'italic', opacity: 0.85 }}>
                          {you.wordDef}
                        </p>
                      )}
                    </div>

                    <p className="wordcard__hint" style={{ maxWidth: 'none' }}>{you.brief.body}</p>

                    {you.extras?.map((extra, i) => (
                      <div
                        key={i}
                        className="intel"
                        style={{ borderColor: extra.color, background: `${extra.color}18` }}
                      >
                        <div style={{ fontWeight: 750, color: extra.color, marginBottom: 4 }}>
                          {extra.title}
                        </div>
                        <p className="wordcard__hint" style={{ maxWidth: 'none' }}>{extra.body}</p>
                      </div>
                    ))}

                    <p className="setting__hint center">
                      Personne d'autre ne voit cet écran — mais garde-le pour toi quand même.
                    </p>
                  </div>
                ) : rounds.length === 0 ? (
                  <p className="subtitle center">Aucun indice donné pour l'instant.</p>
                ) : (
                  <div className="stack" style={{ gap: 16 }}>
                    {rounds.map((r) => (
                      <div className="stack" style={{ gap: 6 }} key={r.round}>
                        <p className="eyebrow">
                          Manche {r.round}
                          {r.out?.length > 0 && (
                            <span className="faint" style={{ textTransform: 'none', letterSpacing: 0 }}>
                              {' '}· {r.out.map((o) => `${o.avatar} ${o.name}`).join(', ')} éliminé
                              {r.out.length > 1 ? 's' : ''}
                            </span>
                          )}
                        </p>
                        {Object.entries(r.clues).map(([id, text]) => {
                          const p = nameOf(id)
                          return (
                            <div className="clue" key={id}>
                              <span style={{ fontSize: '1.15rem' }}>{p?.avatar ?? '👤'}</span>
                              <div className="grow">
                                <div
                                  className="clue__text"
                                  style={
                                    text === '…'
                                      ? { color: 'var(--text-faint)', fontStyle: 'italic' }
                                      : undefined
                                  }
                                >
                                  {text === '…' ? '… (temps écoulé)' : `« ${text} »`}
                                </div>
                                <div className="clue__author">{p?.name ?? 'Joueur parti'}</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

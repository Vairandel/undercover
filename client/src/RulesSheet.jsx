import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Reference from './Reference.jsx'
import { play } from './audio.js'

/**
 * In-app rulebook.
 *
 * Nobody arriving at a table knows what a Duelliste does, and making the host
 * recite eleven roles out loud is exactly the friction that kills a party game.
 * The text comes from the roles themselves (`rules` on each definition), so it
 * cannot drift away from the code that implements it.
 */
export default function RulesSheet({ info, open, onClose, activeRoles, points, settings }) {
  const [tab, setTab] = useState('roles')

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!info) return null

  const roles = info.roles.filter((r) => r.kind === 'role')
  const modifiers = info.roles.filter((r) => r.kind === 'modifier')

  // When a game is running, highlight what is actually in play tonight.
  const inPlay = activeRoles ? new Set(activeRoles) : null

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet__backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            className="sheet"
            initial={{ opacity: 0, y: 40, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.98 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="sheet__head">
              <div className="segmented">
                {[
                  ['roles', 'Rôles'],
                  ['flow', 'Déroulé'],
                  ['points', 'Points'],
                  ['settings', 'Réglages'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    data-active={String(tab === id)}
                    onClick={() => { play('tap'); setTab(id) }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <button className="btn btn--ghost btn--sm" onClick={() => { play('tap'); onClose() }}>
                Fermer
              </button>
            </header>

            <div className="sheet__body scroll-y">
              {tab === 'roles' && (
                <>
                  <Group
                    title="Rôles"
                    hint="Un seul par joueur."
                    items={roles}
                    inPlay={inPlay}
                  />
                  <Group
                    title="Modificateurs"
                    hint="Se superposent au rôle : un joueur peut être Infiltré ET Amoureux."
                    items={modifiers}
                    inPlay={inPlay}
                  />
                </>
              )}

              {tab === 'flow' && <Flow />}

              {tab === 'points' && <Points info={info} points={points} />}

              {/* Same component as the standalone /regles page — one source, so
                  the two can never describe the game differently. */}
              {tab === 'settings' && <Reference info={info} settings={settings} />}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Group({ title, hint, items, inPlay }) {
  if (items.length === 0) return null
  return (
    <section className="stack" style={{ gap: 10, marginBottom: 22 }}>
      <div>
        <p className="eyebrow">{title}</p>
        <p className="setting__hint" style={{ marginTop: 2 }}>{hint}</p>
      </div>
      {items.map((r) => {
        const active = inPlay?.has(r.id)
        return (
          <div
            key={r.id}
            className="rolecard"
            style={{
              alignItems: 'flex-start',
              borderColor: active ? r.color : undefined,
              background: active ? `${r.color}14` : undefined,
            }}
          >
            <span className="rolecard__emoji">{r.emoji}</span>
            <div className="grow">
              <div className="rolecard__label" style={{ color: r.color }}>
                {r.label}
                {r.slots > 1 && ` ×${r.slots}`}
                {active && (
                  <span className="badge" style={{ marginLeft: 8, fontSize: '0.62rem' }}>
                    en jeu
                  </span>
                )}
                {!r.optional && (
                  <span className="badge" style={{ marginLeft: 8, fontSize: '0.62rem' }}>
                    toujours présent
                  </span>
                )}
              </div>
              <p className="sheet__text">{r.rules ?? r.tagline}</p>
              {r.optional && (
                <p className="rolecard__tag" style={{ marginTop: 6 }}>
                  À partir de {r.minPlayers} joueurs
                </p>
              )}
            </div>
          </div>
        )
      })}
    </section>
  )
}

const STEPS = [
  ['🃏', 'Distribution', 'Chaque joueur découvre sa carte en maintenant le doigt appuyé. Elle n\'est lisible que tant que tu appuies.'],
  ['💬', 'Description', 'Chacun à son tour donne un seul mot qui décrit le sien. Interdit : ton propre mot, l\'autre mot en jeu, ou un indice déjà donné.'],
  ['🗣️', 'Discussion', 'Débat libre. Le vote s\'ouvre à la fin du chrono, quand tout le monde a demandé à passer, ou d\'un clic sur l\'écran principal.'],
  ['🗳️', 'Vote', 'Chacun désigne un suspect. Le plus voté est éliminé et son rôle est révélé.'],
  ['⚖️', 'Égalité', 'Personne ne part… sauf si le Justicier est en jeu : c\'est lui qui tranche, en secret.'],
  ['🏁', 'Fin', 'Les civils gagnent en éliminant tous les imposteurs. Les infiltrés gagnent à la parité, ou dès qu\'il ne reste qu\'un civil.'],
]

function Flow() {
  return (
    <section className="stack" style={{ gap: 10 }}>
      <p className="eyebrow">Déroulé d'une manche</p>
      {STEPS.map(([emoji, title, text], i) => (
        <div className="rolecard" key={title} style={{ alignItems: 'flex-start' }}>
          <span className="rolecard__emoji">{emoji}</span>
          <div className="grow">
            <div className="rolecard__label">
              <span className="faint mono" style={{ marginRight: 8 }}>{i + 1}</span>
              {title}
            </div>
            <p className="sheet__text">{text}</p>
          </div>
        </div>
      ))}
    </section>
  )
}

/**
 * Reads the scale actually in force, falling back to the defaults when opened
 * outside a game (the join screen, before any room exists). Never prints a
 * hardcoded number — the host can retune everything.
 */
function Points({ info, points }) {
  const fields = info.scoring?.fields ?? []
  const defaults = info.scoring?.defaults ?? {}
  const value = (key) => points?.[key] ?? defaults[key] ?? 0
  const tweaked = fields.some((f) => value(f.key) !== defaults[f.key])

  const groups = [
    ['teams', 'Victoire de ton camp'],
    ['bonus', 'Bonus et objectifs annexes'],
  ]

  return (
    <section className="stack" style={{ gap: 16 }}>
      {tweaked && (
        <p className="badge" style={{ alignSelf: 'flex-start', color: 'var(--gold)' }}>
          ⚙️ Barème personnalisé
        </p>
      )}

      {groups.map(([group, title]) => (
        <div className="stack" style={{ gap: 8 }} key={group}>
          <p className="eyebrow">{title}</p>
          {fields
            .filter((f) => f.group === group)
            .map((f) => {
              const pts = value(f.key)
              return (
                <div className="clue" key={f.key} style={pts === 0 ? { opacity: 0.45 } : undefined}>
                  <span style={{ fontSize: '1.2rem' }}>{f.emoji}</span>
                  <div className="grow">
                    <div className="clue__text" style={{ fontSize: '0.95rem' }}>{f.label}</div>
                    {f.hint && <div className="clue__author">{f.hint}</div>}
                  </div>
                  <span className="scorerow__gain">
                    {pts === 0 ? 'désactivé' : `+${pts}`}
                  </span>
                </div>
              )
            })}
        </div>
      ))}

      <p className="setting__hint">
        Les objectifs annexes paient même si ton camp perd. En cas de victoire partagée, chaque
        camp est payé à son propre tarif. Les points se cumulent tant que la salle reste ouverte.
      </p>
    </section>
  )
}

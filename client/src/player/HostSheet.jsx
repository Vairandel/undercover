import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ConfirmButton, PlayerChip } from '../components.jsx'
import { SETTINGS_TABS } from '../settings.jsx'
import { play } from '../audio.js'

/**
 * The whole control panel, on the crowned player's phone.
 *
 * Settings used to live only on the shared screen, on the grounds that they are
 * fiddly on a phone and expensive to get wrong. That held while a screen was
 * always there; now that a game can start from a phone alone, it would leave
 * such a table stuck with the defaults — unable even to choose its themes.
 *
 * Nothing new is granted: the server already accepts every one of these actions
 * from the crown holder. Only the interface was missing.
 *
 * The panels themselves are shared with the big screen rather than copied, so
 * the two can never drift apart.
 */
export default function HostSheet({ state, info, act }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('themes')

  if (!info) return null
  const Panel = SETTINGS_TABS.find((t) => t.id === tab)?.Panel

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost btn--block btn--sm"
        onClick={() => { play('tap'); setOpen(true) }}
      >
        ⚙️  Régler la partie
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
                <div className="segmented grow" style={{ overflowX: 'auto' }}>
                  {SETTINGS_TABS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-active={tab === t.id}
                      onClick={() => { play('tap'); setTab(t.id) }}
                    >
                      {t.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    data-active={tab === 'players'}
                    onClick={() => { play('tap'); setTab('players') }}
                  >
                    👥 Joueurs
                  </button>
                </div>
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>

              <div className="sheet__body scroll-y">
                {tab === 'players' ? (
                  <Players state={state} act={act} />
                ) : (
                  Panel && <Panel state={state} info={info} act={act} />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

/**
 * Removing someone, and handing the crown on.
 *
 * Without a shared screen there is no other way to deal with a duplicate join,
 * a pseudo nobody wants, or someone who has simply walked off — so a table
 * playing on phones alone needs these as much as it needs the settings.
 */
function Players({ state, act }) {
  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="setting__hint">
        Tu tiens la télécommande. Tu peux la passer à quelqu'un d'autre, ou retirer
        un joueur du salon.
      </p>
      <div className="players">
        {state.players.map((p) => (
          <div key={p.id} style={{ position: 'relative' }}>
            <PlayerChip player={p} />
            <ConfirmButton
              className="btn btn--ghost btn--sm kick"
              label="✕"
              confirmLabel="Virer ?"
              onConfirm={() => act('host:kick', { playerId: p.id })}
            />
            {!p.isHost && (
              <button
                type="button"
                className="btn btn--ghost btn--sm crown-btn"
                title={`Donner la télécommande à ${p.name}`}
                onClick={() => { play('tap'); act('host:setHost', { playerId: p.id }) }}
              >
                👑
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

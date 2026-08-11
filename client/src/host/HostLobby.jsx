import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import { ConfirmButton, InviteButton, PlayerChip, ScoreBoard } from '../components.jsx'
import { SETTINGS_TABS } from '../settings.jsx'
import { play } from '../audio.js'

export default function HostLobby({ state, info, joinUrl, act, control = true }) {
  const [qr, setQr] = useState(null)
  const [tab, setTab] = useState(null) // 'settings' | 'roles' | 'themes' | 'scores'

  useEffect(() => {
    // No `url` parameter any more: the server builds the code from the address
    // this very request arrived on, so it always matches what players will use.
    fetch('/api/qr')
      .then((r) => r.text())
      .then(setQr)
      .catch(() => setQr(null))
  }, [joinUrl])

  const { players, settings, composition, standings, gameNumber } = state
  // A private-range address means everyone is on the same wifi; anything else
  // (a tunnel, a host) means they are coming from outside.
  const isLanAddress = /^https?:\/\/(\d+\.\d+\.\d+\.\d+|localhost)/i.test(joinUrl)
  const count = players.length
  const canStart = count >= info.limits.min

  const selectedThemes = settings.themeIds ?? []
  const comp = composition?.comp ?? {}
  const mods = composition?.modifiers ?? []
  const droppedDetail = composition?.droppedDetail ?? []

  const compLabel = [
    ...Object.entries(comp)
      .filter(([, n]) => n > 0)
      .map(([id, n]) => {
        const role = info.roles.find((r) => r.id === id)
        return `${n} ${role?.label ?? id}${n > 1 && id !== 'mrwhite' ? 's' : ''}`
      }),
    ...mods.map((id) => {
      const m = info.roles.find((r) => r.id === id)
      return `${m?.emoji ?? ''} ${m?.label ?? id}`
    }),
  ].join(' · ')

  const Tab = ({ id, children }) => (
    <button
      className="btn btn--ghost btn--sm"
      data-active={String(tab === id)}
      onClick={() => { play('tap'); setTab(tab === id ? null : id) }}
      style={tab === id ? { borderColor: 'var(--accent)', background: 'rgba(124,92,255,0.16)' } : undefined}
    >
      {children}
    </button>
  )

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 1fr) auto',
          gap: 'clamp(20px, 4vmin, 56px)',
          alignItems: 'center',
        }}
      >
        <div className="stack">
          <p className="eyebrow">Rejoins la partie</p>
          <div className="joincode mono">{state.code}</div>
          <p className="subtitle" style={{ fontSize: 'clamp(0.95rem, 1.8vmin, 1.3rem)' }}>
            {/* Telling remote players to "join the wifi" would just confuse
                them, so the instruction follows the kind of address in use. */}
            {isLanAddress ? 'Connecte-toi au wifi, puis ouvre ' : 'Ouvre '}
            <strong>{joinUrl.replace(/^https?:\/\//, '')}</strong> et entre ce code.
          </p>
          {/* For the friend who is not in the room to scan anything. */}
          <div style={{ maxWidth: 280 }}>
            <InviteButton code={state.code} />
          </div>
        </div>

        {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} aria-label="QR code" />}
      </div>

      <div className="stack">
        <div className="spread">
          <p className="eyebrow">
            {count} joueur{count > 1 ? 's' : ''}
            {count >= info.limits.min && compLabel && ` · ${compLabel}`}
          </p>
          <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {SETTINGS_TABS.map((t) => (
              <Tab id={t.id} key={t.id}>
                {t.id === 'themes' ? `🎲 Thèmes (${selectedThemes.length || 'tous'})` : t.label}
              </Tab>
            ))}
            {gameNumber > 0 && <Tab id="scores">🏆 Scores</Tab>}
          </div>
        </div>

        {count === 0 ? (
          <div className="card center">
            <p className="subtitle pulse">En attente des premiers joueurs…</p>
          </div>
        ) : (
          <div className="host__grid">
            <AnimatePresence>
              {players.map((p) => (
                <div key={p.id} style={{ position: 'relative' }}>
                  <PlayerChip player={p} />
                  {/* Hidden on a screen that only displays: the server would
                      refuse these anyway, and offering a button that cannot
                      work is worse than not offering it. */}
                  {control && (
                    <>
                      {/* For the friend who joined twice, or the pseudo nobody
                          wants on the screen. */}
                      <ConfirmButton
                        className="btn btn--ghost btn--sm kick"
                        label="✕"
                        confirmLabel="Virer ?"
                        onConfirm={() => act('host:kick', { playerId: p.id })}
                      />
                      {/* Hands the phone remote to someone else — useful when
                          the person at this screen is not running the evening. */}
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
                    </>
                  )}
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* The four panels are shared with the crowned player's phone rather than
          duplicated — two copies would drift the first time an option is added,
          and options get added often. */}
      {SETTINGS_TABS.filter((t) => t.id === tab).map(({ id, Panel }) => (
        <Panel key={id} state={state} info={info} act={act} tools />
      ))}

      {tab === 'scores' && (
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <div>
              <div className="setting__label">Classement</div>
              <div className="setting__hint">
                {gameNumber} partie{gameNumber > 1 ? 's' : ''} jouée{gameNumber > 1 ? 's' : ''} dans ce salon
              </div>
            </div>
            {control && (
              <ConfirmButton
                className="btn btn--ghost btn--sm"
                label="Remettre à zéro"
                confirmLabel="Confirmer ?"
                onConfirm={() => act('host:resetScores')}
              />
            )}
          </div>
          <div className="scoreboard">
            {standings.map((s, i) => (
              <div
                key={s.id}
                className={`scorerow${i === 0 ? ' scorerow--leader' : ''}`}
                style={{ '--chip': s.color }}
              >
                <span className="scorerow__rank mono">{i + 1}</span>
                <span className="scorerow__avatar">{s.avatar}</span>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="scorerow__name">{s.name}</div>
                  <div className="scorerow__detail">
                    {s.wins} victoire{s.wins > 1 ? 's' : ''}
                  </div>
                </div>
                <span className="scorerow__total mono">{s.score}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {control ? (
        <button
          className="btn btn--primary btn--block"
          disabled={!canStart}
          onClick={() => act('host:start')}
          style={{ fontSize: '1.1rem', minHeight: 60 }}
        >
          {canStart ? '▶  Lancer la partie' : `Il faut ${info.limits.min} joueurs minimum`}
        </button>
      ) : (
        <p className="subtitle center">
          👑 La partie se lance depuis le téléphone qui l'a créée.
        </p>
      )}
    </>
  )
}

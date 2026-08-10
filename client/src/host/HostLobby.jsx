import { useEffect, useState } from 'react'
import { AnimatePresence } from 'framer-motion'
import {
  ConfirmButton,
  NumberSlider,
  PlayerChip,
  ScoreBoard,
  Segmented,
  Setting,
  Switch,
} from '../components.jsx'
import { play } from '../audio.js'

const DROP_REASON = {
  table: 'pas assez de joueurs',
  budget: 'budget de rôles atteint',
  seats: 'plus de place à cette table',
}

export default function HostLobby({ state, info, joinUrl, act }) {
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

  const set = (patch) => act('host:settings', { settings: patch })
  const setRole = (id, on) => act('host:settings', { settings: { roles: { [id]: on } } })
  const setPoint = (key, value) => act('host:settings', { settings: { points: { [key]: value } } })

  const optionalTraits = info.roles.filter((r) => r.optional)
  const selectedThemes = settings.themeIds ?? []

  const toggleTheme = (id) => {
    play('tap')
    const next = selectedThemes.includes(id)
      ? selectedThemes.filter((x) => x !== id)
      : [...selectedThemes, id]
    set({ themeIds: next })
  }

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

  // Freshness across the whole selection, so the host sees at a glance how much
  // unplayed material the chosen themes still hold.
  const pool = selectedThemes.length
    ? info.themes.filter((t) => selectedThemes.includes(t.id))
    : info.themes
  const remaining = pool.reduce((n, t) => n + t.remaining, 0)
  const poolTotal = pool.reduce((n, t) => n + t.total, 0)

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
            <Tab id="themes">🎲 Thèmes ({selectedThemes.length || 'tous'})</Tab>
            <Tab id="roles">🎭 Rôles</Tab>
            <Tab id="points">💯 Barème</Tab>
            <Tab id="settings">⚙️ Réglages</Tab>
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
                  {/* Host-only eject, for the friend who joined twice or the
                      pseudo nobody wants on the screen. */}
                  <ConfirmButton
                    className="btn btn--ghost btn--sm kick"
                    label="✕"
                    confirmLabel="Virer ?"
                    onConfirm={() => act('host:kick', { playerId: p.id })}
                  />
                  {/* Hands the phone remote to someone else — useful when the
                      person at this screen is not the one running the evening. */}
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
            </AnimatePresence>
          </div>
        )}
      </div>

      {tab === 'themes' && (
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <div>
              <div className="setting__label">
                {selectedThemes.length === 0
                  ? 'Tous les thèmes'
                  : `${selectedThemes.length} thème${selectedThemes.length > 1 ? 's' : ''} sélectionné${selectedThemes.length > 1 ? 's' : ''}`}
              </div>
              <div className="setting__hint">
                {remaining} paires jamais jouées sur {poolTotal}. Le tirage privilégie les thèmes
                les plus frais.
              </div>
            </div>
            {selectedThemes.length > 0 && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => { play('tap'); set({ themeIds: [] }) }}
              >
                Tout désélectionner
              </button>
            )}
          </div>

          <div className="themepick">
            {info.themes.map((t) => {
              const on = selectedThemes.includes(t.id)
              return (
                <button key={t.id} data-active={String(on)} onClick={() => toggleTheme(t.id)}>
                  <div className="spread" style={{ gap: 8 }}>
                    <div className="themepick__label">{t.emoji} {t.label}</div>
                    <span className="themepick__check">✓</span>
                  </div>
                  <div className="themepick__meta">{t.remaining}/{t.total} inédites</div>
                </button>
              )
            })}
          </div>

          <hr className="divider" />
          <a className="btn btn--ghost btn--block btn--sm" href="/words">
            ✏️ Modifier la banque de mots
          </a>
          <a className="btn btn--ghost btn--block btn--sm" href="/simulate" style={{ marginTop: 8 }}>
            🔬 Banc d'essai du barème
          </a>
        </div>
      )}

      {tab === 'roles' && (
        <div className="card">
          <Setting
            label="Budget de rôles"
            hint={`À ${count || '—'} joueurs, ${composition?.budget ?? 0} rôles spéciaux maximum. Les rôles activés au-delà sont mis de côté, dans l'ordre d'affichage.`}
          >
            <span className="badge">
              {Math.min(composition?.enabledCount ?? 0, composition?.budget ?? 0)} / {composition?.budget ?? 0}
            </span>
          </Setting>

          <div className="stack" style={{ gap: 8, marginTop: 10 }}>
            {optionalTraits.map((r) => {
              const drop = droppedDetail.find((d) => d.id === r.id)
              const on = Boolean(settings.roles?.[r.id])
              const tooSmall = count > 0 && count < r.minPlayers
              return (
                <div className="rolecard" key={r.id} style={tooSmall ? { opacity: 0.45 } : undefined}>
                  <span className="rolecard__emoji">{r.emoji}</span>
                  <div className="grow">
                    <div className="rolecard__label" style={{ color: r.color }}>
                      {r.label}
                      {r.slots > 1 && ` ×${r.slots}`}
                      {r.kind === 'modifier' && (
                        <span className="badge" style={{ marginLeft: 8, fontSize: '0.62rem' }}>
                          garde son rôle
                        </span>
                      )}
                    </div>
                    <div className="rolecard__tag">
                      {r.tagline}
                      {on && drop && ` · écarté : ${DROP_REASON[drop.reason]}`}
                      {!on && tooSmall && ` · ${r.minPlayers} joueurs minimum`}
                    </div>
                  </div>
                  <Switch checked={on} disabled={tooSmall} onChange={(v) => setRole(r.id, v)} />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {tab === 'points' && (
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <div>
              <div className="setting__label">Barème de la partie</div>
              <div className="setting__hint">
                Ajuste chaque valeur au curseur ou tape le nombre exact. Mettre 0 désactive
                complètement une récompense.
              </div>
            </div>
            <ConfirmButton
              className="btn btn--ghost btn--sm"
              label="Valeurs par défaut"
              confirmLabel="Restaurer ?"
              onConfirm={() => act('host:settings', { settings: { points: info.scoring.defaults } })}
            />
          </div>

          {[
            ['teams', 'Victoire de camp'],
            ['bonus', 'Bonus et objectifs annexes'],
          ].map(([group, title]) => (
            <div key={group} style={{ marginBottom: 10 }}>
              <p className="eyebrow" style={{ marginBottom: 6 }}>{title}</p>
              {info.scoring.fields
                .filter((f) => f.group === group)
                .map((f) => {
                  // A knob whose role — or whose option — is switched off still
                  // works, but it is greyed so the host knows it will not come
                  // up tonight.
                  const idle =
                    (f.role && !settings.roles?.[f.role]) ||
                    (f.setting && !settings[f.setting])
                  return (
                    <Setting
                      key={f.key}
                      dimmed={idle}
                      label={`${f.emoji} ${f.label}`}
                      hint={
                        idle
                          ? `${f.hint ? f.hint + ' · ' : ''}rôle désactivé pour cette partie`
                          : f.hint
                      }
                    >
                      <NumberSlider
                        value={settings.points?.[f.key] ?? info.scoring.defaults[f.key]}
                        min={f.min}
                        max={f.max}
                        onCommit={(v) => setPoint(f.key, v)}
                      />
                    </Setting>
                  )
                })}
            </div>
          ))}
        </div>
      )}

      {tab === 'settings' && (
        <div className="card">
          <Setting label="Infiltrés" hint="« Auto » suit la taille de la table.">
            <Segmented
              value={settings.undercoverCount}
              onChange={(v) => set({ undercoverCount: v })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 1, label: '1' },
                { value: 2, label: '2' },
                { value: 3, label: '3' },
              ]}
            />
          </Setting>

          <Setting
            label="Les infiltrés savent qu'ils le sont"
            hint="Désactivé : ils reçoivent une carte de civil et doivent comprendre seuls qu'ils ont le mauvais mot. Beaucoup plus tendu."
          >
            <Switch
              checked={settings.undercoverKnowsRole}
              onChange={(v) => set({ undercoverKnowsRole: v })}
            />
          </Setting>

          <Setting
            label="Indices écrits"
            hint="Chaque joueur tape son indice ; il s'affiche ici pour tout le monde."
          >
            <Switch checked={settings.writtenClues} onChange={(v) => set({ writtenClues: v })} />
          </Setting>

          <Setting label="Chrono par tour" hint="Temps écoulé sans indice : « … » s'affiche.">
            <Segmented
              value={settings.turnTimer}
              onChange={(v) => set({ turnTimer: v })}
              options={[
                { value: 0, label: 'Off' },
                { value: 20, label: '20s' },
                { value: 40, label: '40s' },
                { value: 60, label: '60s' },
              ]}
            />
          </Setting>

          <Setting
            label="Temps de discussion"
            hint="Débat libre entre les indices et le vote. C'est là que la partie se joue vraiment."
          >
            <Segmented
              value={settings.discussTime}
              onChange={(v) => set({ discussTime: v })}
              options={[
                { value: 0, label: 'Off' },
                { value: 30, label: '30s' },
                { value: 60, label: '1min' },
                { value: 120, label: '2min' },
              ]}
            />
          </Setting>

          <hr className="divider" />

          <Setting
            label="Réactions sur les indices"
            hint="Chacun colle un emoji sous l'indice des autres — 🤨 👍 😂 👀 💀 ⭐. Signées, jamais anonymes : on peut te demander pourquoi tu as ri."
          >
            <Switch checked={settings.reactions} onChange={(v) => set({ reactions: v })} />
          </Setting>

          <Setting
            label="Palmarès de fin de manche"
            hint="Titres décernés d'après ce qui s'est réellement passé : le caméléon, le paratonnerre, la boussole cassée… Aucun point en jeu."
          >
            <Switch checked={settings.endTitles} onChange={(v) => set({ endTitles: v })} />
          </Setting>

          <Setting
            label="Récompense et punition"
            hint="Chaque bulletin de civil est payé : autant de points gagnés s'il vise un imposteur, autant de perdus sinon. Les imposteurs ne sont jamais concernés — voter faux est leur métier. De quoi récompenser les bons enquêteurs et calmer les suiveurs."
          >
            <Switch checked={settings.detectiveMode} onChange={(v) => set({ detectiveMode: v })} />
          </Setting>

          {/* Only meaningful under reward-and-punishment: nothing else in the
              game can score negative, so there is nothing to clamp. */}
          {settings.detectiveMode && (
            <Setting
              label="Limite basse des scores"
              hint={
                info.scoreFloors?.find((f) => f.id === settings.scoreFloor)?.hint ??
                'Jusqu\'où une mauvaise manche peut faire descendre.'
              }
            >
              <Segmented
                value={settings.scoreFloor}
                onChange={(v) => set({ scoreFloor: v })}
                options={(info.scoreFloors ?? []).map((f) => ({ value: f.id, label: f.label }))}
              />
            </Setting>
          )}

          <Setting
            label="Vote blanc"
            hint="Permet de refuser d'accuser. Ne compte pour personne, ne rapporte ni ne coûte rien — surtout utile quand les bulletins sont payés."
          >
            <Switch checked={settings.blankVote} onChange={(v) => set({ blankVote: v })} />
          </Setting>

          <Setting
            label="Dernier soupçon"
            hint="Un civil éliminé a quelques secondes, sur son seul téléphone, pour nommer tous les imposteurs restants. Réponse secrète jusqu'au bilan ; la table n'attend pas."
          >
            <Switch checked={settings.dyingGuess} onChange={(v) => set({ dyingGuess: v })} />
          </Setting>

          {settings.dyingGuess && (
            <Setting label="Temps de réflexion" hint="Le compte à rebours tourne sur son téléphone pendant que la manche continue.">
              <Segmented
                value={settings.dyingGuessTime}
                onChange={(v) => set({ dyingGuessTime: v })}
                options={[
                  { value: 10, label: '10s' },
                  { value: 20, label: '20s' },
                  { value: 30, label: '30s' },
                  { value: 45, label: '45s' },
                ]}
              />
            </Setting>
          )}
        </div>
      )}

      {tab === 'scores' && (
        <div className="card">
          <div className="spread" style={{ marginBottom: 12 }}>
            <div>
              <div className="setting__label">Classement</div>
              <div className="setting__hint">
                {gameNumber} partie{gameNumber > 1 ? 's' : ''} jouée{gameNumber > 1 ? 's' : ''} dans ce salon
              </div>
            </div>
            <ConfirmButton
              className="btn btn--ghost btn--sm"
              label="Remettre à zéro"
              confirmLabel="Confirmer ?"
              onConfirm={() => act('host:resetScores')}
            />
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

      <button
        className="btn btn--primary btn--block"
        disabled={!canStart}
        onClick={() => act('host:start')}
        style={{ fontSize: '1.1rem', minHeight: 60 }}
      >
        {canStart ? '▶  Lancer la partie' : `Il faut ${info.limits.min} joueurs minimum`}
      </button>
    </>
  )
}

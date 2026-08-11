import {
  ConfirmButton,
  NumberSlider,
  Segmented,
  Setting,
  Switch,
} from './components.jsx'
import { play } from './audio.js'

/**
 * The four settings panels, shared by the big screen and the crowned player's
 * phone.
 *
 * Extracted rather than duplicated: a second copy would drift the first time an
 * option is added, and we add options often. Both callers pass the same three
 * things — the public state, the static catalogue from `/api/info`, and `act` —
 * so a panel never needs to know which screen it is on.
 *
 * The server accepts every one of these from the crown holder as well as from
 * the shared screen (`requireController`), so nothing here needs a permission
 * check of its own.
 */

const DROP_REASON = {
  table: 'pas assez de joueurs',
  budget: 'budget de rôles atteint',
  seats: 'plus de place à cette table',
}

/** Themes to draw from, and how much unplayed material they still hold. */
export function ThemesPanel({ state, info, act, tools = false }) {
  const selected = state.settings.themeIds ?? []
  const set = (patch) => act('host:settings', { settings: patch })

  const toggle = (id) => {
    play('tap')
    set({
      themeIds: selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id],
    })
  }

  const pool = selected.length ? info.themes.filter((t) => selected.includes(t.id)) : info.themes
  const remaining = pool.reduce((n, t) => n + t.remaining, 0)
  const poolTotal = pool.reduce((n, t) => n + t.total, 0)

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <div className="setting__label">
            {selected.length === 0
              ? 'Tous les thèmes'
              : `${selected.length} thème${selected.length > 1 ? 's' : ''} sélectionné${selected.length > 1 ? 's' : ''}`}
          </div>
          <div className="setting__hint">
            {remaining} paires jamais jouées sur {poolTotal}. Le tirage privilégie les thèmes
            les plus frais.
          </div>
        </div>
        {selected.length > 0 && (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => { play('tap'); set({ themeIds: [] }) }}
          >
            Tout désélectionner
          </button>
        )}
      </div>

      <div className="themepick">
        {info.themes.map((t) => (
          <button key={t.id} data-active={String(selected.includes(t.id))} onClick={() => toggle(t.id)}>
            <div className="spread" style={{ gap: 8 }}>
              <div className="themepick__label">{t.emoji} {t.label}</div>
              <span className="themepick__check">✓</span>
            </div>
            <div className="themepick__meta">{t.remaining}/{t.total} inédites</div>
          </button>
        ))}
      </div>

      {/* Editing the bank and tuning the scale are desk work, not phone work —
          offered only where there is a keyboard. */}
      {tools && (
        <>
          <hr className="divider" />
          <a className="btn btn--ghost btn--block btn--sm" href="/words">
            ✏️ Modifier la banque de mots
          </a>
          <a className="btn btn--ghost btn--block btn--sm" href="/simulate" style={{ marginTop: 8 }}>
            🔬 Banc d'essai du barème
          </a>
        </>
      )}
    </div>
  )
}

/** Which optional roles and modifiers are in play. */
export function RolesPanel({ state, info, act }) {
  const { players, settings, composition } = state
  const count = players.length
  const dropped = composition?.droppedDetail ?? []
  const setRole = (id, on) => act('host:settings', { settings: { roles: { [id]: on } } })

  return (
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
        {info.roles.filter((r) => r.optional).map((r) => {
          const drop = dropped.find((d) => d.id === r.id)
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
  )
}

/** What each victory and side objective is worth. */
export function PointsPanel({ state, info, act }) {
  const { settings } = state
  const setPoint = (key, value) => act('host:settings', { settings: { points: { [key]: value } } })

  return (
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
          label="Défauts"
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
          {info.scoring.fields.filter((f) => f.group === group).map((f) => {
            // A knob whose role — or whose option — is switched off still works,
            // but it is greyed so the host knows it will not come up tonight.
            const idle = (f.role && !settings.roles?.[f.role]) || (f.setting && !settings[f.setting])
            return (
              <Setting
                key={f.key}
                dimmed={idle}
                label={`${f.emoji} ${f.label}`}
                hint={idle ? `${f.hint ? f.hint + ' · ' : ''}rôle désactivé pour cette partie` : f.hint}
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
  )
}

/** How the round itself is played. */
export function RulesPanel({ state, info, act }) {
  const { settings } = state
  const set = (patch) => act('host:settings', { settings: patch })

  return (
    <div className="card">
      <Setting label="Infiltrés" hint="« Auto » suit la taille de la table.">
        <Segmented
          value={settings.undercoverCount}
          onChange={(v) => set({ undercoverCount: v })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
          ]}
        />
      </Setting>

      <Setting
        label="Les infiltrés savent qu'ils le sont"
        hint="Désactivé : ils reçoivent une carte de civil et doivent comprendre seuls qu'ils ont le mauvais mot. Beaucoup plus tendu."
      >
        <Switch checked={settings.undercoverKnowsRole} onChange={(v) => set({ undercoverKnowsRole: v })} />
      </Setting>

      <Setting label="Indices écrits" hint="Chaque joueur tape son indice ; il s'affiche pour tout le monde.">
        <Switch checked={settings.writtenClues} onChange={(v) => set({ writtenClues: v })} />
      </Setting>

      <Setting label="Chrono par tour" hint="Temps écoulé sans indice : « … » s'affiche.">
        <Segmented
          value={settings.turnTimer}
          onChange={(v) => set({ turnTimer: v })}
          options={[
            { value: 0, label: 'Off' }, { value: 20, label: '20s' },
            { value: 40, label: '40s' }, { value: 60, label: '60s' },
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
            { value: 0, label: 'Off' }, { value: 30, label: '30s' },
            { value: 60, label: '1min' }, { value: 120, label: '2min' },
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
        hint="Chaque bulletin de civil est payé : autant de points gagnés s'il vise un imposteur, autant de perdus sinon. Les imposteurs ne sont jamais concernés — voter faux est leur métier."
      >
        <Switch checked={settings.detectiveMode} onChange={(v) => set({ detectiveMode: v })} />
      </Setting>

      {/* Only meaningful under reward-and-punishment: nothing else in the game
          can score negative, so there is nothing to clamp. */}
      {settings.detectiveMode && (
        <Setting
          label="Limite basse des scores"
          hint={
            info.scoreFloors?.find((f) => f.id === settings.scoreFloor)?.hint ??
            "Jusqu'où une mauvaise manche peut faire descendre."
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
              { value: 10, label: '10s' }, { value: 20, label: '20s' },
              { value: 30, label: '30s' }, { value: 45, label: '45s' },
            ]}
          />
        </Setting>
      )}
    </div>
  )
}

/** The tab bar shared by both screens, so the labels never diverge. */
export const SETTINGS_TABS = [
  { id: 'themes', label: '🎲 Thèmes', Panel: ThemesPanel },
  { id: 'roles', label: '🎭 Rôles', Panel: RolesPanel },
  { id: 'points', label: '💯 Barème', Panel: PointsPanel },
  { id: 'settings', label: '⚙️ Réglages', Panel: RulesPanel },
]

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

/**
 * How the round itself is played.
 *
 * Labels and hints come from `info.settingFields`, not from here — the same
 * descriptors the rulebook reads. Only the *controls* live in this file,
 * because each one is specific: a switch, a set of durations, a three-way
 * choice. A generic renderer driven by data would be more code and less clear
 * than thirteen explicit lines.
 */
export function RulesPanel({ state, info, act }) {
  const { settings } = state
  const set = (patch) => act('host:settings', { settings: patch })

  const fields = Object.fromEntries((info.settingFields ?? []).map((f) => [f.key, f]))
  /** Wraps a control in its described `Setting`, or omits it if undescribed. */
  const Field = ({ id, children, hint }) => {
    const f = fields[id]
    if (!f) return null
    return <Setting label={`${f.emoji} ${f.label}`} hint={hint ?? f.hint}>{children}</Setting>
  }

  return (
    <div className="card">
      <Field id="undercoverCount">
        <Segmented
          value={settings.undercoverCount}
          onChange={(v) => set({ undercoverCount: v })}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
          ]}
        />
      </Field>

      <Field id="undercoverKnowsRole">
        <Switch checked={settings.undercoverKnowsRole} onChange={(v) => set({ undercoverKnowsRole: v })} />
      </Field>

      <Field id="writtenClues">
        <Switch checked={settings.writtenClues} onChange={(v) => set({ writtenClues: v })} />
      </Field>

      <Field id="turnTimer">
        <Segmented
          value={settings.turnTimer}
          onChange={(v) => set({ turnTimer: v })}
          options={[
            { value: 0, label: 'Off' }, { value: 20, label: '20s' },
            { value: 40, label: '40s' }, { value: 60, label: '60s' },
          ]}
        />
      </Field>

      <Field id="discussTime">
        <Segmented
          value={settings.discussTime}
          onChange={(v) => set({ discussTime: v })}
          options={[
            { value: 0, label: 'Off' }, { value: 30, label: '30s' },
            { value: 60, label: '1min' }, { value: 120, label: '2min' },
          ]}
        />
      </Field>

      <hr className="divider" />

      <Field id="reactions">
        <Switch checked={settings.reactions} onChange={(v) => set({ reactions: v })} />
      </Field>

      <Field id="endTitles">
        <Switch checked={settings.endTitles} onChange={(v) => set({ endTitles: v })} />
      </Field>

      <Field id="detectiveMode">
        <Switch checked={settings.detectiveMode} onChange={(v) => set({ detectiveMode: v })} />
      </Field>

      {/* Only meaningful under reward-and-punishment: nothing else in the game
          can score negative, so there is nothing to clamp. The hint follows the
          chosen mode rather than describing all three at once. */}
      {settings.detectiveMode && (
        <Field
          id="scoreFloor"
          hint={info.scoreFloors?.find((f) => f.id === settings.scoreFloor)?.hint}
        >
          <Segmented
            value={settings.scoreFloor}
            onChange={(v) => set({ scoreFloor: v })}
            options={(info.scoreFloors ?? []).map((f) => ({ value: f.id, label: f.label }))}
          />
        </Field>
      )}

      <Field id="blankVote">
        <Switch checked={settings.blankVote} onChange={(v) => set({ blankVote: v })} />
      </Field>

      <Field id="dyingGuess">
        <Switch checked={settings.dyingGuess} onChange={(v) => set({ dyingGuess: v })} />
      </Field>

      {settings.dyingGuess && (
        <Field id="dyingGuessTime">
          <Segmented
            value={settings.dyingGuessTime}
            onChange={(v) => set({ dyingGuessTime: v })}
            options={[
              { value: 10, label: '10s' }, { value: 20, label: '20s' },
              { value: 30, label: '30s' }, { value: 45, label: '45s' },
            ]}
          />
        </Field>
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

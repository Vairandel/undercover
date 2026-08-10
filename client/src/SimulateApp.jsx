import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { NumberSlider, Setting, Switch, Segmented, Toast } from './components.jsx'
import { play } from './audio.js'

/**
 * Balance workbench.
 *
 * The point scale is the one thing playtesting answers slowly: you need dozens
 * of games before you can tell whether five points for Mister White is generous
 * or stingy, and by then the evening is over. This runs thousands against the
 * real engine and shows what each camp actually walks away with.
 *
 * Everything happens in a child process on a throwaway data directory, so a
 * hundred thousand simulated rounds never touch the household's word history.
 */

const TEAM_LOOK = {
  civilian: { label: 'Civils', color: 'var(--civilian)', emoji: '🧑' },
  undercover: { label: 'Infiltrés', color: 'var(--undercover)', emoji: '🕵️' },
  mrwhite: { label: 'Mister White', color: 'var(--white-role)', emoji: '🃏' },
  lovers: { label: 'Amoureux', color: '#f472b6', emoji: '💘' },
}
const look = (team) => TEAM_LOOK[team] ?? { label: team, color: 'var(--accent)', emoji: '❓' }

const GRADE = {
  good: { label: 'équilibré', color: 'var(--ok)', emoji: '✅' },
  ok: { label: 'acceptable', color: 'var(--gold)', emoji: '🟡' },
  bad: { label: 'déséquilibré', color: 'var(--danger)', emoji: '❌' },
}

const pct = (n) => `${(n * 100).toFixed(1)}%`

/** A labelled slider — `NumberSlider` is the control, `Setting` the surround. */
function Knob({ label, hint, value, min = 0, max = 100, step = 1, onChange }) {
  return (
    <Setting label={label} hint={hint}>
      <NumberSlider value={value} min={min} max={max} step={step} onCommit={onChange} />
    </Setting>
  )
}

/** Same, for a 0–1 rate the engine wants but nobody wants to type as 0.35. */
function RateKnob({ label, hint, value, max = 100, onChange }) {
  return (
    <Knob
      label={label}
      hint={hint}
      value={Math.round(value * 100)}
      min={0}
      max={max}
      onChange={(v) => onChange(v / 100)}
    />
  )
}

export default function SimulateApp() {
  const [info, setInfo] = useState(null)
  const [tab, setTab] = useState('table')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem('undercover.adminToken') ?? '' } catch { return '' }
  })

  const [cfg, setCfg] = useState({
    games: 2000,
    players: 6,
    sessionLength: 5,
    skill: 0.5,
    skillGrowth: 0.08,
    blankRate: 0.1,
    whiteGuessRate: 0.35,
    whiteBlurtRate: 0.03,
    dyingAnswerRate: 0.9,
    seed: 42,
  })
  const [settings, setSettings] = useState(null)
  const [sweepKey, setSweepKey] = useState('')
  const [sweepValues, setSweepValues] = useState('3,4,5,6,7')

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then((data) => {
        setInfo(data)
        setSettings({ ...data.defaults, points: { ...data.scoring.defaults } })
      })
      .catch(() => setError('Serveur injoignable.'))
  }, [])

  const set = (patch) => setCfg((c) => ({ ...c, ...patch }))
  const setGame = (patch) => setSettings((s) => ({ ...s, ...patch }))
  const setPoint = (key, value) =>
    setSettings((s) => ({ ...s, points: { ...s.points, [key]: value } }))

  const run = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    play('tap')
    try {
      const values = sweepValues.split(',').map((v) => Number(v.trim())).filter(Number.isFinite)
      const res = await fetch(`/api/simulate${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...cfg,
          settings,
          sweep: sweepKey && values.length ? { key: sweepKey, values } : null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Échec de la simulation.')
      setResult(json)
      setTab('results')
      play('scoreTop')
    } catch (e) {
      play('error')
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (!info || !settings) {
    return (
      <div className="screen screen--center">
        <p className="subtitle pulse">Chargement…</p>
        <Toast message={error} onDone={() => setError(null)} />
      </div>
    )
  }

  // Civil and Infiltré are always in play; only the optional ones are switches.
  const roleFields = info.roles.filter((r) => r.optional)

  return (
    <div className="screen" style={{ maxWidth: 860, margin: '0 auto', width: '100%' }}>
      <header className="spread">
        <div>
          <h1 className="title">🔬 Banc d'essai</h1>
          <p className="faint" style={{ fontSize: '0.8rem' }}>
            Des milliers de parties contre le vrai moteur, pour régler le barème
          </p>
        </div>
        <a className="btn btn--ghost btn--sm" href="/host">← Retour au jeu</a>
      </header>

      <div className="segmented" style={{ alignSelf: 'stretch' }}>
        {[
          ['table', '🎲 La table'],
          ['rules', '⚙️ Règles'],
          ['points', '💯 Barème'],
          ['results', '📊 Résultats'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className="grow"
            data-active={tab === id}
            disabled={id === 'results' && !result}
            onClick={() => { play('tap'); setTab(id) }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'table' && (
        <div className="card">
          <Knob
            label="Parties à jouer" value={cfg.games} min={100} max={20000} step={100}
            hint="Plus il y en a, moins le hasard pèse. 2000 suffit à départager deux barèmes."
            onChange={(v) => set({ games: v })}
          />
          <Knob
            label="Joueurs à table" value={cfg.players} min={info.limits.min} max={info.limits.max}
            hint="L'équilibre change beaucoup avec la taille de la table — teste celle où tu joues vraiment."
            onChange={(v) => set({ players: v })}
          />
          <Knob
            label="Parties par soirée" value={cfg.sessionLength} min={1} max={20}
            hint="Les scores se cumulent sur une soirée, comme dans une vraie salle. À 1, tu mesures des parties isolées ; au-delà, tu vois si le barème produit des soirées serrées ou un vainqueur qui écrase — et c'est la seule façon de juger la limite basse des scores."
            onChange={(v) => set({ sessionLength: v })}
          />

          <hr className="divider" />

          <RateKnob
            label="Adresse de la table (%)" value={cfg.skill} max={95}
            hint="LE paramètre. La chance qu'un bulletin de civil tombe sur un imposteur. Un robot ne sait pas écrire un indice habile : tout ce que le jeu doit à l'intelligence des joueurs passe par ce seul curseur."
            onChange={(v) => set({ skill: v })}
          />
          <RateKnob
            label="Progression par manche (%)" value={cfg.skillGrowth} max={30}
            hint="De combien la table s'améliore à chaque manche, les indices s'accumulant."
            onChange={(v) => set({ skillGrowth: v })}
          />
          <RateKnob
            label="Mister White devine (%)" value={cfg.whiteGuessRate}
            hint="Sa réussite quand il a sa dernière chance. Attention : ce chiffre décide à lui seul de son taux de victoire."
            onChange={(v) => set({ whiteGuessRate: v })}
          />
          <RateKnob
            label="Il lâche le mot en description (%)" value={cfg.whiteBlurtRate} max={30}
            hint="Le coup de poker : il gagne sur-le-champ, ou son indice part comme un autre."
            onChange={(v) => set({ whiteBlurtRate: v })}
          />
          <RateKnob
            label="Vote blanc (%)" value={cfg.blankRate} max={60}
            hint="Quand l'option est activée : la part des civils qui refusent d'accuser."
            onChange={(v) => set({ blankRate: v })}
          />
          <RateKnob
            label="Réponse au dernier soupçon (%)" value={cfg.dyingAnswerRate}
            hint="La part des éliminés qui prennent la peine de répondre."
            onChange={(v) => set({ dyingAnswerRate: v })}
          />

          <hr className="divider" />

          <Knob
            label="Graine aléatoire" value={cfg.seed} min={0} max={9999}
            hint="Fixe la série : deux barèmes comparés sur la même graine jouent exactement les mêmes parties. Indispensable pour comparer."
            onChange={(v) => set({ seed: v })}
          />
        </div>
      )}

      {tab === 'rules' && (
        <div className="card">
          <Setting label="Infiltrés" hint="« Auto » suit la taille de la table.">
            <Segmented
              value={settings.undercoverCount}
              onChange={(v) => setGame({ undercoverCount: v })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' },
              ]}
            />
          </Setting>

          <Setting label="Récompense et punition" hint="Chaque bulletin de civil est payé, gagné s'il vise un imposteur, perdu sinon.">
            <Switch checked={settings.detectiveMode} onChange={(v) => setGame({ detectiveMode: v })} />
          </Setting>

          {settings.detectiveMode && (
            <Setting
              label="Limite basse des scores"
              hint={info.scoreFloors?.find((f) => f.id === settings.scoreFloor)?.hint}
            >
              <Segmented
                value={settings.scoreFloor}
                onChange={(v) => setGame({ scoreFloor: v })}
                options={(info.scoreFloors ?? []).map((f) => ({ value: f.id, label: f.label }))}
              />
            </Setting>
          )}

          <Setting label="Vote blanc" hint="Refuser d'accuser, sans nommer personne.">
            <Switch checked={settings.blankVote} onChange={(v) => setGame({ blankVote: v })} />
          </Setting>

          <Setting label="Dernier soupçon" hint="Un civil éliminé nomme les imposteurs restants.">
            <Switch checked={settings.dyingGuess} onChange={(v) => setGame({ dyingGuess: v })} />
          </Setting>

          <hr className="divider" />
          <p className="eyebrow" style={{ marginBottom: 8 }}>Rôles et modificateurs</p>

          {roleFields.map((r) => (
            <Setting key={r.id} label={`${r.emoji} ${r.label}`} hint={r.tagline}>
              <Switch
                checked={Boolean(settings.roles?.[r.id])}
                onChange={(v) => setGame({ roles: { ...settings.roles, [r.id]: v } })}
              />
            </Setting>
          ))}
        </div>
      )}

      {tab === 'points' && (
        <div className="card">
          <p className="setting__hint" style={{ marginBottom: 12 }}>
            Le barème testé. Pour comparer plusieurs valeurs d'un même poste d'un seul coup,
            choisis-le dans le balayage en bas.
          </p>

          {info.scoring.fields.map((f) => (
            <Knob
              key={f.key}
              label={`${f.emoji} ${f.label}`}
              hint={f.hint}
              value={settings.points[f.key] ?? 0}
              min={f.min}
              max={f.max}
              onChange={(v) => setPoint(f.key, v)}
            />
          ))}

          <hr className="divider" />

          <Setting
            label="Balayage"
            hint="Rejoue la même série pour chaque valeur, puis désigne la plus équilibrée. Le meilleur moyen de trouver le bon chiffre."
          >
            <select
              className="input"
              style={{ minHeight: 40, width: 'auto' }}
              value={sweepKey}
              onChange={(e) => setSweepKey(e.target.value)}
            >
              <option value="">Aucun</option>
              {info.scoring.fields.map((f) => (
                <option key={f.key} value={f.key}>{f.label}</option>
              ))}
            </select>
          </Setting>

          {sweepKey && (
            <Setting label="Valeurs à essayer" hint="Séparées par des virgules, 8 au maximum.">
              <input
                className="input"
                style={{ width: 160 }}
                value={sweepValues}
                onChange={(e) => setSweepValues(e.target.value)}
              />
            </Setting>
          )}
        </div>
      )}

      {tab === 'results' && result && <Results result={result} />}

      {info.needsToken && (
        <input
          className="input"
          type="password"
          placeholder="Jeton administrateur"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          autoComplete="off"
        />
      )}

      <button className="btn btn--primary btn--block" disabled={busy} onClick={run}>
        {busy ? `Simulation de ${cfg.games.toLocaleString('fr')} parties…` : `▶  Lancer ${cfg.games.toLocaleString('fr')} parties`}
      </button>

      <Toast message={error} onDone={() => setError(null)} />
    </div>
  )
}

const GAP = [
  { max: 4, label: 'soirée serrée', color: 'var(--ok)', emoji: '✅' },
  { max: 8, label: 'écart net', color: 'var(--gold)', emoji: '🟡' },
  { max: Infinity, label: 'soirée écrasée', color: 'var(--danger)', emoji: '❌' },
]

/**
 * How the evenings ended.
 *
 * The row-per-rank shape is the point: it is the shape of the final scoreboard,
 * averaged. A scale that produces runaway leaders shows up as a top row far
 * above the rest — which is something no single-game statistic can reveal.
 */
function Evenings({ ev }) {
  const verdict = GAP.find((g) => ev.avgGap < g.max)
  const top = ev.byRank[0]?.avg || 1

  return (
    <div className="card">
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <div className="setting__label">Scores finaux</div>
          <div className="setting__hint">
            Moyenne par place, sur {ev.sessions.toLocaleString('fr')} soirées
          </div>
        </div>
        <span className="badge" style={{ color: verdict.color, borderColor: verdict.color }}>
          {verdict.emoji} {verdict.label}
        </span>
      </div>

      {ev.byRank.map((r) => (
        <div className="simbar" key={r.rank}>
          <span className="simbar__label">
            {r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `${r.rank}ᵉ`}
            {' '}{r.rank === 1 ? '1ᵉʳ' : `${r.rank}ᵉ`}
          </span>
          <span className="simbar__track">
            <motion.span
              className="simbar__fill"
              style={{ background: r.rank === 1 ? 'var(--gold)' : 'var(--accent)' }}
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(0, (r.avg / top) * 100)}%` }}
              transition={{ duration: 0.5, delay: r.rank * 0.05, ease: [0.22, 1, 0.36, 1] }}
            />
          </span>
          <span className="simbar__value mono">{r.avg.toFixed(1)}</span>
        </div>
      ))}

      <hr className="divider" />

      <div className="simstats">
        <div>
          <span className="simstats__value mono" style={{ color: verdict.color }}>
            {ev.avgGap.toFixed(1)}
          </span>
          <span className="simstats__label">écart 1ᵉʳ / dernier</span>
        </div>
        <div>
          <span className="simstats__value mono">{ev.median}</span>
          <span className="simstats__label">score médian</span>
        </div>
        <div>
          <span className="simstats__value mono">{ev.lowest} – {ev.highest}</span>
          <span className="simstats__label">du pire au meilleur</span>
        </div>
        <div>
          <span className="simstats__value mono">{pct(ev.tieRate)}</span>
          <span className="simstats__label">ex æquo en tête</span>
        </div>
        {ev.negatives > 0 && (
          <div>
            <span className="simstats__value mono" style={{ color: 'var(--danger)' }}>
              {pct(ev.negatives)}
            </span>
            <span className="simstats__label">scores négatifs</span>
          </div>
        )}
      </div>

      <p className="setting__hint" style={{ marginTop: 10 }}>
        L'écart entre le premier et le dernier dit si la soirée reste jouable jusqu'au bout.
        Un barème qui creuse trop décourage ceux qui décrochent tôt.
      </p>
    </div>
  )
}

function Results({ result }) {
  const [shown, setShown] = useState(0)
  const variant = result.variants[shown] ?? result.variants[0]
  const { summary, balance } = variant
  const grade = GRADE[balance.grade]

  return (
    <div className="stack">
      {result.variants.length > 1 && (
        <div className="card card--tight">
          <p className="eyebrow" style={{ marginBottom: 8 }}>
            Balayage de « {result.sweepKey} » — le plus équilibré : {String(result.bestValue)}
          </p>
          <div className="sweep">
            {result.variants.map((v, i) => (
              <button
                key={v.label}
                type="button"
                className={`sweep__cell${i === shown ? ' sweep__cell--on' : ''}${v.value === result.bestValue ? ' sweep__cell--best' : ''}`}
                onClick={() => { play('tap'); setShown(i) }}
              >
                <b>{String(v.value)}</b>
                <span style={{ color: GRADE[v.balance.grade].color }}>
                  {v.balance.spread.toFixed(2)}
                </span>
              </button>
            ))}
          </div>
          <p className="setting__hint" style={{ marginTop: 8 }}>
            L'écart est la différence d'espérance de points entre le camp le mieux payé et le
            moins bien. Plus il est petit, plus le barème est juste.
          </p>
        </div>
      )}

      <div className="card">
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <div className="setting__label">Équilibre</div>
            <div className="setting__hint">
              {summary.games.toLocaleString('fr')} parties · {summary.avgRounds.toFixed(2)} manches en moyenne
            </div>
          </div>
          <span className="badge" style={{ color: grade.color, borderColor: grade.color }}>
            {grade.emoji} {grade.label} · écart {balance.spread.toFixed(2)}
          </span>
        </div>

        <p className="eyebrow" style={{ marginBottom: 8 }}>Victoires par camp</p>
        {Object.entries(summary.winRate).sort((a, b) => b[1] - a[1]).map(([team, rate]) => (
          <div className="simbar" key={team}>
            <span className="simbar__label">{look(team).emoji} {look(team).label}</span>
            <span className="simbar__track">
              <motion.span
                className="simbar__fill"
                style={{ background: look(team).color }}
                initial={{ width: 0 }}
                animate={{ width: `${rate * 100}%` }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            <span className="simbar__value mono">{pct(rate)}</span>
          </div>
        ))}

        <hr className="divider" />

        <p className="eyebrow" style={{ marginBottom: 8 }}>Points moyens par joueur et par partie</p>
        {balance.rows.map((r) => (
          <div className="simbar" key={r.team}>
            <span className="simbar__label">{look(r.team).emoji} {look(r.team).label}</span>
            <span className="simbar__track">
              <motion.span
                className="simbar__fill"
                style={{ background: look(r.team).color }}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(100, (r.avg / Math.max(...balance.rows.map((x) => x.avg), 1)) * 100)}%` }}
                transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              />
            </span>
            <span className="simbar__value mono">{r.avg.toFixed(2)}</span>
          </div>
        ))}
      </div>

      {summary.evenings && summary.evenings.byRank.length > 0 && (
        <Evenings ev={summary.evenings} />
      )}

      <div className="card">
        <p className="eyebrow" style={{ marginBottom: 8 }}>Détail par rôle</p>
        <div className="scroll-x">
          <table className="simtable">
            <thead>
              <tr>
                <th>Rôle</th><th>Parties</th><th>Points moy.</th><th>Victoires</th><th>Pire</th><th>Meilleur</th>
              </tr>
            </thead>
            <tbody>
              {summary.perRole.map((r) => (
                <tr key={r.role}>
                  <td>{r.role}</td>
                  <td className="mono">{r.games.toLocaleString('fr')}</td>
                  <td className="mono">{r.avgPoints.toFixed(2)}</td>
                  <td className="mono">{pct(r.winRate)}</td>
                  <td className="mono">{r.worst}</td>
                  <td className="mono">{r.best}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary.dyingGuess.asked > 0 && (
          <p className="setting__hint" style={{ marginTop: 10 }}>
            🔮 Dernier soupçon : {summary.dyingGuess.correct} justes sur {summary.dyingGuess.asked} ({pct(summary.dyingGuess.rate)})
          </p>
        )}
        {summary.ballots.right + summary.ballots.wrong > 0 && (
          <p className="setting__hint">
            🔍 Bulletins de civils : {pct(summary.ballots.right / (summary.ballots.right + summary.ballots.wrong))} justes
            ({summary.ballots.right.toLocaleString('fr')} contre {summary.ballots.wrong.toLocaleString('fr')})
          </p>
        )}
      </div>

      {Object.keys(summary.titles).length > 0 && (
        <div className="card">
          <p className="eyebrow" style={{ marginBottom: 8 }}>Fréquence des titres</p>
          {Object.entries(summary.titles).map(([key, n]) => (
            <div className="simbar" key={key}>
              <span className="simbar__label">{key}</span>
              <span className="simbar__track">
                <span className="simbar__fill" style={{ width: `${(n / summary.games) * 100}%`, background: 'var(--accent)' }} />
              </span>
              <span className="simbar__value mono">{pct(n / summary.games)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="setting__hint center">
        Journal complet dans <code>{result.file}</code> · {(result.ms / 1000).toFixed(1)}s
      </p>
    </div>
  )
}

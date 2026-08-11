/**
 * Every setting, explained.
 *
 * Rendered in two places from the same component: as a tab of the in-game
 * rulebook, where the question is asked, and at `/regles`, so the page can be
 * sent to someone before they ever open the game.
 *
 * All of it is read from `/api/info` — the descriptors the settings panel
 * itself uses. Nothing is written twice, so nothing can end up saying two
 * different things.
 */

const FLOOR_NOTE = 'Dépend du mode récompense et punition.'

/** Shows a default the way a player would read it, not the way it is stored. */
function readableDefault(key, value, info) {
  if (key === 'themeIds') return Array.isArray(value) && value.length === 0 ? 'tous' : 'sélection'
  if (key === 'scoreFloor') {
    return info.scoreFloors?.find((f) => f.id === value)?.label ?? String(value)
  }
  if (typeof value === 'boolean') return value ? 'activé' : 'désactivé'
  if (value === 0) return 'désactivé'
  if (key === 'turnTimer' || key === 'discussTime' || key === 'dyingGuessTime') return `${value} s`
  return String(value)
}

export default function Reference({ info, settings }) {
  if (!info?.settingFields) return null

  const groups = info.settingGroups ?? []
  const defaults = info.defaults ?? {}
  // When a game is running, say what this table actually plays with — far more
  // useful mid-round than the shipped default.
  const live = settings ?? null

  return (
    <div className="stack" style={{ gap: 22 }}>
      <p className="sheet__text">
        Tous les réglages se trouvent derrière <strong>⚙️ Régler la partie</strong> sur le
        téléphone qui porte la couronne 👑, ou dans les onglets de l'écran partagé. Ils se
        modifient dans le salon uniquement : une fois la partie lancée, ils sont verrouillés.
      </p>

      {groups.map((g) => {
        const fields = info.settingFields.filter((f) => f.group === g.id)
        if (fields.length === 0) return null

        return (
          <div className="stack" key={g.id} style={{ gap: 10 }}>
            <div>
              <p className="eyebrow">{g.emoji} {g.label}</p>
              <p className="sheet__text" style={{ marginTop: 2 }}>{g.blurb}</p>
            </div>

            {fields.map((f) => {
              const value = live ? live[f.key] : defaults[f.key]
              const off = f.dependsOn && live && !live[f.dependsOn]
              return (
                <div className="refcard" key={f.key} style={off ? { opacity: 0.5 } : undefined}>
                  <div className="spread" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <div className="refcard__title">
                      <span>{f.emoji}</span> {f.label}
                    </div>
                    <span className="badge mono" style={{ flexShrink: 0 }}>
                      {readableDefault(f.key, value, info)}
                    </span>
                  </div>

                  <p className="sheet__text">{f.hint}</p>
                  {/* The part you only want when actually reading up: not what
                      it means, but when to switch it on. */}
                  <p className="refcard__when">💡 {f.when}</p>
                  {f.dependsOn === 'detectiveMode' && (
                    <p className="refcard__dep">{FLOOR_NOTE}</p>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}

      <div className="stack" style={{ gap: 8 }}>
        <p className="eyebrow">💯 Le barème</p>
        <p className="sheet__text">
          Chaque valeur se règle au curseur, de 0 au maximum indiqué. Mettre 0 désactive
          complètement une récompense. L'onglet <strong>Points</strong> de cette fiche liste ce
          que vaut chaque victoire dans la partie en cours.
        </p>
        <p className="sheet__text">
          Pour trouver le bon barème plutôt que de tâtonner, le banc d'essai <code>/simulate</code>{' '}
          joue des milliers de parties contre le vrai moteur et compare plusieurs valeurs.
        </p>
      </div>
    </div>
  )
}

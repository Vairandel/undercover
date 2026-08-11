import { useEffect, useState } from 'react'
import Reference from './Reference.jsx'

/**
 * The rulebook as a page you can send someone.
 *
 * The in-game sheet answers the question where it gets asked; this answers it
 * before anyone has opened the game at all — a link to share with a group
 * before a session, or for a curious visitor deciding whether to try.
 *
 * Same `Reference` component as the sheet, reading the same descriptors from
 * `/api/info`. Nothing is written twice.
 */
export default function RulesPage() {
  const [info, setInfo] = useState(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    fetch('/api/info')
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setFailed(true))
  }, [])

  if (failed) {
    return (
      <div className="screen screen--center">
        <p className="subtitle">Serveur injoignable.</p>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="screen screen--center">
        <p className="subtitle pulse">Chargement…</p>
      </div>
    )
  }

  const roles = info.roles.filter((r) => r.kind === 'role')
  const modifiers = info.roles.filter((r) => r.kind === 'modifier')

  return (
    <div className="screen" style={{ maxWidth: 760, margin: '0 auto', width: '100%' }}>
      <header className="spread">
        <div>
          <h1 className="title">📖 Règles et réglages</h1>
          <p className="faint" style={{ fontSize: '0.8rem' }}>
            {info.bank.pairs} paires de mots · {roles.length} rôles · {modifiers.length} modificateurs
          </p>
        </div>
        <a className="btn btn--ghost btn--sm" href="/">← Jouer</a>
      </header>

      <div className="card">
        <p className="eyebrow" style={{ marginBottom: 8 }}>Le principe</p>
        <p className="sheet__text">
          Tout le monde reçoit le même mot, sauf un ou deux <strong>infiltrés</strong> qui en
          reçoivent un légèrement différent — et parfois un <strong>Mister White</strong> qui n'en
          a aucun. Chacun décrit son mot en un seul mot, sans le dire. Puis on débat, puis on vote.
          Les civils gagnent en démasquant les imposteurs ; les imposteurs, en survivant assez
          longtemps.
        </p>
        <p className="sheet__text">
          Aucun compte, aucune installation : on ouvre l'adresse, on entre un pseudo, et on joue.
          Une partie se crée depuis n'importe quel téléphone — un écran partagé est un confort,
          pas une obligation.
        </p>
      </div>

      <Reference info={info} />

      <div className="card">
        <p className="eyebrow" style={{ marginBottom: 8 }}>🎭 Rôles et modificateurs</p>
        <p className="sheet__text" style={{ marginBottom: 12 }}>
          Un rôle par joueur. Les modificateurs se superposent : on peut être Infiltré
          <em> et </em> Amoureux.
        </p>
        {[...roles, ...modifiers].map((r) => (
          <div className="refcard" key={r.id}>
            <div className="refcard__title" style={{ color: r.color }}>
              <span>{r.emoji}</span> {r.label}
              {r.kind === 'modifier' && (
                <span className="badge" style={{ marginLeft: 8, fontSize: '0.62rem' }}>
                  garde son rôle
                </span>
              )}
            </div>
            <p className="sheet__text">{r.rules ?? r.tagline}</p>
          </div>
        ))}
      </div>

      <p className="setting__hint center" style={{ marginBottom: 20 }}>
        Cette page est générée depuis le jeu lui-même — elle ne peut pas décrire une règle
        qui n'existe pas.
      </p>
    </div>
  )
}

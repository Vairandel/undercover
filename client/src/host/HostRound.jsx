import { motion, AnimatePresence } from 'framer-motion'
import {
  CampTracker,
  ChatFeed,
  DyingGuesses,
  PhaseTimer,
  PlayerChip,
  Recap,
  ScoreBoard,
  Titles,
  TurnTimer,
  outcomeStyle,
} from '../components.jsx'

export default function HostRound({ state, act, control = true }) {
  const { phase, players, settings } = state
  const alive = players.filter((p) => p.alive)
  const speaker = players.find((p) => p.id === state.currentSpeakerId)
  const voteCounts = state.lastResult?.tally ?? {}

  // The final standings take over the whole screen — it is the moment everyone
  // looks up from their phone.
  if (phase === 'gameOver') {
    return <GameOver state={state} act={act} control={control} />
  }

  return (
    <>
      <Headline state={state} speaker={speaker} />

      {phase === 'describe' && settings.turnTimer > 0 && (
        <TurnTimer deadline={state.turnDeadline} total={settings.turnTimer} />
      )}

      {phase === 'discuss' && (
        <PhaseTimer deadline={state.phaseDeadline} total={settings.discussTime} large />
      )}

      {/* The shared screen is where the written debate belongs: everyone reads
          the same thread instead of each squinting at their own phone. */}
      {settings.writtenClues && (phase === 'discuss' || phase === 'vote') && (
        <ChatFeed messages={state.chat} />
      )}

      <CampTracker liveTeams={state.liveTeams} />

      <div className="host__grid">
        <AnimatePresence>
          {players.map((p) => (
            <PlayerChip
              key={p.id}
              player={p}
              speaking={p.id === state.currentSpeakerId}
              showClue={settings.writtenClues && phase !== 'reveal'}
              votes={phase === 'voteResult' ? voteCounts[p.id] ?? 0 : 0}
              highlighted={phase === 'tiebreak' && state.tiebreak?.tiedIds?.includes(p.id)}
              voteState={
                phase === 'vote' && p.canVote ? (p.hasVoted ? 'voted' : 'waiting') : undefined
              }
              /* Read-only here: the big screen shows the mood, phones set it. */
              reactions={state.reactions?.[p.id]}
              players={players}
            />
          ))}
        </AnimatePresence>
      </div>

      {phase === 'vote' && (
        <p className="center subtitle">
          {players.filter((p) => p.hasVoted).length} / {players.filter((p) => p.canVote).length} ont
          voté
        </p>
      )}

      {phase === 'discuss' && state.skipNeeded > 0 && (
        <p className="center subtitle">
          {state.skipRequests.length} / {state.skipNeeded} veulent passer au vote
        </p>
      )}

      <Footer state={state} act={act} control={control} />
    </>
  )
}

function Headline({ state, speaker }) {
  const { phase, players, settings, lastResult } = state

  if (phase === 'reveal') {
    const ready = players.filter((p) => p.ready).length
    return (
      <div className="center stack">
        <p className="eyebrow">Distribution des rôles</p>
        <h1 className="host__display shimmer">Regardez votre téléphone</h1>
        <p className="subtitle">
          {ready} / {players.length} joueurs ont vu leur carte
        </p>
      </div>
    )
  }

  if (phase === 'describe') {
    return (
      <div className="center stack">
        <p className="eyebrow">
          {settings.writtenClues ? 'Écris un mot qui décrit ton mot' : 'Décris ton mot à voix haute'}
        </p>
        <h1 className="host__display">
          <span style={{ fontSize: '0.85em' }}>{speaker?.avatar} </span>
          {speaker?.name ?? '—'}
        </h1>
        <p className="subtitle">C'est à toi. Un seul mot, jamais le tien.</p>
      </div>
    )
  }

  if (phase === 'discuss') {
    return (
      <div className="center stack">
        <p className="eyebrow">Discussion</p>
        <h1 className="host__display">Débattez</h1>
        <p className="subtitle">
          Accusez, défendez-vous, mentez. Le vote s'ouvre à la fin du chrono.
        </p>
      </div>
    )
  }

  if (phase === 'vote') {
    return (
      <div className="center stack">
        <p className="eyebrow">Vote</p>
        <h1 className="host__display">Qui est l'imposteur&nbsp;?</h1>
        <p className="subtitle">Chacun vote sur son téléphone.</p>
      </div>
    )
  }

  if (phase === 'tiebreak') {
    const tied = (state.tiebreak?.tiedIds ?? [])
      .map((id) => players.find((p) => p.id === id)?.name)
      .filter(Boolean)
    return (
      <div className="center stack">
        <p className="eyebrow">Égalité</p>
        <h1 className="host__display pulse">⚖️ Quelqu'un est en train de trancher</h1>
        <p className="subtitle">
          {tied.join(' et ')} sont à égalité. Une personne à cette table a le pouvoir de
          décider — et personne ne sait qui.
        </p>
      </div>
    )
  }

  if (phase === 'revenge') {
    return (
      <div className="center stack">
        <p className="eyebrow">Vengeance</p>
        <h1 className="host__display pulse">🗡️ Quelqu'un ne part pas seul</h1>
        <p className="subtitle">
          La personne éliminée désigne qui tombe avec elle. Retenez votre souffle.
        </p>
      </div>
    )
  }

  if (phase === 'mrwhiteGuess') {
    return (
      <div className="center stack">
        <p className="eyebrow">Dernière chance</p>
        <h1 className="host__display pulse">🃏 Mister White devine…</h1>
        <p className="subtitle">
          S'il trouve le mot des civils, il gagne la partie à lui tout seul.
        </p>
      </div>
    )
  }

  if (phase === 'voteResult') {
    if (lastResult?.tie) {
      return (
        <div className="center stack">
          <p className="eyebrow">Égalité</p>
          <h1 className="host__display">Personne n'est éliminé</h1>
          <p className="subtitle">
            {lastResult.tiebreak?.abstained
              ? 'Le Justicier a choisi de n\'éliminer personne.'
              : 'Les votes se sont annulés. On repart pour un tour.'}
          </p>
        </div>
      )
    }

    const el = lastResult?.eliminated
    return (
      <motion.div
        className="center stack"
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
      >
        <p className="eyebrow">{el?.cause === 'tiebreak' ? '⚖️ Départagé' : 'Éliminé'}</p>
        <h1 className="host__display">
          <span style={{ fontSize: '0.85em' }}>{el?.avatar} </span>
          {el?.name}
        </h1>
        <p className="title" style={{ color: el?.roleColor }}>
          {el?.roleEmoji} {el?.roleLabel}
          {el?.modifiers?.map((m) => ` + ${m.emoji} ${m.label}`).join('')}
          {/* Never the word: naming it would hand the Infiltré the civilians'
              word. It waits for the final reveal. */}
          {el?.hadWord === false ? ' · aucun mot' : ''}
        </p>

        {lastResult?.announce && <p className="subtitle">{lastResult.announce}</p>}

        {/* Chained deaths: a lover dying of grief gets its own line so the table
            can follow the carnage. */}
        {lastResult?.alsoEliminated?.map((x) => (
          <p className="title" key={x.id} style={{ color: x.roleColor, fontSize: '1.15rem' }}>
            {x.avatar} {x.name} tombe aussi — {x.roleEmoji} {x.roleLabel}
            {x.modifiers?.map((m) => ` + ${m.emoji} ${m.label}`).join('')}
            {x.hadWord === false ? ' · aucun mot' : ''}
          </p>
        ))}

        {lastResult?.notes?.map((n, i) => (
          <p className="subtitle faint" key={i}>{n}</p>
        ))}

        {lastResult?.guess && (
          <p className="subtitle">
            Il a tenté « {lastResult.guess.text} » —{' '}
            <strong style={{ color: lastResult.guess.correct ? 'var(--ok)' : 'var(--danger)' }}>
              {lastResult.guess.correct ? 'exact' : 'raté'}
            </strong>
          </p>
        )}
      </motion.div>
    )
  }

  return null
}

function GameOver({ state, act, control = true }) {
  const team = outcomeStyle(state.outcome)

  return (
    <>
      <motion.div
        className="center stack"
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 16 }}
      >
        <p className="eyebrow">Fin de partie</p>
        <h1 className="host__display" style={{ color: team.color }}>
          {team.emoji} {team.label} {team.verb}
        </h1>
        <p className="subtitle">{state.outcome?.reason}</p>
        {state.words && (
          <p className="title" style={{ marginTop: 4 }}>
            <span style={{ color: 'var(--civilian)' }}>{state.words.civilianWord}</span>
            {'  vs  '}
            <span style={{ color: 'var(--undercover)' }}>{state.words.undercoverWord}</span>
          </p>
        )}
      </motion.div>

      <ScoreBoard rows={state.scoreboard} />

      <Titles titles={state.titles} />

      <DyingGuesses guesses={state.dyingGuesses} players={state.players} />

      <Recap rounds={state.recap} players={state.players} />

      {control && (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
          <button
            className="btn btn--primary grow"
            onClick={() => act('host:restart')}
            style={{ minHeight: 60, fontSize: '1.05rem' }}
          >
            ↻ Rejouer avec les mêmes joueurs
          </button>
          {/* Offered exactly where an evening actually ends: nobody decides to
              stop in the middle of a round. */}
          <button
            className="btn"
            onClick={() => act('host:endSession')}
            style={{ minHeight: 60, fontSize: '1.05rem' }}
          >
            🏁 Terminer la soirée
          </button>
        </div>
      )}
    </>
  )
}

function Footer({ state, act, control = true }) {
  if (!control) return null

  if (state.phase === 'discuss') {
    return (
      <button
        className="btn btn--primary btn--block"
        onClick={() => act('host:skipDiscussion')}
        style={{ minHeight: 60, fontSize: '1.05rem' }}
      >
        Passer au vote →
      </button>
    )
  }

  if (state.phase === 'voteResult') {
    return (
      <button
        className="btn btn--primary btn--block"
        onClick={() => act('host:continue')}
        style={{ minHeight: 60, fontSize: '1.05rem' }}
      >
        Manche suivante →
      </button>
    )
  }

  return null
}

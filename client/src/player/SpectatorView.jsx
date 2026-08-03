import { AnimatePresence, motion } from 'framer-motion'
import {
  CampTracker,
  ChatFeed,
  PlayerChip,
  PhaseTimer,
  Recap,
  ScoreBoard,
  TurnTimer,
  outcomeStyle,
} from '../components.jsx'
import { play } from '../audio.js'

const HEADLINE = {
  lobby: ['En attente', 'La partie va commencer'],
  reveal: ['Distribution', 'Chacun découvre sa carte'],
  describe: ['Description', null],
  discuss: ['Discussion', 'Ils débattent'],
  vote: ['Vote', "Qui est l'imposteur ?"],
  tiebreak: ['Égalité', '⚖️ Quelqu\'un tranche…'],
  revenge: ['Vengeance', '🗡️ Quelqu\'un ne part pas seul'],
  mrwhiteGuess: ['Dernière chance', '🃏 Mister White devine…'],
  voteResult: ['Résultat', null],
  gameOver: ['Fin de partie', null],
}

/**
 * Read-only view for someone without a seat.
 *
 * Deliberately built from the *public* state only — the same feed the shared
 * screen gets. A spectator therefore learns nothing a player at the table does
 * not already know, which is what makes it safe to hand the link to anyone,
 * including a player who was eliminated or arrived late.
 */
export default function SpectatorView({ state, leave, connected, canJoin, onJoin }) {
  const { phase, players, settings } = state
  const speaker = players.find((p) => p.id === state.currentSpeakerId)
  const [eyebrow, title] = HEADLINE[phase] ?? ['', null]

  return (
    <div className="screen">
      <header className="spread">
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: '1.4rem' }}>👁</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Spectateur</div>
            <div className="faint" style={{ fontSize: '0.72rem' }}>
              {state.code} · {state.round > 0 ? `manche ${state.round}` : 'salon'}
            </div>
          </div>
        </div>

        <div className="row" style={{ gap: 8 }}>
          {!connected && (
            <span className="badge pulse" style={{ color: 'var(--gold)' }}>reconnexion…</span>
          )}
          <button className="btn btn--ghost btn--sm" onClick={leave}>Quitter</button>
        </div>
      </header>

      {/* The one thing a spectator can do: take a seat once a game ends. */}
      {canJoin && (
        <button
          className="btn btn--primary btn--block"
          onClick={() => { play('tap'); onJoin() }}
        >
          ✋  Rejoindre la prochaine partie
        </button>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={phase}
          className="stack grow"
          style={{ justifyContent: 'center' }}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -16 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="stack center" style={{ gap: 6 }}>
            <p className="eyebrow">{eyebrow}</p>
            {phase === 'describe' ? (
              <h1 className="title">{speaker?.avatar} {speaker?.name}</h1>
            ) : phase === 'gameOver' ? (
              <>
                <h1 className="title" style={{ color: outcomeStyle(state.outcome).color }}>
                  {outcomeStyle(state.outcome).emoji} {outcomeStyle(state.outcome).label}{' '}
                  {outcomeStyle(state.outcome).verb}
                </h1>
                <p className="subtitle">{state.outcome?.reason}</p>
              </>
            ) : (
              title && <h1 className="title">{title}</h1>
            )}
          </div>

          {phase === 'describe' && settings.turnTimer > 0 && (
            <TurnTimer deadline={state.turnDeadline} total={settings.turnTimer} />
          )}
          {phase === 'discuss' && (
            <PhaseTimer deadline={state.phaseDeadline} total={settings.discussTime} />
          )}

          <CampTracker liveTeams={state.liveTeams} />

          {phase === 'voteResult' && state.lastResult?.eliminated && (
            <div className="stack center" style={{ gap: 4 }}>
              <div style={{ fontSize: '2.4rem' }}>{state.lastResult.eliminated.avatar}</div>
              <h2 className="title">{state.lastResult.eliminated.name}</h2>
              <p className="title" style={{ color: state.lastResult.eliminated.roleColor, fontSize: '1rem' }}>
                {state.lastResult.eliminated.roleEmoji} {state.lastResult.eliminated.roleLabel}
              </p>
            </div>
          )}

          {phase === 'gameOver' && (
            <>
              {state.words && (
                <p className="subtitle center">
                  <span style={{ color: 'var(--civilian)' }}>{state.words.civilianWord}</span>
                  {' vs '}
                  <span style={{ color: 'var(--undercover)' }}>{state.words.undercoverWord}</span>
                </p>
              )}
              <ScoreBoard rows={state.scoreboard} compact />
              <Recap rounds={state.recap} players={players} />
            </>
          )}

          <div className="players">
            {players.map((p) => (
              <PlayerChip
                key={p.id}
                player={p}
                speaking={p.id === state.currentSpeakerId}
                showClue={settings.writtenClues && phase !== 'reveal'}
                voteState={phase === 'vote' && p.canVote ? (p.hasVoted ? 'voted' : 'waiting') : undefined}
              />
            ))}
          </div>

          {settings.writtenClues && state.chat?.length > 0 && (
            <ChatFeed messages={state.chat} compact />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

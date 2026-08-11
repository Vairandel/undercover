/**
 * What each player did across the whole evening.
 *
 * The end-of-session awards need history, and history is exactly what the game
 * throws away: `restart()` wipes clues, votes, reactions and every scratch field
 * so the next round starts clean. Only the score and the win count survived.
 *
 * So each finished game folds its facts into here first. Nothing is derived at
 * read time — every number below is incremented once, when it happens, which
 * keeps the awards cheap to compute and impossible to disagree with the game
 * they describe.
 *
 * Kept small and flat on purpose: it rides in the room snapshot, so it has to
 * survive a server restart without ceremony.
 */
export function blankCareer(joinedAtGame = 0) {
  return {
    // Presence
    joinedAtGame,
    games: 0,
    zeroGames: 0, // parties terminées sans marquer un point
    best: 0,
    worst: 0,

    // Rôles reçus
    roles: {}, // roleId -> nombre de fois
    modifiers: {}, // modifierId -> nombre de fois

    // Survie
    survived: 0, // encore en vie à la fin
    eliminated: 0,
    firstOut: 0, // sorti le premier de la manche
    lifespan: 0, // total des manches vécues, pour une moyenne

    // Bulletins émis
    votesCast: 0,
    votesRight: 0, // visaient un imposteur
    votesBlank: 0,
    votedWithPack: 0, // même cible que la majorité
    executions: 0, // sa cible est effectivement tombée

    // Bulletins reçus
    votesReceived: 0,
    votesReceivedInnocent: 0, // reçus alors qu'il était civil
    accusedFirstRound: 0,

    // Objectifs
    whiteGuesses: 0,
    whiteGuessRight: 0,
    dyingAsked: 0,
    dyingRight: 0,
    quests: 0, // rôles à objectif annexe reçus
    questsDone: 0, // et réussis

    // Parole
    cluesGiven: 0,
    cluesTimedOut: 0,
    chatLines: 0,
    spokeFirst: 0,

    // Réactions
    reactionsGot: {}, // emoji -> nombre
    reactionsGiven: 0,

    // Le pote qu'on attend toujours
    readyLast: 0,
    readyFirst: 0,

    // Sa place au classement après chaque partie. Sans cette trace, une
    // remontée est indétectable : le classement final ne dit pas d'où l'on
    // vient.
    ranks: [],
  }
}

/** Objectifs annexes : des rôles qu'on peut rater, pas seulement porter. */
export const QUEST_TRAITS = ['bouffon', 'mercenaire', 'duelliste', 'amoureux', 'vengeuse']

/** Les clés d'award qui prouvent qu'un objectif annexe a été rempli. */
export const QUEST_AWARDS = ['bouffon', 'mercenaire', 'duelliste', 'lovers', 'revenge']

const bump = (obj, key, by = 1) => { obj[key] = (obj[key] ?? 0) + by }

/**
 * Fold one finished game into a player's career.
 *
 * Called from `finish()`, before anything is cleared. `facts` carries what only
 * the engine knows at that instant — who the majority voted for, who actually
 * fell, how long each player lasted.
 */
export function recordGame(career, facts) {
  career.games += 1
  if (facts.points === 0) career.zeroGames += 1
  career.best = Math.max(career.best, facts.points)
  career.worst = career.games === 1 ? facts.points : Math.min(career.worst, facts.points)

  if (facts.roleId) bump(career.roles, facts.roleId)
  for (const id of facts.modifiers ?? []) bump(career.modifiers, id)

  if (facts.alive) career.survived += 1
  else career.eliminated += 1
  if (facts.firstOut) career.firstOut += 1
  career.lifespan += facts.lifespan ?? 0

  career.votesCast += facts.votesCast ?? 0
  career.votesRight += facts.votesRight ?? 0
  career.votesBlank += facts.votesBlank ?? 0
  career.votedWithPack += facts.votedWithPack ?? 0
  career.executions += facts.executions ?? 0

  career.votesReceived += facts.votesReceived ?? 0
  career.votesReceivedInnocent += facts.votesReceivedInnocent ?? 0
  career.accusedFirstRound += facts.accusedFirstRound ?? 0

  career.whiteGuesses += facts.whiteGuesses ?? 0
  career.whiteGuessRight += facts.whiteGuessRight ?? 0
  career.dyingAsked += facts.dyingAsked ?? 0
  career.dyingRight += facts.dyingRight ?? 0
  career.quests += facts.quests ?? 0
  career.questsDone += facts.questsDone ?? 0

  career.cluesGiven += facts.cluesGiven ?? 0
  career.cluesTimedOut += facts.cluesTimedOut ?? 0
  career.chatLines += facts.chatLines ?? 0
  career.spokeFirst += facts.spokeFirst ?? 0

  for (const [emoji, n] of Object.entries(facts.reactionsGot ?? {})) {
    bump(career.reactionsGot, emoji, n)
  }
  career.reactionsGiven += facts.reactionsGiven ?? 0

  career.readyLast += facts.readyLast ?? 0
  career.readyFirst += facts.readyFirst ?? 0

  return career
}

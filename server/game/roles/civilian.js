import { uncertainBrief } from './uncertain.js'

export default {
  id: 'civilian',
  label: 'Civil',
  emoji: '🧑',
  color: '#38bdf8',
  team: 'civilian',
  tagline: 'Trouve les imposteurs sans révéler ton mot.',

  rules:
    "Il connaît le mot majoritaire. Son travail : le décrire sans jamais le prononcer, et repérer ceux dont les indices sonnent faux. Les civils gagnent quand tous les infiltrés et Mister White ont été éliminés.",

  /** The word this role receives at the start of a round. */
  getWord: ({ words }) => words.civilianWord,

  /** What this player is told about themselves on the reveal card. */
  /**
   * With the "les infiltrés savent qu'ils le sont" toggle off, a Civil must
   * receive exactly what an Infiltré receives — see `uncertain.js`. Any
   * difference here would be the tell that gives the variant away.
   */
  brief: ({ settings }) =>
    settings.undercoverKnowsRole
      ? {
          title: 'Tu es un Civil',
          body: 'Décris ton mot sans le dire. Repère ceux dont la description sonne faux.',
          knowsWord: true,
        }
      : uncertainBrief(),

  /**
   * Civilians win once nobody hostile is left standing.
   *
   * Only the two impostor camps count as hostile. Every other trait in the game
   * is a modifier layered on a base role, so it never changes who is on which
   * side — a Bouffon or a Maire is still whatever their role says they are.
   */
  checkWin: (ctx) => {
    const hostiles = ctx.alive.filter((p) => ['undercover', 'mrwhite'].includes(ctx.teamOf(p)))
    if (hostiles.length === 0) {
      return { team: 'civilian', reason: 'Tous les imposteurs ont été démasqués.' }
    }
    return null
  },
}

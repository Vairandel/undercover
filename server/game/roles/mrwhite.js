export default {
  id: 'mrwhite',
  label: 'Mister White',
  emoji: '🃏',
  color: '#e2e8f0',
  team: 'mrwhite',
  tagline: "Aucun mot. Bluffe jusqu'au bout.",

  rules:
    "Il n'a aucun mot. Il doit deviner le sujet en écoutant les autres, puis improviser une description crédible à son tour. Éliminé, il a droit à une dernière tentative : nommer le mot des civils lui donne la victoire à lui seul. Il gagne aussi s'il atteint le duel final.",
  minPlayers: 4,

  // Win conditions are evaluated highest-priority first, so a solo win beats a
  // team win when both would trigger on the same elimination.
  winPriority: 20,

  /** No word at all — this is what makes the role hard and funny. */
  getWord: () => null,

  brief: () => ({
    title: 'Tu es Mister White',
    body: "Tu n'as aucun mot. Écoute les autres, devine le sujet, et improvise une description crédible.",
    knowsWord: false,
  }),

  /**
   * Getting voted out is not the end for Mr. White: he gets one guess at the
   * civilians' word. The engine reads this flag to know it must pause the round
   * and open the guess prompt rather than moving straight on.
   */
  onEliminated: () => ({ interrupt: { kind: 'mrwhiteGuess' } }),

  checkWin: (ctx) => {
    const whites = ctx.alive.filter((p) => ctx.teamOf(p) === 'mrwhite')
    if (whites.length === 0) return null

    const impostors = ctx.alive.filter((p) => ctx.teamOf(p) === 'undercover')
    const civils = ctx.aliveOnTeam('civilian')

    // Down to a single civilian, with an Infiltré still standing: neither of
    // them could have got here without the other muddying the votes, so they
    // cash in together rather than one stealing the whole win.
    if (civils <= 1 && impostors.length > 0) {
      return {
        team: 'mrwhite',
        teams: ['mrwhite', 'undercover'],
        reason:
          "Il ne reste qu'un civil. Mister White et les infiltrés se partagent la victoire.",
        winners: [...whites, ...impostors].map((p) => p.id),
      }
    }

    if (ctx.alive.length <= 2) {
      return { team: 'mrwhite', reason: 'Mister White est encore là à la fin. Chapeau.' }
    }

    if (civils <= 1) {
      return {
        team: 'mrwhite',
        reason: "Il ne reste qu'un civil, et Mister White est toujours debout.",
      }
    }

    return null
  },
}

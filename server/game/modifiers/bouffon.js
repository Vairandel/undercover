export default {
  id: 'bouffon',
  label: 'Bouffon',
  emoji: '🤡',
  color: '#fbbf24',
  tagline: 'Fais-toi lyncher dès la première manche pour marquer.',

  rules:
    "Il garde son vrai rôle et son mot. Son pari, en plus : se faire éliminer par le vote dès la première manche, ce qui lui rapporte des points quel que soit le vainqueur. Passé la première manche, le pari est perdu — et se saborder peut coûter cher à son camp.",
  minPlayers: 4,
  slots: 1,

  /**
   * The reward is quoted from the live scale, never hardcoded — the host can
   * retune it and the card must not lie.
   */
  brief: ({ points }) => ({
    title: '🤡 Tu es le Bouffon',
    body: `Tu gardes ton rôle et ton mot. Ton pari en plus : te faire éliminer par le vote dès la première manche, pour ${points.bouffon} points. Sois louche tout de suite — après, il sera trop tard, et te saborder ne servira plus qu'à desservir ton camp.`,
    color: '#fbbf24',
  }),

  /**
   * Being lynched is worth points, never the game.
   * The window is the first round only — after that everyone has read him, and
   * the bluff stops being a risk worth rewarding.
   */
  onGameEnd: (ctx) =>
    ctx.players
      .filter(
        (p) =>
          ctx.hasModifier(p, 'bouffon') &&
          p.data.eliminatedRound === 1 &&
          p.data.eliminatedCause === 'vote',
      )
      .map((p) => ({
        playerId: p.id,
        key: 'bouffon',
        label: 'Lynché au 1er tour',
        points: ctx.points.bouffon,
      })),
}

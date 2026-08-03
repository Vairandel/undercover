export default {
  id: 'amoureux',
  label: 'Amoureux',
  emoji: '💘',
  color: '#fb7185',
  team: 'lovers',
  tagline: 'Deux joueurs liés, chacun gardant son vrai rôle.',

  rules:
    "Deux joueurs sont liés et connaissent l'identité l'un de l'autre. Ils gardent chacun leur véritable rôle : le couple peut réunir un civil et un infiltré. Si l'un meurt, l'autre le suit immédiatement. S'ils sont les deux derniers survivants, ils gagnent ensemble, contre tous les autres camps.",
  minPlayers: 5,
  slots: 2,

  // Beats every team condition: a couple reaching the end together is a more
  // specific outcome than "the impostors reached parity", and the pair may well
  // be one civilian and one impostor.
  winPriority: 30,

  /**
   * Applied on top of a role, not instead of it.
   *
   * The two lovers keep whatever they were dealt — an Infiltré and a Civil can
   * be a couple. They still play their own side, but they now have a second,
   * secret way to win, and a reason to keep each other alive.
   */
  onAssign(player, ctx) {
    const other = ctx.players.find((p) => p.id !== player.id && ctx.hasModifier(p, 'amoureux'))
    player.data.partnerId = other?.id ?? null
  },

  /** Extra block appended to the reveal card, under the real role. */
  brief({ player, game }) {
    const partner = player.data.partnerId ? game.players.get(player.data.partnerId) : null
    if (!partner) return null
    return {
      title: '💘 Tu es Amoureux',
      body: `${partner.avatar} ${partner.name} est ton amoureux. Vous gardez chacun votre rôle, mais si vous êtes les deux derniers survivants, vous gagnez ensemble — quels que soient vos camps. Si l'un meurt, l'autre le suit.`,
      color: '#fb7185',
      partner: { name: partner.name, avatar: partner.avatar },
    }
  },

  /** Dying of grief: losing one lover kills the other, whatever the cause. */
  onEliminated(player, ctx) {
    const partnerId = player.data.partnerId
    if (!partnerId) return undefined
    const partner = ctx.players.find((p) => p.id === partnerId)
    if (!partner?.alive) return undefined
    return {
      alsoEliminate: [partner.id],
      note: `${partner.name} ne survit pas à la mort de ${player.name}.`,
    }
  },

  checkWin(ctx) {
    const lovers = ctx.alive.filter((p) => ctx.hasModifier(p, 'amoureux'))
    if (lovers.length === 2 && ctx.alive.length === 2) {
      const [a, b] = lovers
      const mixed = ctx.teamOf(a) !== ctx.teamOf(b)
      return {
        team: 'lovers',
        reason: mixed
          ? `${a.name} et ${b.name} n'étaient pas du même camp, et s'en fichaient.`
          : `${a.name} et ${b.name} finissent la partie ensemble.`,
        winners: lovers.map((p) => p.id),
      }
    }
    return null
  },
}

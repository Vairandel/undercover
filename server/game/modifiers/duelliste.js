export default {
  id: 'duelliste',
  label: 'Duelliste',
  emoji: '⚔️',
  color: '#22d3ee',
  tagline: 'Deux rivaux qui se connaissent : le dernier debout marque.',

  rules:
    "Deux joueurs tirés au hasard, qui connaissent l'identité l'un de l'autre. Le duel se joue à côté de la partie et ne change aucune condition de victoire : celui des deux qui survit le plus longtemps marque des points, même si son camp perd.",
  minPlayers: 5,
  slots: 2,

  onAssign(player, ctx) {
    const rival = ctx.players.find((p) => p.id !== player.id && ctx.hasModifier(p, 'duelliste'))
    player.data.rivalId = rival?.id ?? null
  },

  brief({ player, game, points }) {
    const rival = player.data.rivalId ? game.players.get(player.data.rivalId) : null
    if (!rival) return null
    return {
      title: '⚔️ Tu es Duelliste',
      body: `${rival.avatar} ${rival.name} est ton rival, et sait qui tu es. Vous gardez chacun votre camp : le duel se joue à côté de la partie. Celui de vous deux qui survit le plus longtemps empoche ${points.duelliste} points.`,
      color: '#22d3ee',
      rival: { name: rival.name, avatar: rival.avatar },
    }
  },

  /**
   * Scored on survival order, not on who killed whom.
   *
   * Anyone still alive at the final whistle counts as "eliminated last"; if
   * both duellists made it, both marked. The engine stamps `eliminatedOrder`
   * on every death, so a straight comparison is enough.
   */
  onGameEnd(ctx) {
    const duellists = ctx.players.filter((p) => ctx.hasModifier(p, 'duelliste'))
    if (duellists.length < 2) return []

    const rank = (p) => (p.alive ? Infinity : (p.data.eliminatedOrder ?? 0))
    const best = Math.max(...duellists.map(rank))

    return duellists
      .filter((p) => rank(p) === best)
      .map((p) => ({
        playerId: p.id,
        key: 'duelliste',
        label: 'Duel remporté',
        points: ctx.points.duelliste,
      }))
  },
}

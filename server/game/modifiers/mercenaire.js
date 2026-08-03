export default {
  id: 'mercenaire',
  label: 'Mercenaire',
  emoji: '🎯',
  color: '#facc15',
  tagline: 'Un contrat : faire tomber sa cible dès la première manche.',
  minPlayers: 4,
  slots: 1,

  /** Picked at assignment so the contract survives a reconnect. */
  onAssign(player, ctx) {
    const pool = ctx.players.filter((p) => p.id !== player.id)
    const target = pool[Math.floor(Math.random() * pool.length)]
    player.data.contractId = target?.id ?? null
  },

  rules:
    "Une cible tirée au hasard t'est confiée au début de la partie. Fais-la éliminer dès la première manche et tu marques des points, quel que soit le vainqueur. Passé ce tour, le contrat est caduc.",

  brief({ player, game, points }) {
    const target = player.data.contractId ? game.players.get(player.data.contractId) : null
    if (!target) return null
    return {
      title: '🎯 Tu es le Mercenaire',
      body: `Ton contrat : ${target.avatar} ${target.name}. Fais-le éliminer dès la première manche et tu empoches ${points.mercenaire} points. Passé ce tour, le contrat est caduc — et tu redeviens un joueur comme les autres.`,
      color: '#facc15',
      contract: { name: target.name, avatar: target.avatar },
    }
  },

  /**
   * The contract pays only on a first-round kill, whatever killed them.
   *
   * The delicious case: the contract lands on the Bouffon, who is desperately
   * trying to get lynched in round one anyway. Both cash in from the same vote.
   */
  onGameEnd(ctx) {
    return ctx.players
      .filter((p) => ctx.hasModifier(p, 'mercenaire'))
      .flatMap((merc) => {
        const target = ctx.players.find((p) => p.id === merc.data.contractId)
        if (!target || target.data.eliminatedRound !== 1) return []
        return [{
          playerId: merc.id,
          key: 'mercenaire',
          label: `Contrat rempli (${target.name})`,
          points: ctx.points.mercenaire,
        }]
      })
  },
}

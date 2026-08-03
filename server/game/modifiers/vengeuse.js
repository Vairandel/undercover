export default {
  id: 'vengeuse',
  label: 'Vengeuse',
  emoji: '🗡️',
  color: '#f97316',
  tagline: 'Lynchée, elle emmène quelqu\'un avec elle.',

  rules:
    "Elle garde son vrai rôle — elle peut être civile, infiltrée ou Mister White. Si le groupe l'élimine par le vote, elle désigne aussitôt un joueur qui tombe avec elle. Elle peut aussi choisir de partir seule. Mourir autrement qu'au vote ne déclenche rien.",
  minPlayers: 5,
  slots: 1,

  /**
   * Layered on any hand — she can be a Civil, an Infiltré or even Mister White.
   * That is the point: nobody can deduce her side from the fact that she took
   * someone down.
   */
  brief: () => ({
    title: '🗡️ Tu es la Vengeuse',
    body: "Si le groupe t'élimine par le vote, tu désignes quelqu'un qui tombe avec toi. Choisis bien : ton camp reste le même, et emmener un allié ne t'avancera à rien.",
    color: '#f97316',
  }),

  /**
   * Only a lynching triggers the revenge — dying of grief as a lover, or being
   * taken down by another Vengeuse, does not. Otherwise a single vote could
   * cascade through half the table.
   */
  onEliminated: (player, ctx, cause) => {
    if (cause !== 'vote') return undefined
    const targets = ctx.alive.filter((p) => p.id !== player.id && !p.left)
    if (targets.length === 0) return undefined
    return {
      interrupt: {
        kind: 'revenge',
        label: 'Vengeance',
        emoji: '🗡️',
        prompt: 'Tu tombes. Qui emmènes-tu avec toi ?',
        allowSkip: true,
        skipLabel: 'Partir seule',
        targets: targets.map((p) => p.id),
      },
    }
  },
}

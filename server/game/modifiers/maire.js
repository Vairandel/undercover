export default {
  id: 'maire',
  label: 'Maire',
  emoji: '🎩',
  color: '#38bdf8',
  tagline: 'Son vote compte double, et personne ne le saura.',

  rules:
    "Toujours un joueur du camp des civils, jamais un infiltré. Il garde son rôle et son mot ; son bulletin compte double au dépouillement, sans que rien ne l'indique. Les totaux affichés ne trahissent pas d'où vient la voix supplémentaire, et son écharpe n'est jamais révélée, même après son élimination.",
  minPlayers: 4,
  slots: 1,

  /**
   * Never disclosed by the game — not on the reveal card of an eliminated
   * player, not anywhere. A doubled ballot only keeps its bite while the table
   * cannot work out whose it is; announcing it is the player's gamble to take
   * out loud, not the app's to make for them.
   */
  secret: true,

  /**
   * Civilians only.
   *
   * A doubled ballot in an impostor's hands is close to unbeatable: they already
   * know who the other side is, and a hidden extra vote lets them steer every
   * elimination. The sash is a civilian institution.
   */
  canApply: (player, ctx) => ctx.teamOf(player) === 'civilian',

  brief: () => ({
    title: '🎩 Tu es le Maire',
    body: "Tu gardes ton rôle et ton mot, mais ta voix pèse double au dépouillement. Le jeu ne le révélera jamais, même si tu te fais éliminer. À toi de décider si tu l'annonces : ça te donne du poids dans le débat, et fait de toi une cible.",
    color: '#38bdf8',
  }),

  /** The engine multiplies this player's ballot when tallying. */
  onVote: () => ({ weight: 2 }),
}

export default {
  id: 'fantome',
  label: 'Fantôme',
  emoji: '👻',
  color: '#c4b5fd',
  tagline: 'Continue de voter même une fois éliminé.',

  rules:
    "Réservé à un joueur du camp des civils. Une fois éliminé, il continue de voter à chaque manche comme s'il était vivant. Personne d'autre ne sait que ce bulletin supplémentaire existe.",
  minPlayers: 5,
  slots: 1,

  // His whole premise is an extra ballot nobody knows about. Printing "Fantôme"
  // on his elimination card would hand the table the one fact that neutralises
  // him.
  secret: true,

  /**
   * Civilians only.
   *
   * A dead Infiltré who kept voting would hand his side a permanent extra
   * ballot for the rest of the game — the civilian camp is the one that needs
   * the consolation prize, not the impostors.
   */
  canApply: (player, ctx) => ctx.teamOf(player) === 'civilian',

  /** Read by the engine when deciding who is allowed to cast a ballot. */
  votesWhenDead: true,

  brief: () => ({
    title: '👻 Tu es le Fantôme',
    body: "Même éliminé, tu continues de voter à chaque manche. Personne ne sait que ce bulletin supplémentaire existe — profites-en pour peser sur la suite.",
    color: '#c4b5fd',
  }),
}

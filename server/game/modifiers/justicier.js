export default {
  id: 'justicier',
  label: 'Justicier',
  emoji: '⚖️',
  color: '#34d399',
  tagline: "En cas d'égalité au vote, c'est lui qui tranche.",

  rules:
    "Il garde son vrai rôle et son mot. Quand un vote se termine à égalité, c'est lui qui choisit lequel des ex æquo quitte la partie — ou qui décide de n'éliminer personne. La table voit qu'une décision est prise, jamais par qui.",
  minPlayers: 5,
  slots: 1,

  // Same reasoning as the Maire: a hidden arbiter only works while hidden.
  secret: true,

  brief: () => ({
    title: '⚖️ Tu es le Justicier',
    body: "Tu gardes ton rôle et ton mot. Quand un vote se termine par une égalité, c'est toi qui décides qui part — ou qui choisis d'épargner tout le monde. Personne ne saura jamais que ce pouvoir était entre tes mains.",
    color: '#34d399',
  }),

  /**
   * Tie-breaking capability.
   *
   * When a vote deadlocks, the engine looks for a living player whose role or
   * modifiers declare `tiebreak` and hands them the decision instead of
   * dropping the round. Nothing about "the Justicier" is hard-coded in the
   * engine, so any future trait can claim the same power.
   */
  tiebreak: {
    label: 'Départage',
    emoji: '⚖️',
    prompt: 'Le vote est à égalité. Tu choisis qui quitte la partie.',
    allowAbstain: true,
    abstainLabel: 'Personne ne part',
  },
}

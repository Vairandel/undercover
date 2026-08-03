import { uncertainBrief } from './uncertain.js'

export default {
  id: 'undercover',
  label: 'Infiltré',
  emoji: '🕵️',
  color: '#f43f5e',
  team: 'undercover',
  tagline: 'Ton mot est différent. Fonds-toi dans la masse.',

  rules:
    "Il reçoit un mot voisin de celui des civils, sans savoir lequel des deux est majoritaire. Il doit rester crédible en décrivant un mot légèrement différent. Les infiltrés gagnent dès qu'ils sont aussi nombreux que les autres, ou dès qu'il ne reste qu'un seul civil.",
  winPriority: 10,

  getWord: ({ words }) => words.undercoverWord,

  /**
   * The "les infiltrés savent qu'ils sont infiltrés" toggle lives here.
   *
   * When off, the undercover is handed their word with a plain civilian brief
   * and has to work out from the others' clues that they are the odd one out —
   * a much tenser variant. The engine passes the whole settings object so a
   * role can offer any number of variants without the engine knowing about them.
   */
  brief: ({ settings, teammates }) => {
    // Byte-identical to what a Civil gets, by construction: same function, one
    // source. `disguised` never leaves the server as-is — the engine uses it to
    // strip the real role id from the payload.
    if (!settings.undercoverKnowsRole) {
      return { ...uncertainBrief(), disguised: true }
    }

    const mates = teammates.map((p) => p.name)
    return {
      title: 'Tu es un Infiltré',
      body: mates.length
        ? `Ton mot n'est pas celui des autres. Complice${mates.length > 1 ? 's' : ''} : ${mates.join(', ')}.`
        : "Ton mot n'est pas celui des autres. Tu es seul. Reste crédible.",
      knowsWord: true,
      teammates: mates,
    }
  },

  checkWin: (ctx) => {
    const impostors = ctx.alive.filter((p) => ctx.teamOf(p) === 'undercover')
    if (impostors.length === 0) return null

    // Classic parity rule.
    const others = ctx.alive.filter((p) => ctx.teamOf(p) !== 'undercover')
    if (impostors.length >= others.length) {
      return { team: 'undercover', reason: 'Les infiltrés sont aussi nombreux que les civils.' }
    }

    // A lone civilian can no longer build a majority against anyone, so the
    // game is decided — no point dragging it out for another round.
    if (ctx.aliveOnTeam('civilian') <= 1) {
      return { team: 'undercover', reason: "Il ne reste qu'un seul civil. Les infiltrés l'emportent." }
    }

    return null
  },
}

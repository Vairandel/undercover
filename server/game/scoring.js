/**
 * Points awarded at the end of a game.
 *
 * These are defaults, not constants: the host can retune every value from the
 * lobby. Nothing anywhere else may hardcode a number — roles read their award
 * from `ctx.points`, so a change here or in the settings propagates everywhere,
 * including the text printed on the players' cards.
 *
 * The scale rewards difficulty: a civilian win is the baseline, an impostor win
 * is worth more because they were outnumbered, and Mister White is worth most
 * because he pulled it off without ever knowing the word. Side objectives stay
 * below a camp victory on purpose — they are a bonus, not the point of the game.
 */
export const DEFAULT_POINTS = {
  // Camp victories
  civilian: 2,
  undercover: 3,
  mrwhite: 5,
  lovers: 4,
  // Bonuses and side objectives
  survivor: 1,
  whiteGuess: 2,
  bouffon: 3,
  duelliste: 2,
  mercenaire: 2,
}

/**
 * Describes every tunable value for the settings UI and for validation.
 * `role` links a knob to the trait it belongs to, so the panel can grey out
 * what is not in play.
 */
export const POINT_FIELDS = [
  { key: 'civilian', group: 'teams', emoji: '🧑', label: 'Victoire des Civils', min: 0, max: 15 },
  { key: 'undercover', group: 'teams', emoji: '🕵️', label: 'Victoire des Infiltrés', min: 0, max: 15 },
  { key: 'mrwhite', group: 'teams', emoji: '🃏', label: 'Victoire de Mister White', min: 0, max: 15, role: 'mrwhite' },
  { key: 'lovers', group: 'teams', emoji: '💘', label: 'Victoire des Amoureux', min: 0, max: 15, role: 'amoureux' },

  { key: 'survivor', group: 'bonus', emoji: '❤️', label: 'Survivant', hint: 'Encore en vie à la fin de la partie', min: 0, max: 10 },
  { key: 'whiteGuess', group: 'bonus', emoji: '🎯', label: 'Mot deviné', hint: 'Mister White nomme le mot des civils après avoir été démasqué', min: 0, max: 10, role: 'mrwhite' },
  { key: 'bouffon', group: 'bonus', emoji: '🤡', label: 'Bouffon lynché', hint: 'Éliminé par le vote dès la première manche', min: 0, max: 10, role: 'bouffon' },
  { key: 'duelliste', group: 'bonus', emoji: '⚔️', label: 'Duel remporté', hint: 'Le duelliste qui survit le plus longtemps', min: 0, max: 10, role: 'duelliste' },
  { key: 'mercenaire', group: 'bonus', emoji: '💰', label: 'Contrat rempli', hint: 'La cible du mercenaire tombe dès la première manche', min: 0, max: 10, role: 'mercenaire' },
]

const FIELD_BY_KEY = Object.fromEntries(POINT_FIELDS.map((f) => [f.key, f]))

/** Defaults merged with the host's overrides, clamped to sane bounds. */
export function resolvePoints(settings) {
  const out = { ...DEFAULT_POINTS }
  for (const [key, raw] of Object.entries(settings?.points ?? {})) {
    const field = FIELD_BY_KEY[key]
    if (!field) continue
    const n = Number(raw)
    if (!Number.isFinite(n)) continue
    out[key] = Math.max(field.min, Math.min(field.max, Math.round(n)))
  }
  return out
}

/** Same clamping, applied when the host saves — so bad input never persists. */
export function sanitisePoints(patch, current = {}) {
  const merged = { ...current, ...(patch ?? {}) }
  const out = {}
  for (const field of POINT_FIELDS) {
    const n = Number(merged[field.key])
    out[field.key] = Number.isFinite(n)
      ? Math.max(field.min, Math.min(field.max, Math.round(n)))
      : DEFAULT_POINTS[field.key]
  }
  return out
}

/**
 * Works out what each player earned this game.
 *
 * `outcome.winners` lets a win name its beneficiaries explicitly — the Amoureux
 * and the shared Mister White / Infiltré victory both use it, because neither
 * maps onto a single team everyone belongs to. `outcome.teams` marks a shared
 * win, in which case each side is paid at its own rate.
 */
export function scoreGame({ players, outcome, teamOf, lastResult, awards = [], points = DEFAULT_POINTS }) {
  const rows = []
  const winnerIds = outcome?.winners ? new Set(outcome.winners) : null
  const winTeams = outcome?.teams ?? (outcome?.team ? [outcome.team] : [])
  const shared = (outcome?.teams?.length ?? 0) > 1

  for (const player of players) {
    const breakdown = []
    const team = player.roleId ? teamOf(player) : null

    const won = winnerIds ? winnerIds.has(player.id) : Boolean(team) && winTeams.includes(team)

    if (won) {
      // A shared victory pays each camp its own rate; a single-team win pays
      // that team's rate to everyone in it (the Amoureux included).
      const pts = shared ? points[team] ?? 0 : points[outcome.team] ?? 0
      if (pts > 0) breakdown.push({ key: 'win', label: 'Victoire', points: pts })
    }

    if (player.alive && !player.left && points.survivor > 0) {
      breakdown.push({ key: 'survivor', label: 'Survivant', points: points.survivor })
    }

    if (
      lastResult?.guess?.correct &&
      lastResult.eliminated?.id === player.id &&
      player.roleId === 'mrwhite' &&
      points.whiteGuess > 0
    ) {
      breakdown.push({ key: 'whiteGuess', label: 'Mot deviné', points: points.whiteGuess })
    }

    for (const award of awards) {
      if (award.playerId !== player.id || award.points <= 0) continue
      breakdown.push({ key: award.key, label: award.label, points: award.points })
    }

    const total = breakdown.reduce((sum, b) => sum + b.points, 0)
    rows.push({ playerId: player.id, won, breakdown, points: total })
  }

  return rows
}

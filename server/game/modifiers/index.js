import amoureux from './amoureux.js'
import bouffon from './bouffon.js'
import duelliste from './duelliste.js'
import fantome from './fantome.js'
import justicier from './justicier.js'
import maire from './maire.js'
import mercenaire from './mercenaire.js'
import vengeuse from './vengeuse.js'

/**
 * Modifiers are layered *on top of* a role rather than replacing it.
 *
 * They implement the same hook contract as roles (`onAssign`, `onVote`,
 * `onEliminated`, `onGameEnd`, `checkWin`, `brief`, ...), and the engine
 * dispatches to a player's role and to each of their modifiers alike.
 * Differences: a modifier's `brief` returns an extra card section instead of
 * the whole card, they are dealt after the roles so they can land on any hand,
 * they may refuse a hand with `canApply`, and they cost no seat in the
 * composition.
 *
 * A modifier marked `secret` is never disclosed by the game — not even on the
 * reveal card of an eliminated player. Only the final post-mortem shows it.
 */
export const MODIFIERS = {
  [amoureux.id]: amoureux,
  [bouffon.id]: bouffon,
  [duelliste.id]: duelliste,
  [fantome.id]: fantome,
  [justicier.id]: justicier,
  [maire.id]: maire,
  [mercenaire.id]: mercenaire,
  [vengeuse.id]: vengeuse,
}

export const OPTIONAL_MODIFIERS = Object.keys(MODIFIERS)

export function getModifier(id) {
  const mod = MODIFIERS[id]
  if (!mod) throw new Error(`Unknown modifier: ${id}`)
  return mod
}

export function modifierCatalogue() {
  return Object.values(MODIFIERS).map((m) => ({
    id: m.id,
    label: m.label,
    emoji: m.emoji,
    color: m.color,
    tagline: m.tagline,
    rules: m.rules ?? null,
    secret: Boolean(m.secret),
    optional: true,
    kind: 'modifier',
    minPlayers: m.minPlayers ?? 3,
    slots: m.slots ?? 1,
  }))
}

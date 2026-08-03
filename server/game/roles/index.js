import civilian from './civilian.js'
import undercover from './undercover.js'
import mrwhite from './mrwhite.js'

/**
 * Role registry.
 *
 * A role is *exclusive*: exactly one per player, and it decides which word they
 * get and which camp they win with. Everything else — a doubled ballot, a
 * tie-breaking power, a side bet — is a modifier layered on top, and lives in
 * `../modifiers/`.
 *
 * The engine never names a role directly; it only calls the hooks each one
 * declares. See `README.md` for the full contract.
 */
export const ROLES = {
  [civilian.id]: civilian,
  [undercover.id]: undercover,
  [mrwhite.id]: mrwhite,
}

/** Roles the host can switch on or off. Civil and Infiltré are always present. */
export const OPTIONAL_ROLES = [mrwhite].map((r) => r.id)

export function getRole(id) {
  const role = ROLES[id]
  if (!role) throw new Error(`Unknown role: ${id}`)
  return role
}

/** Public, non-spoiler description of every role — safe to send to all clients. */
export function roleCatalogue() {
  return Object.values(ROLES).map((r) => ({
    id: r.id,
    label: r.label,
    emoji: r.emoji,
    color: r.color,
    team: r.team,
    tagline: r.tagline,
    rules: r.rules ?? null,
    optional: OPTIONAL_ROLES.includes(r.id),
    kind: 'role',
    minPlayers: r.minPlayers ?? 3,
    slots: r.slots ?? 1,
  }))
}

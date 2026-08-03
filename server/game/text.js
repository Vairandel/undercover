/**
 * Word comparison used both for Mister White's guess and for policing clues.
 *
 * Everything is compared on a folded form: lowercase, accents stripped, leading
 * article removed, punctuation dropped. A player typing "  Le SAUT EN LONGUEUR !"
 * on a phone keyboard under pressure must match "Saut en longueur".
 */
export function normalise(s) {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^(le|la|les|un|une|des|du|de|l'|d')\s*/, '')
    .replace(/[^a-z0-9]/g, '')
}

/** True when two strings fold to the same thing. */
export function sameWord(a, b) {
  const x = normalise(a)
  return x.length > 0 && x === normalise(b)
}

/**
 * True when a clue is so close to a word that it gives the game away.
 *
 * Exact folded match always counts. Containment only kicks in from 5 characters
 * so that short words don't produce false positives — "Riz" must not forbid
 * "Rizière", but "Cheval" rightly forbids "Chevalier".
 */
export function tooClose(clue, word) {
  const c = normalise(clue)
  const w = normalise(word)
  if (!c || !w) return false
  if (c === w) return true
  if (w.length >= 5 && c.includes(w)) return true
  if (c.length >= 5 && w.includes(c)) return true
  return false
}

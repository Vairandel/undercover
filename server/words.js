import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { store } from './store.js'

const wordsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'words')

const themes = loadThemes()

/**
 * A pair is written either as
 *   ["Sous-marin", "Bathyscaphe"]
 * or, when a word is obscure enough that a player could be stuck without a
 * hint, with a short definition for either side:
 *   ["Sous-marin", "Bathyscaphe", "Navire...", "Engin d'exploration..."]
 * Definitions are optional and independent — `null` skips one.
 */
function parsePair(raw) {
  if (Array.isArray(raw)) {
    const [a, b, defA = null, defB = null] = raw
    return { a, b, defA, defB }
  }
  return { a: raw?.a, b: raw?.b, defA: raw?.defA ?? null, defB: raw?.defB ?? null }
}

function loadThemes() {
  const files = fs.readdirSync(wordsDir).filter((f) => f.endsWith('.json'))
  const loaded = []

  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(wordsDir, file), 'utf8'))
    const seen = new Set()
    const pairs = []

    // A pair whose two words are identical, or a duplicate of another pair,
    // silently ruins a round: the undercover becomes unmaskable, or the
    // household sees a "fresh" word they already played. Catch it at load.
    for (const entry of raw.pairs ?? []) {
      const { a, b, defA, defB } = parsePair(entry)
      if (!a || !b) continue
      const key = [a, b].map((w) => w.toLowerCase()).sort().join('|')
      if (a.toLowerCase() === b.toLowerCase() || seen.has(key)) {
        console.warn(`[words] skipping invalid pair in ${file}: ${a} / ${b}`)
        continue
      }
      seen.add(key)
      pairs.push({ a, b, defA, defB })
    }

    loaded.push({ id: raw.id, label: raw.label, emoji: raw.emoji ?? '🎲', pairs })
  }

  return loaded.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
}

export function listThemes() {
  return themes.map((t) => ({
    id: t.id,
    label: t.label,
    emoji: t.emoji,
    total: t.pairs.length,
    remaining: t.pairs.length - store.seenCount(t.id),
    described: t.pairs.filter((p) => p.defA || p.defB).length,
  }))
}

export function totalPairs() {
  return themes.reduce((sum, t) => sum + t.pairs.length, 0)
}

/**
 * Draw a pair the household has never played.
 *
 * The whole point of the app: with ~650 pairs, a group can play hundreds of
 * nights before repeating anything. Only once a theme is genuinely exhausted do
 * we recycle it — and we say so, rather than quietly repeating.
 */
export function drawPair({ themeIds = null } = {}) {
  // An empty or missing selection means "anything goes".
  const wanted = Array.isArray(themeIds) ? themes.filter((t) => themeIds.includes(t.id)) : []
  const pool = wanted.length > 0 ? wanted : themes

  // Weight the draw by how much fresh material each theme still holds, so a
  // nearly-exhausted theme does not keep winning the coin toss against a
  // untouched one and force an early recycle.
  const theme = pickWeighted(pool)
  if (!theme) throw new Error('Aucun thème disponible.')

  let recycled = false
  let available = theme.pairs
    .map((pair, index) => ({ pair, index }))
    .filter(({ index }) => !store.hasSeen(theme.id, index))

  if (available.length === 0) {
    store.resetTheme(theme.id)
    recycled = true
    available = theme.pairs.map((pair, index) => ({ pair, index }))
  }

  const chosen = pickRandom(available)
  store.markSeen(theme.id, chosen.index)

  // Which of the two words the majority gets is itself randomised, so a group
  // that recognises a pair still cannot guess which side they are on.
  const flip = Math.random() < 0.5
  const { a, b, defA, defB } = chosen.pair
  const civilian = flip ? { word: b, def: defB } : { word: a, def: defA }
  const undercover = flip ? { word: a, def: defA } : { word: b, def: defB }

  return {
    theme: { id: theme.id, label: theme.label, emoji: theme.emoji },
    civilianWord: civilian.word,
    civilianDef: civilian.def,
    undercoverWord: undercover.word,
    undercoverDef: undercover.def,
    recycled,
    remaining: theme.pairs.length - store.seenCount(theme.id),
  }
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

/** Random theme, biased towards the ones with the most unplayed pairs left. */
function pickWeighted(pool) {
  if (pool.length === 0) return null
  if (pool.length === 1) return pool[0]

  const weights = pool.map((t) => Math.max(1, t.pairs.length - store.seenCount(t.id)))
  const total = weights.reduce((a, b) => a + b, 0)
  let roll = Math.random() * total
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i]
    if (roll <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

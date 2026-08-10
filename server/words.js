import fs from 'node:fs'
import path from 'node:path'
import { store } from './store.js'
/**
 * `customPath` is everything the host adds through the editor — never the
 * shipped theme files, which keeps the bundled bank pristine and upgradable and
 * makes the user's own additions a single file to back up or delete.
 */
import { dataDir, wordsDir, customWordsPath as customPath } from './paths.js'

let themes = []

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

/**
 * Identity of a pair, independent of where it sits in the file.
 *
 * The "already played" history used to be keyed by array index, which quietly
 * broke the moment a pair was inserted or removed — every later entry pointed
 * at the wrong words. Keying by content makes the history survive any edit.
 */
export function pairKey(a, b) {
  return [a, b].map((w) => String(w).trim().toLowerCase()).sort().join('|')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function readCustom() {
  const raw = readJson(customPath, {})
  return {
    themes: Array.isArray(raw.themes) ? raw.themes : [],
    extras: raw.extras && typeof raw.extras === 'object' ? raw.extras : {},
  }
}

function writeCustom(custom) {
  fs.mkdirSync(dataDir, { recursive: true })
  const tmp = `${customPath}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(custom, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, customPath)
}

/** Cleans a raw pair list, dropping anything unusable, and dedupes. */
function sanitisePairs(rawPairs, { source, seen = new Set() } = {}) {
  const pairs = []
  for (const entry of rawPairs ?? []) {
    const { a, b, defA, defB } = parsePair(entry)
    if (!a || !b) continue
    const key = pairKey(a, b)
    // An identical or duplicated pair silently ruins a round: the undercover
    // becomes unmaskable, or the household sees a "fresh" word they already
    // played. Catch it at load.
    if (String(a).toLowerCase() === String(b).toLowerCase() || seen.has(key)) {
      if (source) console.warn(`[words] paire ignorée dans ${source} : ${a} / ${b}`)
      continue
    }
    seen.add(key)
    pairs.push({ a, b, defA: defA ?? null, defB: defB ?? null, key, custom: Boolean(source === null) })
  }
  return pairs
}

export function loadThemes() {
  const custom = readCustom()
  const loaded = []

  for (const file of fs.readdirSync(wordsDir).filter((f) => f.endsWith('.json'))) {
    const raw = readJson(path.join(wordsDir, file), null)
    if (!raw?.id) continue

    const seen = new Set()
    const pairs = sanitisePairs(raw.pairs, { source: file, seen })
    // Host additions to a shipped theme ride along, marked so the editor knows
    // which ones it is allowed to remove.
    const extra = sanitisePairs(custom.extras[raw.id], { source: null, seen })

    loaded.push({
      id: raw.id,
      label: raw.label,
      emoji: raw.emoji ?? '🎲',
      builtIn: true,
      pairs: [...pairs, ...extra],
    })
  }

  for (const t of custom.themes) {
    if (!t?.id || !t?.label) continue
    loaded.push({
      id: t.id,
      label: t.label,
      emoji: t.emoji ?? '🎲',
      builtIn: false,
      pairs: sanitisePairs(t.pairs, { source: null }),
    })
  }

  themes = loaded.sort((a, b) => a.label.localeCompare(b.label, 'fr'))
  return themes
}

loadThemes()

export function listThemes() {
  return themes.map((t) => ({
    id: t.id,
    label: t.label,
    emoji: t.emoji,
    builtIn: t.builtIn,
    total: t.pairs.length,
    remaining: t.pairs.length - store.seenCount(t.id),
    described: t.pairs.filter((p) => p.defA || p.defB).length,
  }))
}

/** Full contents, for the editor. */
export function themeDetail(themeId) {
  const t = themes.find((x) => x.id === themeId)
  if (!t) return null
  return {
    id: t.id,
    label: t.label,
    emoji: t.emoji,
    builtIn: t.builtIn,
    pairs: t.pairs.map((p) => ({
      key: p.key,
      a: p.a,
      b: p.b,
      defA: p.defA,
      defB: p.defB,
      custom: p.custom,
      seen: store.hasSeen(t.id, p.key),
    })),
  }
}

export function totalPairs() {
  return themes.reduce((sum, t) => sum + t.pairs.length, 0)
}

// ------------------------------------------------------------------ editing

export class WordsError extends Error {}

const slug = (s) =>
  String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)

export function createTheme({ label, emoji }) {
  const clean = String(label ?? '').trim().slice(0, 32)
  if (!clean) throw new WordsError('Donne un nom au thème.')

  const base = slug(clean) || 'theme'
  let id = `x-${base}`
  let n = 2
  while (themes.some((t) => t.id === id)) id = `x-${base}-${n++}`

  const custom = readCustom()
  custom.themes.push({ id, label: clean, emoji: String(emoji ?? '🎲').slice(0, 4), pairs: [] })
  writeCustom(custom)
  loadThemes()
  return themeDetail(id)
}

export function deleteTheme(themeId) {
  const theme = themes.find((t) => t.id === themeId)
  if (!theme) throw new WordsError('Thème introuvable.')
  if (theme.builtIn) throw new WordsError('Les thèmes fournis ne peuvent pas être supprimés.')

  const custom = readCustom()
  custom.themes = custom.themes.filter((t) => t.id !== themeId)
  writeCustom(custom)
  store.resetTheme(themeId)
  loadThemes()
}

export function addPair(themeId, { a, b, defA, defB }) {
  const theme = themes.find((t) => t.id === themeId)
  if (!theme) throw new WordsError('Thème introuvable.')

  const wordA = String(a ?? '').trim().slice(0, 40)
  const wordB = String(b ?? '').trim().slice(0, 40)
  if (!wordA || !wordB) throw new WordsError('Il faut deux mots.')
  if (wordA.toLowerCase() === wordB.toLowerCase()) {
    throw new WordsError('Les deux mots doivent être différents.')
  }

  const key = pairKey(wordA, wordB)
  if (theme.pairs.some((p) => p.key === key)) {
    throw new WordsError('Cette paire existe déjà dans ce thème.')
  }

  const entry = [wordA, wordB, String(defA ?? '').trim() || null, String(defB ?? '').trim() || null]
  const trimmed = entry[2] || entry[3] ? entry : [wordA, wordB]

  const custom = readCustom()
  if (theme.builtIn) {
    custom.extras[themeId] = [...(custom.extras[themeId] ?? []), trimmed]
  } else {
    const target = custom.themes.find((t) => t.id === themeId)
    if (!target) throw new WordsError('Thème introuvable.')
    target.pairs = [...(target.pairs ?? []), trimmed]
  }
  writeCustom(custom)
  loadThemes()
  return themeDetail(themeId)
}

/** Only host-added pairs can go; the shipped bank is never mutated. */
export function removePair(themeId, key) {
  const theme = themes.find((t) => t.id === themeId)
  if (!theme) throw new WordsError('Thème introuvable.')
  const pair = theme.pairs.find((p) => p.key === key)
  if (!pair) throw new WordsError('Paire introuvable.')
  if (!pair.custom) throw new WordsError('Les paires fournies ne peuvent pas être supprimées.')

  const custom = readCustom()
  const drop = (list) => (list ?? []).filter((e) => {
    const { a, b } = parsePair(e)
    return pairKey(a, b) !== key
  })

  if (theme.builtIn) custom.extras[themeId] = drop(custom.extras[themeId])
  else {
    const target = custom.themes.find((t) => t.id === themeId)
    if (target) target.pairs = drop(target.pairs)
  }
  writeCustom(custom)
  loadThemes()
  return themeDetail(themeId)
}

// ------------------------------------------------------------------ drawing

/**
 * Draw a pair the household has never played.
 *
 * The whole point of the app: with hundreds of pairs, a group can play many
 * nights before repeating anything. Only once a theme is genuinely exhausted do
 * we recycle it — and we say so, rather than quietly repeating.
 */
export function drawPair({ themeIds = null } = {}) {
  // An empty or missing selection means "anything goes".
  const wanted = Array.isArray(themeIds) ? themes.filter((t) => themeIds.includes(t.id)) : []
  const pool = (wanted.length > 0 ? wanted : themes).filter((t) => t.pairs.length > 0)

  // Weight the draw by how much fresh material each theme still holds, so a
  // nearly-exhausted theme does not keep winning the coin toss against an
  // untouched one and force an early recycle.
  const theme = pickWeighted(pool)
  if (!theme) throw new Error('Aucun thème disponible.')

  let recycled = false
  let available = theme.pairs.filter((p) => !store.hasSeen(theme.id, p.key))

  if (available.length === 0) {
    store.resetTheme(theme.id)
    recycled = true
    available = theme.pairs
  }

  const chosen = pickRandom(available)
  store.markSeen(theme.id, chosen.key)

  // Which of the two words the majority gets is itself randomised, so a group
  // that recognises a pair still cannot guess which side they are on.
  const flip = Math.random() < 0.5
  const { a, b, defA, defB } = chosen
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

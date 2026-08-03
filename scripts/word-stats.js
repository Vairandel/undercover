import { listThemes, totalPairs } from '../server/words.js'

const themes = listThemes()

console.log(`\n  ${totalPairs()} paires · ${themes.length} thèmes\n`)
for (const t of themes) {
  const used = t.total - t.remaining
  const bar = '█'.repeat(Math.round((used / t.total) * 20)).padEnd(20, '·')
  console.log(
    `  ${t.emoji}  ${t.label.padEnd(24)} ${bar}  ${String(t.remaining).padStart(3)} inédites / ${t.total}`,
  )
}
console.log('\n  Remettre le compteur à zéro : POST /api/bank/reset\n')

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { root, SCRATCH, testEnv } from './helpers.mjs'

/**
 * Runs every `*.test.mjs` in this folder, each in its own process.
 *
 * Separate processes because the engine keeps module-level state (the word
 * bank, the store) that one suite must not be able to leave dirty for the next.
 */
const dir = path.join(root, 'tests')
const suites = fs.readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort()

// A clean sandbox every run, so yesterday's simulated games never influence
// today's draws — and so nothing here can drift towards the real data.
fs.rmSync(SCRATCH, { recursive: true, force: true })
fs.mkdirSync(SCRATCH, { recursive: true })

const run = (file) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, file)], {
      cwd: root,
      env: testEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (c) => { out += c })
    child.stderr.on('data', (c) => { out += c })
    child.on('close', (code) => resolve({ file, code, out }))
  })

console.log(`\n🧪  ${suites.length} suite(s) · bac à sable ${path.relative(root, SCRATCH)}\n`)

let failed = 0
for (const file of suites) {
  const res = await run(file)
  const summary = res.out.trim().split('\n').filter((l) => /réussis/.test(l)).pop() ?? '(pas de résumé)'
  console.log(`${res.code === 0 ? '✅' : '❌'} ${file.padEnd(24)} ${summary.trim()}`)
  if (res.code !== 0) {
    failed += 1
    for (const line of res.out.split('\n').filter((l) => l.includes('✘'))) console.log(`   ${line.trim()}`)
  }
}

console.log(failed === 0 ? '\n✅ tout passe\n' : `\n❌ ${failed} suite(s) en échec\n`)
process.exit(failed === 0 ? 0 : 1)

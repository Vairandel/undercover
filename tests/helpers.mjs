import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Test scaffolding.
 *
 * The one rule that matters here: **tests never touch the household's data**.
 * The suites boot the real server, so every simulated game used to draw real
 * word pairs and stamp them "already played" in the real history — hundreds of
 * pairs burnt by robots that nobody at the table ever saw. `UNDERCOVER_DATA_DIR`
 * points everything at a disposable directory instead.
 */
export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
export const SCRATCH = path.join(root, 'tests', '.scratch')

// Set before anything imports the engine — `paths.js` reads it at load time.
process.env.UNDERCOVER_DATA_DIR = SCRATCH

/** Env for a spawned server, so child processes inherit the same isolation. */
export const testEnv = (extra = {}) => ({
  ...process.env,
  UNDERCOVER_DATA_DIR: SCRATCH,
  ...extra,
})

// ------------------------------------------------------------------ asserts

let passed = 0
let failed = 0
const failures = []

export function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  ✔ ${label}${detail ? ' — ' + detail : ''}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  ✘ ${label}${detail ? ' — ' + detail : ''}`)
  }
  return Boolean(condition)
}

export function section(title) {
  console.log(`\n=== ${title} ===`)
}

export function report() {
  const ok = failed === 0
  console.log(`\n${ok ? '✅' : '❌'} ${passed} réussis, ${failed} échoués\n`)
  return ok
}

export const counts = () => ({ passed, failed, failures })

// -------------------------------------------------------------------- utils

export const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Every optional role off, so a suite only gets what it asked for. */
export const NO_ROLES = {
  mrwhite: false, bouffon: false, maire: false, justicier: false,
  amoureux: false, vengeuse: false, duelliste: false, fantome: false,
  mercenaire: false,
}

/** Settings that make a game run instantly and deterministically enough. */
export const FAST = {
  writtenClues: true,
  turnTimer: 0,
  discussTime: 0,
  undercoverCount: 1,
  roles: NO_ROLES,
}

/**
 * Drives a headless game to the end, with bots that always vote for a given
 * victim. Returns the finished game.
 */
export function driveToEnd(game, chooseVictim, { maxRounds = 30 } = {}) {
  let guard = 0
  let seq = 0
  while (game.phase !== 'gameOver' && guard++ < maxRounds) {
    if (game.phase === 'reveal') {
      for (const p of game.players.values()) game.markReady(p.id)
      continue
    }
    if (game.phase === 'describe') {
      while (game.phase === 'describe') game.submitClue(game.currentSpeakerId, `i${seq++}`)
      continue
    }
    if (game.phase === 'discuss') { game.skipDiscussion(); continue }
    if (game.phase === 'vote') {
      const alive = [...game.players.values()].filter((p) => p.alive)
      const victim = chooseVictim(alive, game)
      if (!victim) break
      for (const p of alive) {
        if (game.phase !== 'vote') break
        const target = p.id === victim.id ? alive.find((x) => x.id !== victim.id) : victim
        if (target) game.submitVote(p.id, target.id)
      }
      continue
    }
    if (game.phase === 'voteResult') { game.continueRound(); continue }
    break
  }
  return game
}
